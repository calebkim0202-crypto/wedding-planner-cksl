import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { layout, sendEmail } from "@/lib/email";
import { addDays, esc, fmtDate, money, todayIn } from "@/lib/format";

export const dynamic = "force-dynamic";

const DAYS_OUT = [7, 3, 1] as const;

type Admin = ReturnType<typeof supabaseAdmin>;
type Claim = {
  wedding_id: string;
  payment_id?: string;
  deadline_id?: string;
  days_out: number;
  to: string;
  subject: string;
  html: string;
};

/**
 * Insert the reminder_log row first. The unique indexes mean a second run for the
 * same item and day gets a conflict and sends nothing, so retries never double-send.
 * If sending fails the row is removed so a manual re-run the same day tries again.
 */
async function claimAndSend(admin: Admin, c: Claim): Promise<"sent" | "skipped" | "failed"> {
  const { data: log, error } = await admin
    .from("reminder_log")
    .insert({
      wedding_id: c.wedding_id,
      payment_id: c.payment_id ?? null,
      deadline_id: c.deadline_id ?? null,
      days_out: c.days_out,
      recipient_email: c.to,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return "skipped";
    console.error("reminder_log insert failed", error.message);
    return "failed";
  }
  try {
    const resendId = await sendEmail(c.to, c.subject, c.html);
    await admin.from("reminder_log").update({ status: "sent", resend_id: resendId, sent_at: new Date().toISOString() }).eq("id", log.id);
    return "sent";
  } catch (e) {
    console.error("reminder email failed", c.to, e);
    await admin.from("reminder_log").delete().eq("id", log.id);
    return "failed";
  }
}

const when = (n: number) => (n === 1 ? "tomorrow" : `in ${n} days`);

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const admin = supabaseAdmin();
  const totals = { sent: 0, skipped: 0, failed: 0 };
  const tally = (r: "sent" | "skipped" | "failed") => void (totals[r] += 1);

  const { data: weddings, error } = await admin.from("weddings").select("id, name, timezone, currency");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const w of weddings ?? []) {
    // "7 days out" is judged on the wedding's own calendar, not the server's.
    const today = todayIn(w.timezone);

    for (const n of DAYS_OUT) {
      const target = addDays(today, n);

      const { data: pays } = await admin
        .from("payments")
        .select("id, label, amount_cents, due_date, vendors(name), contact:contacts!owed_by(name, email), payment_transactions(amount_cents)")
        .eq("wedding_id", w.id)
        .eq("due_date", target);

      for (const p of (pays ?? []) as any[]) {
        const paid = (p.payment_transactions ?? []).reduce((s: number, t: any) => s + Number(t.amount_cents), 0);
        const remaining = Number(p.amount_cents) - paid;
        const to: string | undefined = p.contact?.email;
        if (remaining <= 0 || !to) continue;

        const vendor = p.vendors?.name ?? "a vendor";
        tally(
          await claimAndSend(admin, {
            wedding_id: w.id,
            payment_id: p.id,
            days_out: n,
            to,
            subject: `Payment due ${when(n)}: ${vendor} — ${p.label}`,
            html: layout(
              `<h2 style="margin:0 0 12px">Payment due ${when(n)}</h2>
               <p>Hi ${esc(p.contact?.name ?? "there")}, this is a reminder for <strong>${esc(w.name)}</strong>.</p>
               <p><strong>${esc(vendor)} — ${esc(p.label)}</strong><br>
               ${esc(money(remaining, w.currency))} still to pay, due ${esc(fmtDate(p.due_date))}.</p>
               ${paid > 0 ? `<p style="color:#6b7280">${esc(money(paid, w.currency))} of ${esc(money(Number(p.amount_cents), w.currency))} has already been paid.</p>` : ""}`
            ),
          })
        );
      }

      const { data: dls } = await admin
        .from("deadlines")
        .select("id, title, due_date, notes, contact:contacts!owed_by(name, email)")
        .eq("wedding_id", w.id)
        .eq("due_date", target)
        .is("completed_on", null);

      for (const d of (dls ?? []) as any[]) {
        const to: string | undefined = d.contact?.email;
        if (!to) continue;
        tally(
          await claimAndSend(admin, {
            wedding_id: w.id,
            deadline_id: d.id,
            days_out: n,
            to,
            subject: `Due ${when(n)}: ${d.title}`,
            html: layout(
              `<h2 style="margin:0 0 12px">Due ${when(n)}</h2>
               <p>Hi ${esc(d.contact?.name ?? "there")}, this is a reminder for <strong>${esc(w.name)}</strong>.</p>
               <p><strong>${esc(d.title)}</strong><br>Due ${esc(fmtDate(d.due_date))}.</p>
               ${d.notes ? `<p style="color:#6b7280">${esc(d.notes)}</p>` : ""}`
            ),
          })
        );
      }
    }
  }

  return NextResponse.json(totals);
}
