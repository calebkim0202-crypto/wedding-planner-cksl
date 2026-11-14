-- Wedding planning dashboard: Supabase schema (draft for review)
-- Money is stored as integer cents. Dates are plain dates in the wedding's timezone.

create extension if not exists citext;

-- ENUMS --------------------------------------------------------------
create type member_role   as enum ('owner', 'member');
create type access_area   as enum ('vendors', 'payments', 'deadlines');
-- order matters: none < view < edit, so levels can be compared
create type access_level  as enum ('none', 'view', 'edit');

-- WEDDINGS -----------------------------------------------------------
create table weddings (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  wedding_date  date,
  timezone      text not null default 'Australia/Sydney',  -- used to decide what "7 days out" means
  currency      char(3) not null default 'AUD',
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now()
);

-- MEMBERS (who can log in) ------------------------------------------
-- A row exists as soon as you invite an email. Access is matched on the
-- verified email from the login link, so no separate "accept" step is needed.
create table wedding_members (
  id            uuid primary key default gen_random_uuid(),
  wedding_id    uuid not null references weddings(id) on delete cascade,
  email         citext not null,
  display_name  text,
  role          member_role not null default 'member',
  invited_by    uuid references auth.users(id),
  invited_at    timestamptz not null default now(),
  first_login_at timestamptz,
  unique (wedding_id, email)
);

-- PER-PERSON VISIBILITY ----------------------------------------------
-- One row per (member, area). No row = no access. Owners bypass this table.
create table member_access (
  member_id  uuid not null references wedding_members(id) on delete cascade,
  area       access_area not null,
  level      access_level not null default 'view',
  primary key (member_id, area)
);

-- CONTACTS (who can owe something) ------------------------------------
-- Separate from members: the person who owes a payment might never log in
-- (e.g. a parent, the best man). Reminder emails go to contacts.
create table contacts (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  uuid not null references weddings(id) on delete cascade,
  name        text not null,
  email       citext,                 -- null = no reminders can be sent
  member_id   uuid references wedding_members(id) on delete set null,
  unique (wedding_id, email)
);

-- VENDORS --------------------------------------------------------------
create table vendors (
  id                   uuid primary key default gen_random_uuid(),
  wedding_id           uuid not null references weddings(id) on delete cascade,
  name                 text not null,
  category             text,          -- venue, photographer, florist...
  contact_name         text,
  contact_email        text,
  contact_phone        text,
  contract_total_cents bigint not null default 0 check (contract_total_cents >= 0),
  contract_signed_on   date,
  notes                text,
  created_at           timestamptz not null default now()
);

-- PAYMENTS (scheduled instalments owed to vendors) ----------------------
create table payments (
  id            uuid primary key default gen_random_uuid(),
  wedding_id    uuid not null references weddings(id) on delete cascade,
  vendor_id     uuid not null references vendors(id) on delete cascade,
  label         text not null,        -- "Deposit", "Final balance"
  amount_cents  bigint not null check (amount_cents > 0),   -- amount due
  due_date      date not null,
  owed_by       uuid references contacts(id) on delete set null,  -- who has to pay it
  notes         text,
  created_at    timestamptz not null default now()
);
create index on payments (wedding_id, due_date);

-- PAYMENT TRANSACTIONS (money actually paid, any number per payment) ------
-- Part payments are just several rows here. A payment is settled when its
-- transactions add up to its amount_cents.
create table payment_transactions (
  id            uuid primary key default gen_random_uuid(),
  wedding_id    uuid not null references weddings(id) on delete cascade,
  payment_id    uuid not null references payments(id) on delete cascade,
  amount_cents  bigint not null check (amount_cents > 0),
  paid_on       date not null,
  note          text,
  recorded_by   uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index on payment_transactions (payment_id);

-- DEADLINES (non-money tasks) -----------------------------------------
create table deadlines (
  id            uuid primary key default gen_random_uuid(),
  wedding_id    uuid not null references weddings(id) on delete cascade,
  vendor_id     uuid references vendors(id) on delete set null,
  title         text not null,        -- "Final guest count to caterer"
  due_date      date not null,
  owed_by       uuid references contacts(id) on delete set null,
  completed_on  date,
  notes         text,
  created_at    timestamptz not null default now()
);
create index on deadlines (wedding_id, due_date) where completed_on is null;

-- REMINDER LOG ---------------------------------------------------------
-- Written by the daily cron job (service role only). The unique indexes make
-- sends idempotent: insert the row first, send only if the insert succeeded.
create table reminder_log (
  id             uuid primary key default gen_random_uuid(),
  wedding_id     uuid not null references weddings(id) on delete cascade,
  payment_id     uuid references payments(id) on delete cascade,
  deadline_id    uuid references deadlines(id) on delete cascade,
  days_out       smallint not null check (days_out in (7, 3, 1)),
  recipient_email citext not null,
  status         text not null default 'pending' check (status in ('pending','sent','failed')),
  resend_id      text,
  error          text,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  check ((payment_id is not null) <> (deadline_id is not null))  -- exactly one
);
create unique index reminder_once_payment  on reminder_log (payment_id,  days_out) where payment_id  is not null;
create unique index reminder_once_deadline on reminder_log (deadline_id, days_out) where deadline_id is not null;

-- DERIVED TOTALS --------------------------------------------------------
create view payment_balances with (security_invoker = true) as
select p.id as payment_id,
       p.wedding_id,
       p.vendor_id,
       p.amount_cents,
       coalesce(sum(t.amount_cents), 0) as paid_cents,
       p.amount_cents - coalesce(sum(t.amount_cents), 0) as remaining_cents
from payments p
left join payment_transactions t on t.payment_id = p.id
group by p.id;

-- ACCESS CHECK ------------------------------------------------------------
create function can_access(w uuid, a access_area, need access_level)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from wedding_members m
    where m.wedding_id = w
      and lower(m.email::text) = lower(auth.jwt() ->> 'email')
      and (
        m.role = 'owner'
        or exists (select 1 from member_access x
                   where x.member_id = m.id and x.area = a and x.level >= need)
      )
  );
