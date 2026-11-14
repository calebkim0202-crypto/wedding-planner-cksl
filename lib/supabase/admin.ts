import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses Row Level Security, so it is only for
 * server code that has already decided the caller is allowed: the login
 * check, first-run setup and the reminder cron. Never import it in a client component.
 */
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
