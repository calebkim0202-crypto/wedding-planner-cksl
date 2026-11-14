import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { can, requireArea } from "@/lib/access";
import { supabaseServer } from "@/lib/supabase/server";
import { fmtDate, money, must, str, strOrNull, toCents } from "@/lib/format";

async function updateVendor(fd: FormData) {
  "use server";
  const ctx = await requireArea("vendors", "edit");
  const id = str(fd.get("id"));
  const supabase = await supabaseServer();
  must(
    await supabase
      .from("vendors")
      .update({
        name: str(fd.get("name")),
        category: strOrNull(fd.get("category")),
        contact_name: strOrNull(fd.get("contact_name")),
        contact_email: strOrNull(fd.get("contact_email")),
        contact_phone: strOrNull(fd.get("contact_phone")),
        contract_total_cents: toCents(fd.get("total")),
        contract_signed_on: strOrNull(fd.get("signed")),
        notes: strOrNull(fd.get("notes")),
      })
      .eq("id", id)
      .eq("wedding_id", ctx.wedding.id)
  );
  revalidatePath(`/vendors/${id}`);
  revalidatePath("/vendors");
}

async function deleteVendor(fd: FormData) {
  "use server";
  const ctx = await requireArea("vendors", "edit");
  const supabase = await supabaseServer();
  must(await supabase.from("vendors").delete().eq("id", str(fd.get("id"))).eq("wedding_id", ctx.wedding.id));
  revalidatePath("/vendors");
  redirect("/vendors");
}

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireArea("vendors");
  const supabase = await supabaseServer();
  const cur = ctx.wedding.currency;
  const editable = can(ctx, "vendors", "edit");

  const { data: v } = await supabase.from("vendors").select("*").eq("id", id).eq("wedding_id", ctx.wedding.id).maybeSingle();
  if (!v) notFound();
  const { data: b } = await supabase.from("vendor_balances").select("*").eq("vendor_id", id).maybeSingle();
  const total = Number(b?.contract_total_cents ?? v.contract_total_cents);
  const paid = Number(b?.paid_cents ?? 0);

  // Payment schedule is only shown to people who can see payments.
  const showPayments = can(ctx, "payments");
  const { data: pays } = showPayments
    ? await supabase
        .from("payments")
        .select("id, label, amount_cents, due_date, payment_transactions(amount_cents)")
        .eq("vendor_id", id)
        .order("due_date")
    : { data: [] as any[] };

  return (
    <>
      <p><Link href="/vendors">← Vendors</Link></p>
      <h1>{v.name}</h1>
      <div className="grid">
        <div className="stat"><div className="muted">Contract</div><div className="n">{money(total, cur)}</div></div>
        <div className="stat"><div className="muted">Paid</div><div className="n">{money(paid, cur)}</div></div>
        <div className="stat"><div className="muted">Left</div><div className="n">{money(total - paid, cur)}</div></div>
      </div>

      {showPayments && (
        <div className="card">
          <div className="row"><h2>Payment schedule</h2><Link href="/payments">Manage payments</Link></div>
          {(pays ?? []).length === 0 ? (
            <p className="muted">No payments scheduled.</p>
          ) : (
            <table>
              <tbody>
                {(pays as any[]).map((p) => {
                  const got = (p.payment_transactions ?? []).reduce((s: number, t: any) => s + Number(t.amount_cents), 0);
                  return (
                    <tr key={p.id}>
                      <td>{p.label}</td>
                      <td>{fmtDate(p.due_date)}</td>
                      <td className="num">{money(got, cur)} of {money(Number(p.amount_cents), cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="card">
        <h2>Details</h2>
        <form action={updateVendor} style={{ display: "grid", gap: 12 }}>
          <input type="hidden" name="id" value={v.id} />
          <div className="inline">
            <label>Name<input name="name" defaultValue={v.name} required disabled={!editable} /></label>
            <label>Category<input name="category" defaultValue={v.category ?? ""} disabled={!editable} /></label>
          </div>
          <div className="inline">
            <label>Contract total ({cur})<input name="total" inputMode="decimal" defaultValue={(Number(v.contract_total_cents) / 100).toFixed(2)} disabled={!editable} /></label>
            <label>Contract signed<input name="signed" type="date" defaultValue={v.contract_signed_on ?? ""} disabled={!editable} /></label>
          </div>
          <div className="inline">
            <label>Contact name<input name="contact_name" defaultValue={v.contact_name ?? ""} disabled={!editable} /></label>
            <label>Contact email<input name="contact_email" type="email" defaultValue={v.contact_email ?? ""} disabled={!editable} /></label>
            <label>Contact phone<input name="contact_phone" defaultValue={v.contact_phone ?? ""} disabled={!editable} /></label>
          </div>
          <label>Notes<textarea name="notes" rows={3} defaultValue={v.notes ?? ""} disabled={!editable} /></label>
          {editable && <div><button type="submit">Save</button></div>}
        </form>
      </div>

      {editable && (
        <div className="card">
          <h2>Delete vendor</h2>
          <p className="muted">This also deletes the vendor’s payments and payment records.</p>
          <form action={deleteVendor}>
            <input type="hidden" name="id" value={v.id} />
            <button type="submit" className="danger">Delete {v.name}</button>
          </form>
        </div>
      )}
    </>
  );
}
