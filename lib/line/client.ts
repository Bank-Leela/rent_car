// LINE Messaging API client. Phase 0/1: stub. Real integration in Phase 5.
// Keep the interface stable so callers don't change when the implementation lands.

export type LineNotification = {
  toLineUserId: string;
  message: string;
  context?: Record<string, unknown>;
};

export async function sendLineNotification(payload: LineNotification): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  console.log("[line:stub] would send notification", payload);
}
