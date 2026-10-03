import type { QuietHours } from "./types.ts";

export function isQuiet(at: Date, quiet: QuietHours): boolean {
  const { startHour, endHour } = quiet;
  if (startHour === endHour) return false;
  const hour = at.getUTCHours();
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

/** The earliest time at or after `at` that falls outside the quiet window. */
export function nextAllowedTime(at: Date, quiet: QuietHours | undefined): Date {
  if (!quiet || !isQuiet(at, quiet)) return at;
  const end = new Date(at);
  end.setUTCHours(quiet.endHour, 0, 0, 0);
  if (end <= at) end.setUTCDate(end.getUTCDate() + 1);
  return end;
}
