import Link from "next/link";
import { revalidatePath } from "next/cache";
import { can, requireArea } from "@/lib/access";
import { supabaseServer } from "@/lib/supabase/server";
import { daysUntil, dueLabel, fmtDate, money, must, str, strOrNull, toCents, todayIn } from "@/lib/format";

async function addPayment(fd: FormData) {
  "use server";
  const ctx = await requireArea("payments", "edit");
  const supabase = await supabaseServer();
  must(
    await supabase.from("payments").insert({
      wedding_id: ctx.wedding.id,
      vendor_id: str(fd.get("vendor_id")),
      label: str(fd.get("label")),
      amount_cents: toCents(fd.get("amount")),
      due_date: str(fd.get("due_date")),
      owed_by: strOrNull(fd.get("owed_by")),
    })
  );
  revalidatePath("/payments");
}

async function deletePayment(fd: FormData) {
  "use server";
  const ctx = await requireArea("payments", "edit");
  const supabase = await supabaseServer();
  must(await supabase.from("payments").delete().eq("id", str(fd.get("id"))).eq("wedding_id", ctx.wedding.id));
  revalidatePath("/payments");
}

/** Record money actually paid. Part payments are just several of these against one payment. */
async function recordPayment(fd: FormData) {
  "use server";
  const ctx = await requireArea("payments", "edit");
  const supabase = await supabaseServer();
  must(
    await supabase.from("payment_transactions").insert({
      wedding_id: ctx.wedding.id,
      payment_id: str(fd.get("payment_id")),
      amount_cents: toCents(fd.get("amount")),
      paid_on: str(fd.get("paid_on")),
      note: strOrNull(fd.get("note")),
      recorded_by: ctx.userId,
    })
  );
  revalidatePath("/payments");
  revalidatePath("/vendors");
}

async function deleteTransaction(fd: FormData) {
  "use server";
  const ctx = await requireArea("payments", "edit");
  const supabase = await supabaseServer();
  must(await supabase.from("payment_transactions").delete().eq("id", str(fd.get("id"))).eq("wedding_id", ctx.wedding.id));
  revalidatePath("/payments");
  revalidatePath("/vendors");
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireArea("payments");
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const editable = can(ctx, "payments", "edit");
  const supabase = await supabaseServer();
  const cur = ctx.wedding.currency;
  const tz = ctx.wedding.timezone;

  const [{ data: pays }, { data: vendors }, { data: contacts }] = await Promise.all([
    supabase
      .from("payments")
      .select("id, label, amount_cents, due_date, vendors(name), contact:contacts!owed_by(name), payment_transactions(id, amount_cents, paid_on, note)")
      .eq("wedding_id", ctx.wedding.id)
      .order("due_date"),
    supabase.from("vendors").select("id, name").eq("wedding_id", ctx.wedding.id).order("name"),
    supabase.from("contacts").select("id, name").eq("wedding_id", ctx.wedding.id).order("name"),
  ]);

  const rows = ((pays ?? []) as any[]).map((p) => {
    const txns = [...(p.payment_transactions ?? [])].sort((a: any, b: any) => a.paid_on.localeCompare(b.paid_on));
    const paid = txns.reduce((s: number, t: any) => s + Number(t.amount_cents), 0);
    return { ...p, txns, paid, remaining: Number(p.amount_cents) - paid };
  });
  const shown = showAll ? rows : rows.filter((r) => r.remaining > 0);
  const today = todayIn(tz);

  return (
    <>
      <div className="row">
        <h1>Payments</h1>
        <Link href={showAll ? "/payments" : "/payments?show=all"}>{showAll ? "Hide fully paid" : "Show fully paid"}</Link>
      </div>

      {shown.length === 0 && <p className="muted">{showAll ? "No payments yet." : "Nothing outstanding."}</p>}

      {shown.map((p) => {
        const d = daysUntil(p.due_date, tz);
        const settled = p.remaining <= 0;
        return (
          <div className="card" key={p.id}>
            <div className="row">
              <div>
                <strong>{p.vendors?.name ?? "Vendor"} — {p.label}</strong>
                <div className="muted">{p.contact?.name ? `Owed by ${p.contact.name}` : "No one assigned"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div>{money(Number(p.amount_cents), cur)} due {fmtDate(p.due_date)}</div>
                <div className={settled ? "good" : d < 0 ? "bad" : d <= 7 ? "warn" : "muted"}>{settled ? "Paid in full" : dueLabel(d)}</div>
              </div>
            </div>

            <progress value={Math.min(p.paid, Number(p.amount_cents))} max={Number(p.amount_cents)} />
            <div className="muted">
              {money(p.paid, cur)} paid · {settled ? (p.remaining < 0 ? `${money(-p.remaining, cur)} over` : "nothing left") : `${money(p.remaining, cur)} left`}
            </div>

            {p.txns.length > 0 && (
              <table>
                <tbody>
                  {p.txns.map((t: any) => (
                    <tr key={t.id}>
                      <td>{fmtDate(t.paid_on)}</td>
                      <td>{t.note ?? ""}</td>
                      <td className="num">{money(Number(t.amount_cents), cur)}</td>
                      {editable && (
                        <td className="num">
                          <form action={deleteTransaction}>
                            <input type="hidden" name="id" value={t.id} />
                            <button type="submit" className="link">Remove</button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {editable && (
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                <form action={recordPayment} className="inline">
                  <input type="hidden" name="payment_id" value={p.id} />
                  <label>Amount paid ({cur})<input name="amount" inputMode="decimal" required defaultValue={p.remaining > 0 ? (p.remaining / 100).toFixed(2) : ""} /></label>
                  <label>Date<input name="paid_on" type="date" required defaultValue={today} /></label>
                  <label>Note<input name="note" placeholder="Optional" /></label>
                  <button type="submit">Record payment</button>
                </form>
                <form action={deletePayment}>
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="link">Delete this scheduled payment</button>
                </form>
              </div>
            )}
          </div>
        );
      })}

      {editable && (
        <div className="card">
          <h2>Schedule a payment</h2>
          {(vendors ?? []).length === 0 ? (
            <p className="muted">Add a vendor first (you need vendor access for that).</p>
          ) : (
            <form action={addPayment} className="inline">
              <label>
                Vendor
                <select name="vendor_id" required>
                  {(vendors ?? []).map((v: any) => (<option key={v.id} value={v.id}>{v.name}</option>))}
                </select>
              </label>
              <label>What for<input name="label" placeholder="Deposit" required /></label>
              <label>Amount ({cur})<input name="amount" inputMode="decimal" required /></label>
              <label>Due date<input name="due_date" type="date" required /></label>
              <label>
                Who owes it
                <select name="owed_by" defaultValue="">
                  <option value="">Nobody yet</option>
                  {(contacts ?? []).map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </label>
              <button type="submit">Add</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
