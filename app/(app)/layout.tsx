import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, can } from "@/lib/access";
import { supabaseServer } from "@/lib/supabase/server";

async function signOut() {
  "use server";
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  if (!ctx) {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email?.toLowerCase() === process.env.OWNER_EMAIL?.trim().toLowerCase()) redirect("/setup");
    redirect("/no-access");
  }

  return (
    <>
      <nav className="nav">
        <Link href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
          {ctx.wedding.name}
        </Link>
        {can(ctx, "vendors") && <Link href="/vendors">Vendors</Link>}
        {can(ctx, "payments") && <Link href="/payments">Payments</Link>}
        {can(ctx, "deadlines") && <Link href="/deadlines">Deadlines</Link>}
        {ctx.role === "owner" && <Link href="/people">People</Link>}
        <form action={signOut}>
          <button type="submit" className="link">Sign out</button>
        </form>
      </nav>
      <main className="wrap">{children}</main>
    </>
  );
}
