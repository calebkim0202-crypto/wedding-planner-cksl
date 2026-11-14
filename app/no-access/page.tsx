import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

async function signOut() {
  "use server";
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

export default function NoAccess() {
  return (
    <div className="center">
      <div className="card">
        <h1>No access</h1>
        <p>This email hasn’t been invited to the wedding planner. Ask the person who runs it to invite you.</p>
        <form action={signOut}>
          <button type="submit" className="secondary">Sign out</button>
        </form>
      </div>
    </div>
  );
}
