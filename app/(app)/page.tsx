import Link from "next/link";
import { can, requireContext } from "@/lib/access";
import { supabaseServer } from "@/lib/supabase/server";
import { daysUntil, dueLabel, fmtDate, money } from "@/lib/format";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const supabase = await supabaseServer();
  const cur = ctx.wedding.currency;
  const tz = ctx.wedding.timezone;
  const showV = can(ctx, "vendors");
  const showP = can(ctx, "payments");
  const showD = can(ctx, "deadlines");

  const [bal, pays, dls] = await Promise.all([
    showV ? supabase.from("vendor_balances").select("*").eq("wedding_id", ctx.wedding.id) : null,
    showP
      ? supabase
          .from("payments")
          .select("id, label, amount_cents, due_date, vendors(name), contact:contacts!owed_by(name), payment_transactions(amount_cents)")
          .eq("wedding_id", ctx.wedding.id)
          .order("due_date")
      : null,
    showD
      ? supabase
          .from("deadlines")
          .select("id, title, due_date, contact:contacts!owed_by(name)")
          .eq("wedding_id", ctx.wedding.id)
          .is("completed_on", null)
          .order("due_date")
          .limit(8)
      : null,
  ]);

  const balances = (bal?.data ?? []) as any[];
  const contract = balances.reduce((s, b) => s + Number(b.contract_total_cents), 0);
  const paid = balances.reduce((s, b) => s + Number(b.paid_cents), 0);

  const openPayments = ((pays?.data ?? []) as any[])
    .map((p) => {
      const got = (p.payment_transactions ?? []).reduce((s: number, t: any) => s + Number(t.amount_cents), 0);
      return { ...p, remaining: Number(p.amount_cents) - got };
    })
    .filter((p) => p.remaining > 0)
    .slice(0, 8);
  const deadlines = (dls?.data ?? []) as any[];

  return (
    <>
      {sp.denied && <div className="notice">You don’t have access to that section.</div>}
      <h1>{ctx.wedding.name}</h1>
      {ctx.wedding.wedding_date && (
        <p className="muted">
          {fmtDate(ctx.wedding.wedding_date)} · {dueLabel(daysUntil(ctx.wedding.wedding_date, tz))}
        </p>
      )}

      {showV && (
        <div className="grid">
          <div className="stat"><div className="muted">Contracts total</div><div className="n">{money(contract, cur)}</div></div>
          <div className="stat"><div className="muted">Paid so far</div><div className="n">{money(paid, cur)}</div></div>
          <div className="stat"><div className="muted">Still to pay</div><div className="n">{money(contract - paid, cur)}</div></div>
        </div>
      )}

      {showP && (
        <div className="card">
          <div className="row"><h2>Next payments</h2><Link href="/payments">All payments</Link></div>
          {openPayments.length === 0 ? (
            <p className="muted">Nothing outstanding.</p>
          ) : (
            <table>
              <tbody>
                {openPayments.map((p) => {
                  const d = daysUntil(p.due_date, tz);
                  return (
                    <tr key={p.id}>
                      <td>{p.vendors?.name ?? "Vendor"} — {p.label}<div className="muted">{p.contact?.name ? `Owed by ${p.contact.name}` : "No one assigned"}</div></td>
                      <td className={d < 0 ? "bad" : d <= 7 ? "warn" : ""}>{fmtDate(p.due_date)}<div>{dueLabel(d)}</div></td>
                      <td className="num">{money(p.remaining, cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showD && (
        <div className="card">
          <div className="row"><h2>Next deadlines</h2><Link href="/deadlines">All deadlines</Link></div>
          {deadlines.length === 0 ? (
            <p className="muted">Nothing outstanding.</p>
          ) : (
            <table>
              <tbody>
                {deadlines.map((d) => {
                  const n = daysUntil(d.due_date, tz);
                  return (
                    <tr key={d.id}>
                      <td>{d.title}<div className="muted">{d.contact?.name ? `Owed by ${d.contact.name}` : "No one assigned"}</div></td>
                      <td className={n < 0 ? "bad" : n <= 7 ? "warn" : ""}>{fmtDate(d.due_date)}<div>{dueLabel(n)}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!showV && !showP && !showD && <p className="muted">You’ve been added, but haven’t been given access to anything yet.</p>}
    </>
  );
}
