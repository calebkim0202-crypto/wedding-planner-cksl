import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";

export type Area = "vendors" | "payments" | "deadlines";
export type Level = "none" | "view" | "edit";
export const AREAS: Area[] = ["vendors", "payments", "deadlines"];

const rank: Record<Level, number> = { none: 0, view: 1, edit: 2 };

export type Ctx = {
  userId: string;
  email: string;
  memberId: string;
  role: "owner" | "member";
  wedding: { id: string; name: string; wedding_date: string | null; currency: string; timezone: string };
  access: Record<Area, Level>;
};

/** Who is signed in, which wedding they belong to, and what they may see. Null if not invited. */
export const getContext = cache(async (): Promise<Ctx | null> => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  const { data: rows } = await supabase
    .from("wedding_members")
    .select("id, role, weddings(id, name, wedding_date, currency, timezone)")
    .eq("email", user.email.toLowerCase())
    .limit(1);
  const member: any = rows?.[0];
  if (!member || !member.weddings) return null;

  let access: Record<Area, Level> = { vendors: "edit", payments: "edit", deadlines: "edit" };
  if (member.role !== "owner") {
    access = { vendors: "none", payments: "none", deadlines: "none" };
    const { data: grants } = await supabase.from("member_access").select("area, level").eq("member_id", member.id);
    for (const g of grants ?? []) access[g.area as Area] = g.level as Level;
  }

  return {
    userId: user.id,
    email: user.email,
    memberId: member.id,
    role: member.role,
    wedding: member.weddings,
    access,
  };
});

export async function requireContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect("/no-access");
  return ctx;
}

export function can(ctx: Ctx, area: Area, need: Level = "view") {
  return rank[ctx.access[area]] >= rank[need];
}

/** Use at the top of pages and server actions. Sends people without access back to the dashboard. */
export async function requireArea(area: Area, need: Level = "view") {
  const ctx = await requireContext();
  if (!can(ctx, area, need)) redirect("/?denied=" + area);
  return ctx;
}

export async function requireOwner() {
  const ctx = await requireContext();
  if (ctx.role !== "owner") redirect("/?denied=people");
  return ctx;
}
