import { z } from "zod";

/** ISO calendar-date format: YYYY-MM-DD. */
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

/** Trimmed goal name, 1–100 chars. Shared by the create (POST) and edit (PUT) routes. */
export const goalNameSchema = z
  .string()
  .trim()
  .min(1, "Goal name is required")
  .max(100, "Goal name must be at most 100 characters");

/** Target amount in dollars (converted to integer cents by the route). */
export const targetAmountDollarsSchema = z.number().positive("Target amount must be greater than 0");

/** A YYYY-MM-DD string that is also a real calendar date. Does NOT enforce future-ness. */
export const isoDateSchema = z
  .string()
  .regex(dateRegex, "Target date must be in YYYY-MM-DD format")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), "Target date must be a valid date");

/**
 * True when `value` (YYYY-MM-DD) is strictly after today (local midnight).
 * Create requires this unconditionally; edit only when the date is changed.
 */
export function isFutureDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed.getTime() > today.getTime();
}
