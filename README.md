# Wedding planner

Private dashboard for vendors, payments and deadlines. Next.js on Vercel, Supabase (database and login), Resend (email).

## What it does

- **Vendors:** contract total, paid so far, what's left.
- **Payments:** scheduled instalments with a due date and who owes them. Record part payments against an instalment as they happen.
- **Deadlines:** non-money tasks with a due date and who owes them.
- **Reminders:** a daily job emails whoever owes an unpaid payment or open deadline 7, 3 and 1 days before it's due.
- **People:** invite people by email and choose, per person, whether each of Vendors / Payments / Deadlines is hidden, view-only or editable.
- **No passwords:** everyone signs in with an emailed link.

## Setup

### 1. Supabase

1. Create a project.
2. SQL editor: paste and run `schema.sql`.
3. Authentication → Sign In / Providers → **turn off "Allow new users to sign up"**. The app creates accounts itself, and only for invited emails.
4. Authentication → URL Configuration: set **Site URL** to your deployed URL. Add `http://localhost:3000` to Redirect URLs for local work.
5. Authentication → Email Templates → **Magic Link**: set the link to
   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
   ```
   For example: `<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in</a></p>`
   This form of link works even if it's opened on a different phone or browser from the one that asked for it.
6. Authentication → SMTP Settings: use Resend so sign-in emails aren't throttled by Supabase's built-in sender. Host `smtp.resend.com`, port `465`, username `resend`, password your Resend API key, sender on your verified domain.
7. Project settings → API: copy the URL, the `anon` key and the `service_role` key.

### 2. Resend

Verify a sending domain, create an API key, and choose a from address on that domain.

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill it in. Set the same variables in Vercel.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Never expose it. |
| `RESEND_API_KEY`, `RESEND_FROM` | `RESEND_FROM` like `Wedding <planner@yourdomain.com>` |
| `NEXT_PUBLIC_SITE_URL` | Deployed URL, no trailing slash |
| `OWNER_EMAIL` | The one email allowed to create the wedding on first sign-in |
| `CRON_SECRET` | Long random string. Vercel sends it to the cron route automatically. |

### 4. Run

```bash
npm install
npm run dev
```

Open the site, enter `OWNER_EMAIL`, click the emailed link, and fill in the one-time setup form. After that, use **People** to invite everyone else.

### 5. Deploy

Push to a Git repo, import it into Vercel, add the environment variables. `vercel.json` registers the daily reminder job.

## How reminders work

- Runs once a day at `0 20 * * *` UTC (7am Sydney in summer, 6am in winter). Change it in `vercel.json`.
- "7, 3 and 1 days out" is calculated on the wedding's own timezone (set at setup).
- A payment only gets reminders while something is still unpaid on it. Completed deadlines are skipped.
- People with no email on their contact record can't be reminded.
- `reminder_log` has a unique index per item and day count, so re-running the job never sends the same email twice. If a send fails, its log row is removed so a manual re-run tries again.
- Test it by opening `/api/cron/reminders` with the header `Authorization: Bearer <CRON_SECRET>`; it returns how many were sent, skipped and failed.
- The job matches exact dates, so if it fails to run on a given day, the reminder for that day is missed.

## Permissions

Enforced in the database with Row Level Security, not just hidden in the UI. The owner can do everything. Everyone else only gets the areas they were granted.

Things worth knowing:

- Contract totals live on vendors, so anyone who can see Vendors can see what's owed and paid on each one, even without Payments access.
- To schedule a payment you need to see Vendors (to pick which vendor it's for).
- Anyone who can see Payments or Deadlines can see the names of people who can be assigned things.

## Layout

```
schema.sql                      database, access function, RLS policies
middleware.ts                   keeps the session fresh, sends signed-out visitors to /login
lib/access.ts                   who is signed in and what they may see
app/login, app/auth/confirm     magic-link sign-in
app/setup                       first-run wedding creation (OWNER_EMAIL only)
app/(app)/...                   dashboard, vendors, payments, deadlines, people
app/api/cron/reminders          the daily reminder job
```
