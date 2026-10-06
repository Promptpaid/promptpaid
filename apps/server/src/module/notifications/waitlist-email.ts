import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendWaitlistConfirmation(
  to: string,
  name: string,
): Promise<boolean> {
  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM as string,
      to,
      subject: "You're on the PromptPaid waitlist",
      html: `<p>Hi ${escapeHtml(name)},</p>
             <p>Thanks for joining the PromptPaid waitlist. We'll email you before launch.</p>`,
    });
    if (error) {
      // The SDK returns errors instead of throwing. Log the name only, no personal data.
      console.error("waitlist email failed:", error.name);
      return false;
    }
    return true;
  } catch {
    console.error("waitlist email threw");
    return false;
  }
}