import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Magic links land here. The Supabase "Magic Link" email template must point at
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 * (see README). That form works even if the link is opened on a different
 * device or browser from the one that asked for it.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await supabaseServer();
  let failed = true;

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    failed = !!error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = !!error;
  }

  return NextResponse.redirect(new URL(failed ? "/login?error=1" : "/", req.url));
}
