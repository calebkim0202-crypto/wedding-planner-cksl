import Link from "next/link";
import { revalidatePath } from "next/cache";
import { can, requireArea } from "@/lib/access";
import { supabaseServer } from "@/lib/supabase/server";
import { money, must, str, strOrNull, toCents } from "@/lib/format";

async function addVendor(fd: FormData) {
  "use server";
  const ctx = await requireArea("vendors", "edit");
  const supabase = await supabaseServer();
  must(
    await supabase.from("vendors").insert({
      wedding_id: ctx.wedding.id,
      name: str(fd.get("name")),
      category: strOrNull(fd.get("category")),
      contract_total_cents: toCents(fd.get("total")),
    })
  );
  revalidatePath("/vendors");
}

export default async function VendorsPage() {
  const ctx = await requireArea("vendors");
  const supabase = await supabaseServer();
  const cur = ctx.wedding.currency;

  const [{ data: vendors }, { data: bal }] = await Promise.all([
    supabase.from("vendors").select("id, name, category").eq("wedding_id", ctx.wedding.id).order("name"),
    supabase.from("vendor_balances").select("*").eq("wedding_id", ctx.wedding.id),
  ]);
  const byId = new Map((bal ?? []).map((b: any) => [b.vendor_id, b]));
  const rows = (vendors ?? []).map((v: any) => {
    const b: any = byId.get(v.id);
    const total = Number(b?.contract_total_cents ?? 0);
    const paid = Number(b?.paid_cents ?? 0);
    return { ...v, total, paid, remaining: total - paid };
  });
  const sum = (k: "total" | "paid" | "remaining") => rows.reduce((s, r) => s + r[k], 0);

  return (
    <>
      <h1>Vendors</h1>
      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">No vendors yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Vendor</th><th className="num">Contract</th><th className="num">Paid</th><th className="num">Left</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/vendors/${r.id}`}>{r.name}</Link>
                    {r.category && <div className="muted">{r.category}</div>}
                  </td>
                  <td className="num">{money(r.total, cur)}</td>
                  <td className="num">{money(r.paid, cur)}</td>
                  <td className="num">{money(r.remaining, cur)}</td>
                </tr>
              ))}
              <tr>
                <td><strong>Total</strong></td>
                <td className="num"><strong>{money(sum("total"), cur)}</strong></td>
                <td className="num"><strong>{money(sum("paid"), cur)}</strong></td>
                <td className="num"><strong>{money(sum("remaining"), cur)}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {can(ctx, "vendors", "edit") && (
        <div className="card">
          <h2>Add a vendor</h2>
          <form action={addVendor} className="inline">
            <label>Name<input name="name" required /></label>
            <label>Category<input name="category" placeholder="Venue, florist…" /></label>
            <label>Contract total ({cur})<input name="total" inputMode="decimal" placeholder="0.00" /></label>
            <button type="submit">Add</button>
          </form>
        </div>
      )}
    </>
  );
}
