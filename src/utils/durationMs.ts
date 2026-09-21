const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parses a short duration string like "15m", "30d", "45s" into milliseconds. */
export function durationMs(input: string): number {
  const match = /^(\d+)([smhd])$/.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid duration format: "${input}" (expected e.g. "15m", "30d")`);
  }
  const [, value, unit] = match;
  return Number(value) * UNIT_MS[unit];
}
