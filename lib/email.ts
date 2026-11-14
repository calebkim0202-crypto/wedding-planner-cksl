import { Resend } from "resend";

/** Send one email through Resend. Throws on failure. Returns the Resend message id. */
export async function sendEmail(to: string, subject: string, html: string) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM!,
    to,
    subject,
    html,
  });
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export function layout(body: string) {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">${body}
  <p style="color:#9ca3af;font-size:12px;margin-top:32px">Sent by your wedding planner.</p></div>`;
}
