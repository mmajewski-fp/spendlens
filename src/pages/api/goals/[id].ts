import type { APIRoute } from "astro";
import { z } from "zod";
import { deleteGoal, getGoalById, updateGoal } from "@/lib/services/savings-goals";
import { createClient } from "@/lib/supabase";
import { jsonResponse } from "@/lib/api";
import { goalNameSchema, isoDateSchema, isFutureDate, targetAmountDollarsSchema } from "@/lib/goal-validation";
import type { SavingsGoal } from "@/types";

export const prerender = false;

// Edit reuses the create name/amount rules and the date-format check, but the
// "must be in the future" rule is applied conditionally in the handler (only when
// the date actually changes) so an already-expired goal stays renameable.
const updateGoalSchema = z.object({
  name: goalNameSchema,
  target_amount_dollars: targetAmountDollarsSchema,
  target_date: isoDateSchema,
});

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase is not configured" }, 500);
  }

  const id = context.params.id;
  if (!id) {
    return jsonResponse({ error: "Missing goal id" }, 400);
  }

  try {
    // Idempotent: RLS scopes the delete to the owner, so a missing or
    // other-user id is a silent no-op that still succeeds.
    await deleteGoal(supabase, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete savings goal";
    return jsonResponse({ error: message }, 500);
  }
};

export const PUT: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase is not configured" }, 500);
  }

  const id = context.params.id;
  if (!id) {
    return jsonResponse({ error: "Missing goal id" }, 400);
  }

  let requestBody: unknown;
  try {
    requestBody = await context.request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  try {
    // Read-then-update: RLS scopes visibility to the owner, so a missing or
    // other-user id resolves to null → 404 (rather than a silent 0-row update).
    // The existence check runs before validation so a 404 isn't masked by a 400.
    const existing = await getGoalById(supabase, id);
    if (!existing) {
      return jsonResponse({ error: "Savings goal not found" }, 404);
    }

    const parsed = updateGoalSchema.safeParse(requestBody);
    if (!parsed.success) {
      return jsonResponse({ error: parsed.error.issues[0].message }, 400);
    }

    // Future-date rule applies only when the date is actually changing — an
    // already-expired goal must stay editable (e.g. renaming it).
    if (parsed.data.target_date !== existing.target_date && !isFutureDate(parsed.data.target_date)) {
      return jsonResponse({ error: "Target date must be in the future" }, 400);
    }

    const goal: SavingsGoal = await updateGoal(supabase, id, {
      name: parsed.data.name,
      target_amount: Math.round(parsed.data.target_amount_dollars * 100),
      target_date: parsed.data.target_date,
    });
    return jsonResponse({ goal }, 200);
  } catch (error) {
    // Log the real error server-side; return a generic message so raw DB
    // phrasing (constraint/column names) never reaches the client.
    console.error("PUT /api/goals/[id] failed:", error);
    return jsonResponse({ error: "Failed to update savings goal" }, 500);
  }
};
