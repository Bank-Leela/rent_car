// LINE Messaging API client. When LINE_CHANNEL_ACCESS_TOKEN is set we hit the
// real `/v2/bot/message/push` endpoint; otherwise we log the payload to the
// console so the rest of the app can be exercised without a channel.

export type LineNotification = {
  toLineUserId: string;
  message: string;
  context?: Record<string, unknown>;
};

const ENDPOINT = "https://api.line.me/v2/bot/message/push";

export async function sendLineNotification(payload: LineNotification): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV !== "test") {
      console.log("[line:stub] would send notification", payload);
    }
    return;
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: payload.toLineUserId,
      messages: [{ type: "text", text: payload.message }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[line] push failed", res.status, body);
  }
}
