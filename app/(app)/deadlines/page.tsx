import Link from "next/link";
import { revalidatePath } from "next/cache";
import { can, requireArea } from "@/lib/access";
import { supabaseServer } from "@/lib/supabase/server";
import { daysUntil, dueLabel, fmtDate, must, str, strOrNull, todayIn } from "@/lib/format";

async function addDeadline(fd: FormData) {
  "use server";
  const ctx = await requireArea("deadlines", "edit");
  const supabase = await supabaseServer();
  must(
    await supabase.from("deadlines").insert({
      wedding_id: ctx.wedding.id,
      title: str(fd.get("title")),
      due_date: str(fd.get("due_date")),
      owed_by: strOrNull(fd.get("owed_by")),
      vendor_id: strOrNull(fd.get("vendor_id")),
      notes: strOrNull(fd.get("notes")),
    })
  );
  revalidatePath("/deadlines");
}

async function setDone(fd: FormData) {
  "use server";
  const ctx = await requireArea("deadlines", "edit");
  const supabase = await supabaseServer();
  const done = str(fd.get("done")) === "1";
  must(
    await supabase
      .from("deadlines")
      .update({ completed_on: done ? todayIn(ctx.wedding.timezone) : null })
      .eq("id", str(fd.get("id")))
      .eq("wedding_id", ctx.wedding.id)
  );
  revalidatePath("/deadlines");
}

async function deleteDeadline(fd: FormData) {
  "use server";
  const ctx = await requireArea("deadlines", "edit");
  const supabase = await supabaseServer();
  must(await supabase.from("deadlines").delete().eq("id", str(fd.get("id"))).eq("wedding_id", ctx.wedding.id));
  revalidatePath("/deadlines");
}

export default async function DeadlinesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireArea("deadlines");
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const editable = can(ctx, "deadlines", "edit");
  const supabase = await supabaseServer();
  const tz = ctx.wedding.timezone;

  const [{ data: rows }, { data: contacts }, { data: vendors }] = await Promise.all([
    supabase
      .from("deadlines")
      .select("id, title, due_date, completed_on, notes, contact:contacts!owed_by(name), vendors(name)")
      .eq("wedding_id", ctx.wedding.id)
      .order("due_date"),
    supabase.from("contacts").select("id, name").eq("wedding_id", ctx.wedding.id).order("name"),
    // Only people with vendor access get the vendor picker; RLS returns nothing otherwise.
    supabase.from("vendors").select("id, name").eq("wedding_id", ctx.wedding.id).order("name"),
  ]);

  const all = (rows ?? []) as any[];
  const shown = showAll ? all : all.filter((r) => !r.completed_on);

  return (
    <>
      <div className="row">
        <h1>Deadlines</h1>
        <Link href={showAll ? "/deadlines" : "/deadlines?show=all"}>{showAll ? "Hide completed" : "Show completed"}</Link>
      </div>

      <div className="card">
        {shown.length === 0 ? (
          <p className="muted">{showAll ? "No deadlines yet." : "Nothing outstanding."}</p>
        ) : (
          <table>
            <tbody>
              {shown.map((r) => {
                const n = daysUntil(r.due_date, tz);
                const done = !!r.completed_on;
                return (
                  <tr key={r.id}>
                    <td style={done ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                      {r.title}
                      <div className="muted">
                        {r.contact?.name ? `Owed by ${r.contact.name}` : "No one assigned"}
                        {r.vendors?.name ? ` · ${r.vendors.name}` : ""}
                      </div>
                      {r.notes && <div className="muted">{r.notes}</div>}
                    </td>
                    <td className={done ? "good" : n < 0 ? "bad" : n <= 7 ? "warn" : ""}>
                      {fmtDate(r.due_date)}
                      <div>{done ? `Done ${fmtDate(r.completed_on)}` : dueLabel(n)}</div>
                    </td>
                    {editable && (
                      <td className="num">
                        <form action={setDone} style={{ display: "inline" }}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="done" value={done ? "0" : "1"} />
                          <button type="submit" className="secondary">{done ? "Reopen" : "Mark done"}</button>
                        </form>{" "}
                        <form action={deleteDeadline} style={{ display: "inline" }}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" className="link">Delete</button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editable && (
        <div className="card">
          <h2>Add a deadline</h2>
          <form action={addDeadline} className="inline">
            <label>What<input name="title" required placeholder="Final guest count to caterer" /></label>
            <label>Due date<input name="due_date" type="date" required /></label>
            <label>
              Who owes it
              <select name="owed_by" defaultValue="">
                <option value="">Nobody yet</option>
                {(contacts ?? []).map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </label>
            {(vendors ?? []).length > 0 && (
              <label>
                Vendor
                <select name="vendor_id" defaultValue="">
                  <option value="">None</option>
                  {(vendors ?? []).map((v: any) => (<option key={v.id} value={v.id}>{v.name}</option>))}
                </select>
              </label>
            )}
            <label>Notes<input name="notes" /></label>
            <button type="submit">Add</button>
          </form>
        </div>
      )}
    </>
  );
}