$$;

create function is_owner(w uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from wedding_members m
    where m.wedding_id = w and m.role = 'owner'
      and lower(m.email::text) = lower(auth.jwt() ->> 'email')
  );
$$;

-- paid_cents = everything actually paid to the vendor; remaining is against the contract total.
-- Deliberately NOT security_invoker: someone with "vendors" access but not "payments" access
-- still needs to see paid/remaining totals. The WHERE clause enforces the vendors permission.
-- (Defined after can_access so the function exists.)
create view vendor_balances as
select v.id as vendor_id,
       v.wedding_id,
       v.contract_total_cents,
       coalesce(sum(t.amount_cents), 0) as paid_cents,
       v.contract_total_cents - coalesce(sum(t.amount_cents), 0) as remaining_cents
from vendors v
left join payments p on p.vendor_id = v.id
left join payment_transactions t on t.payment_id = p.id
where can_access(v.wedding_id, 'vendors', 'view')
group by v.id;

-- ROW LEVEL SECURITY --------------------------------------------------------
alter table weddings        enable row level security;
alter table wedding_members enable row level security;
alter table member_access   enable row level security;
alter table contacts        enable row level security;
alter table vendors         enable row level security;
alter table payments        enable row level security;
alter table payment_transactions enable row level security;
alter table deadlines       enable row level security;
alter table reminder_log    enable row level security;  -- no policies: service role only

create policy wedding_read on weddings for select
  using (exists (select 1 from wedding_members m where m.wedding_id = weddings.id
                 and lower(m.email::text) = lower(auth.jwt() ->> 'email')));
create policy wedding_owner_write on weddings for all
  using (is_owner(id)) with check (is_owner(id));

create policy members_read_self_or_owner on wedding_members for select
  using (is_owner(wedding_id) or lower(email::text) = lower(auth.jwt() ->> 'email'));
create policy members_owner_write on wedding_members for all
  using (is_owner(wedding_id)) with check (is_owner(wedding_id));

create policy access_read on member_access for select
  using (exists (select 1 from wedding_members m where m.id = member_id
         and (is_owner(m.wedding_id) or lower(m.email::text) = lower(auth.jwt() ->> 'email'))));
create policy access_owner_write on member_access for all
  using (exists (select 1 from wedding_members m where m.id = member_id and is_owner(m.wedding_id)))
  with check (exists (select 1 from wedding_members m where m.id = member_id and is_owner(m.wedding_id)));

-- contacts are needed to show "who owes it", so anyone who can see payments or deadlines can read them
create policy contacts_read on contacts for select
  using (can_access(wedding_id, 'payments', 'view') or can_access(wedding_id, 'deadlines', 'view'));
create policy contacts_owner_write on contacts for all
  using (is_owner(wedding_id)) with check (is_owner(wedding_id));

create policy vendors_read  on vendors  for select using (can_access(wedding_id, 'vendors', 'view'));
create policy vendors_write on vendors  for all
  using (can_access(wedding_id, 'vendors', 'edit')) with check (can_access(wedding_id, 'vendors', 'edit'));

create policy payments_read  on payments for select using (can_access(wedding_id, 'payments', 'view'));
create policy payments_write on payments for all
  using (can_access(wedding_id, 'payments', 'edit')) with check (can_access(wedding_id, 'payments', 'edit'));

create policy txn_read  on payment_transactions for select using (can_access(wedding_id, 'payments', 'view'));
create policy txn_write on payment_transactions for all
  using (can_access(wedding_id, 'payments', 'edit')) with check (can_access(wedding_id, 'payments', 'edit'));

create policy deadlines_read  on deadlines for select using (can_access(wedding_id, 'deadlines', 'view'));
create policy deadlines_write on deadlines for all
  using (can_access(wedding_id, 'deadlines', 'edit')) with check (can_access(wedding_id, 'deadlines', 'edit'));
