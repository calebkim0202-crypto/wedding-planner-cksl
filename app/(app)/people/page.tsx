import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AREAS, requireOwner, type Area, type Level } from "@/lib/access";
import { supabaseServer } from "@/lib/supabase/server";
import { esc, must, str, strOrNull } from "@/lib/format";
import { layout, sendEmail } from "@/lib/email";

const LABELS: Record<Area, string> = { vendors: "Vendors", payments: "Payments", deadlines: "Deadlines" };
const LEVELS: Level[] = ["none", "view", "edit"];
const levelOf = (v: FormDataEntryValue | null): Level => (LEVELS.includes(str(v) as Level) ? (str(v) as Level) : "none");

async function applyAccess(supabase: Awaited<ReturnType<typeof supabaseServer>>, memberId: string, fd: FormData) {
  for (const area of AREAS) {
    const level = levelOf(fd.get(`area_${area}`));
    if (level === "none") {
      must(await supabase.from("member_access").delete().eq("member_id", memberId).eq("area", area));
    } else {
      must(await supabase.from("member_access").upsert({ member_id: memberId, area, level }, { onConflict: "member_id,area" }));
    }
  }
}

async function invite(fd: FormData) {
  "use server";
  const ctx = await requireOwner();
  const supabase = await supabaseServer();
  const email = str(fd.get("email")).toLowerCase();
  const name = strOrNull(fd.get("name"));

  const { data: member, error } = await supabase
    .from("wedding_members")
    .insert({ wedding_id: ctx.wedding.id, email, display_name: name, invited_by: ctx.userId })
    .select("id")
    .single();
  if (error || !member) redirect("/people?error=" + encodeURIComponent(error?.message.includes("duplicate") ? "That email is already invited." : "Could not invite."));

  await applyAccess(supabase, member.id, fd);
  // They can also be assigned things, so they get a contact too.
  must(
    await supabase
      .from("contacts")
      .upsert({ wedding_id: ctx.wedding.id, name: name ?? email, email, member_id: member.id }, { onConflict: "wedding_id,email" })
  );

  let mailed = "1";
  try {
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    await sendEmail(
      email,
      `You’ve been invited to ${ctx.wedding.name}`,
      layout(
        `<h2 style="margin:0 0 12px">You’re invited</h2>
         <p>You’ve been given access to the planning dashboard for <strong>${esc(ctx.wedding.name)}</strong>.</p>
         <p>There’s no password. Go to the link below, enter this email address, and we’ll email you a sign-in link.</p>
         <p><a href="${esc(site)}/login" style="display:inline-block;padding:10px 16px;background:#7c5c4a;color:#fff;border-radius:8px;text-decoration:none">Open the dashboard</a></p>`
      )
    );
  } catch (e) {
    console.error("invite email failed", e);
    mailed = "0";
  }
  revalidatePath("/people");
  redirect(`/people?invited=${encodeURIComponent(email)}&mailed=${mailed}`);
}

async function saveAccess(fd: FormData) {
  "use server";
  await requireOwner();
  const supabase = await supabaseServer();
  await applyAccess(supabase, str(fd.get("member_id")), fd);
  revalidatePath("/people");
}

async function removeMember(fd: FormData) {
  "use server";
  const ctx = await requireOwner();
  const supabase = await supabaseServer();
  must(
    await supabase
      .from("wedding_members")
      .delete()
      .eq("id", str(fd.get("member_id")))
      .eq("wedding_id", ctx.wedding.id)
      .neq("role", "owner")
  );
  revalidatePath("/people");
}

async function addContact(fd: FormData) {
  "use server";
  const ctx = await requireOwner();
  const supabase = await supabaseServer();
  must(
    await supabase.from("contacts").insert({
      wedding_id: ctx.wedding.id,
      name: str(fd.get("name")),
      email: strOrNull(fd.get("email"))?.toLowerCase() ?? null,
    })
  );
  revalidatePath("/people");
}

