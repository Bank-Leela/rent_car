// Runtime feature flags.

// The placement simulator (/admin/simulate) is a debugging tool, not part of
// P'Top's daily flow — kept OUT of production but available for debugging.
// On in dev by default; in production only when ENABLE_SIMULATION=true.
export function isSimulationEnabled(): boolean {
  if (process.env.ENABLE_SIMULATION === "true") return true;
  return process.env.NODE_ENV !== "production";
}
