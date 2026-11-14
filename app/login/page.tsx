import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

async function sendLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (email) {
    // Only invited people (and the owner on first run) get a link. The reply is
    // identical either way, so nobody can use this form to discover who is invited.
    const admin = supabaseAdmin();
    const { data } = await admin.from("wedding_members").select("id").eq("email", email).limit(1);
    const isOwner = email === process.env.OWNER_EMAIL?.trim().toLowerCase();
    if ((data?.length ?? 0) > 0 || isOwner) {
      // Public sign-ups are switched off in Supabase, so the account is created here,
      // and only for emails that passed the check above. "Already registered" is expected.
      await admin.auth.admin.createUser({ email, email_confirm: true });
      const supabase = await supabaseServer();
      await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    }
  }
  redirect("/login?sent=1");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="center">
      <div className="card">
        <h1>Wedding planner</h1>
        {sp.sent ? (
          <p>If that email has been invited, a sign-in link is on its way. It can take a minute to arrive.</p>
        ) : (
          <form action={sendLink} style={{ display: "grid", gap: 12 }}>
            {sp.error && <div className="notice">That link didn’t work or has expired. Request a new one.</div>}
            <label>
              Your email
              <input name="email" type="email" required autoComplete="email" autoFocus />
            </label>
            <button type="submit">Email me a sign-in link</button>
          </form>
        )}
      </div>
    </div>
  );
}