async function deleteContact(fd: FormData) {
  "use server";
  const ctx = await requireOwner();
  const supabase = await supabaseServer();
  must(await supabase.from("contacts").delete().eq("id", str(fd.get("id"))).eq("wedding_id", ctx.wedding.id));
  revalidatePath("/people");
}

function AccessSelects({ current }: { current: Partial<Record<Area, Level>> }) {
  return (
    <div className="access">
      {AREAS.map((a) => (
        <label key={a}>
          {LABELS[a]}
          <select name={`area_${a}`} defaultValue={current[a] ?? "none"}>
            <option value="none">Can’t see</option>
            <option value="view">View only</option>
            <option value="edit">View and edit</option>
          </select>
        </label>
      ))}
    </div>
  );
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string; mailed?: string; error?: string }>;
}) {
  const ctx = await requireOwner();
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: members }, { data: grants }, { data: contacts }] = await Promise.all([
    supabase.from("wedding_members").select("id, email, display_name, role").eq("wedding_id", ctx.wedding.id).order("invited_at"),
    supabase.from("member_access").select("member_id, area, level"),
    supabase.from("contacts").select("id, name, email, member_id").eq("wedding_id", ctx.wedding.id).order("name"),
  ]);
  const grantsBy = new Map<string, Partial<Record<Area, Level>>>();
  for (const g of (grants ?? []) as any[]) {
    grantsBy.set(g.member_id, { ...(grantsBy.get(g.member_id) ?? {}), [g.area]: g.level });
  }

  return (
    <>
      <h1>People</h1>
      {sp.error && <div className="notice">{sp.error}</div>}
      {sp.invited && (
        <div className="notice">
          Invited {sp.invited}.{" "}
          {sp.mailed === "0" && "The invite email couldn’t be sent, but they can still sign in at the login page with that address."}
        </div>
      )}

      <div className="card">
        <h2>Who can sign in</h2>
        {(members ?? []).map((m: any) => (
          <div key={m.id} style={{ padding: "12px 0", borderTop: "1px solid var(--line)" }}>
            <div className="row">
              <div>
                <strong>{m.display_name ?? m.email}</strong> {m.role === "owner" && <span className="tag">Owner</span>}
                {m.display_name && <div className="muted">{m.email}</div>}
              </div>
            </div>
            {m.role === "owner" ? (
              <p className="muted">Owners can see and change everything.</p>
            ) : (
              <>
                <form action={saveAccess} style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  <input type="hidden" name="member_id" value={m.id} />
                  <AccessSelects current={grantsBy.get(m.id) ?? {}} />
                  <div><button type="submit" className="secondary">Save access</button></div>
                </form>
                <form action={removeMember} style={{ marginTop: 8 }}>
                  <input type="hidden" name="member_id" value={m.id} />
                  <button type="submit" className="link">Remove {m.display_name ?? m.email}</button>
                </form>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Invite someone</h2>
        <form action={invite} style={{ display: "grid", gap: 12 }}>
          <div className="inline">
            <label>Email<input name="email" type="email" required /></label>
            <label>Name<input name="name" /></label>
          </div>
          <AccessSelects current={{ vendors: "view", payments: "view", deadlines: "view" }} />
          <div><button type="submit">Send invite</button></div>
        </form>
      </div>

      <div className="card">
        <h2>People who can owe things</h2>
        <p className="muted">Anyone here can be picked as “who owes it” and gets the reminder emails. They don’t need to sign in.</p>
        <table>
          <tbody>
            {(contacts ?? []).map((c: any) => (
              <tr key={c.id}>
                <td>{c.name}{c.member_id && <> <span className="tag">Signs in</span></>}</td>
                <td className="muted">{c.email ?? "No email, so no reminders"}</td>
                <td className="num">
                  <form action={deleteContact}>
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" className="link">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={addContact} className="inline" style={{ marginTop: 12 }}>
          <label>Name<input name="name" required /></label>
          <label>Email<input name="email" type="email" /></label>
          <button type="submit">Add</button>
        </form>
      </div>
    </>
  );
}
