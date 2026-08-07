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
    // No provider configured. Log that a mail was SUPPRESSED — never its body.
    //
    // The body used to be previewed here, first 200 characters. For a password
    // reset that is the reset URL including the single-use token, written into
    // the systemd journal of a box several people can read. Anyone with journal
    // access could take over any account, and the deploy kit never mentioned
    // RESEND_API_KEY, so a by-the-book install ran exactly this path.
    console.warn(
      `[email:SUPPRESSED] no RESEND_API_KEY — "${msg.subject}" was NOT delivered to ${
        Array.isArray(msg.to) ? msg.to.join(", ") : msg.to
      }`,
    );
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[email:SUPPRESSED] Set RESEND_API_KEY and EMAIL_FROM. Until then password " +
          "reset is non-functional: users receive nothing and the link is not recoverable.",
      );
    }
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
