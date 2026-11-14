import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { must, str, strOrNull } from "@/lib/format";

async function currentUser() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");
  return user as typeof user & { email: string };
}

async function createWedding(formData: FormData) {
  "use server";
  const user = await currentUser();
  if (user.email.toLowerCase() !== process.env.OWNER_EMAIL?.trim().toLowerCase()) redirect("/no-access");

  const admin = supabaseAdmin();
  const email = user.email.toLowerCase();
  const { data: existing } = await admin.from("wedding_members").select("id").eq("email", email).limit(1);
  if (existing?.length) redirect("/");

  const wedding = must(
    await admin
      .from("weddings")
      .insert({
        name: str(formData.get("name")) || "Our wedding",
        wedding_date: strOrNull(formData.get("date")),
        timezone: str(formData.get("timezone")) || "Australia/Sydney",
        currency: (str(formData.get("currency")) || "AUD").toUpperCase(),
        created_by: user.id,
      })
      .select("id")
      .single()
  );
  const member = must(
    await admin
      .from("wedding_members")
      .insert({ wedding_id: wedding.id, email, role: "owner", display_name: strOrNull(formData.get("you")), invited_by: user.id })
      .select("id")
      .single()
  );
  must(
    await admin
      .from("contacts")
      .insert({ wedding_id: wedding.id, name: str(formData.get("you")) || email, email, member_id: member.id })
  );
  redirect("/");
}

export default async function SetupPage() {
  const user = await currentUser();
  if (user.email.toLowerCase() !== process.env.OWNER_EMAIL?.trim().toLowerCase()) redirect("/no-access");

  const admin = supabaseAdmin();
  const { data: existing } = await admin.from("wedding_members").select("id").eq("email", user.email.toLowerCase()).limit(1);
  if (existing?.length) redirect("/");

  return (
    <div className="center">
      <div className="card">
        <h1>Set up your wedding</h1>
        <form action={createWedding} style={{ display: "grid", gap: 12 }}>
          <label>
            Your name
            <input name="you" required />
          </label>
          <label>
            Wedding name
            <input name="name" placeholder="Sam & Alex" required />
          </label>
          <label>
            Wedding date
            <input name="date" type="date" />
          </label>
          <label>
            Timezone (reminders go out by this clock)
            <input name="timezone" defaultValue="Australia/Sydney" required />
          </label>
          <label>
            Currency
            <input name="currency" defaultValue="AUD" maxLength={3} required />
          </label>
          <button type="submit">Create</button>
        </form>
      </div>
    </div>
  );
}
