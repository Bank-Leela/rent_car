// Canned deny reasons for the approver. Keys map to the i18n strings
// `approverActions.denyPresets.<key>`; the picked text becomes the
// requester-facing denialReason, so each must read clearly on its own.
export const DENY_PRESET_KEYS = [
  "noVehicle",
  "leadTime",
  "duplicate",
  "outOfPolicy",
  "missingDetails",
] as const;

export type DenyPresetKey = (typeof DENY_PRESET_KEYS)[number];
