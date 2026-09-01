import type { APIRoute } from "astro";
import { z } from "zod";
import { createGoal } from "@/lib/services/savings-goals";
import { createClient } from "@/lib/supabase";
import { jsonResponse } from "@/lib/api";
import { goalNameSchema, isoDateSchema, isFutureDate, targetAmountDollarsSchema } from "@/lib/goal-validation";
import type { SavingsGoal } from "@/types";

export const prerender = false;

const createGoalSchema = z.object({
  name: goalNameSchema,
  target_amount_dollars: targetAmountDollarsSchema,
  target_date: isoDateSchema.refine(isFutureDate, "Target date must be in the future"),
});

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase is not configured" }, 500);
  }

  let requestBody: unknown;
  try {
    requestBody = await context.request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const parsed = createGoalSchema.safeParse(requestBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return jsonResponse({ error: issue.message }, 400);
  }

  const targetAmountInCents = Math.round(parsed.data.target_amount_dollars * 100);

  try {
    const goal: SavingsGoal = await createGoal(supabase, context.locals.user.id, {
      name: parsed.data.name,
      target_amount: targetAmountInCents,
      target_date: parsed.data.target_date,
    });
    return jsonResponse({ goal }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("3 active savings goals")) {
      return jsonResponse({ error: "You have reached the maximum of 3 active savings goals." }, 409);
    }
    // Log the real error server-side; return a generic message so raw DB
    // phrasing (constraint/column names) never reaches the client.
    console.error("POST /api/goals failed:", error);
    return jsonResponse({ error: "Failed to create savings goal" }, 500);
  }
};
