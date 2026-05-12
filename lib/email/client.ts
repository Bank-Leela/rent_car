import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "Vehicle Booking <noreply@example.com>";

const resend = apiKey ? new Resend(apiKey) : null;

export type EmailMessage = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
};

export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!resend) {
    console.log("[email:console]", {
      to: msg.to,
      subject: msg.subject,
      preview: msg.text.slice(0, 200),
    });
    return;
  }
  const { error } = await resend.emails.send({
    from,
    to: Array.isArray(msg.to) ? msg.to : [msg.to],
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  if (error) {
    // Notifications must never break the booking flow. Log and continue
    // so the action that triggered the email still succeeds.
    console.error("[email:resend] send failed", {
      to: msg.to,
      subject: msg.subject,
      error,
    });
  }
}
