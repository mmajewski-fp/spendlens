import type { APIRoute } from "astro";
import { z } from "zod";
import { createGoal } from "@/lib/services/savings-goals";
import { createClient } from "@/lib/supabase";
import type { SavingsGoal } from "@/types";

export const prerender = false;

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const createGoalSchema = z.object({
  name: z.string().trim().min(1, "Goal name is required").max(100, "Goal name must be at most 100 characters"),
  target_amount_dollars: z.number().positive("Target amount must be greater than 0"),
  target_date: z
    .string()
    .regex(dateRegex, "Target date must be in YYYY-MM-DD format")
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return parsed.getTime() > today.getTime();
    }, "Target date must be in the future"),
});

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
    const goal: SavingsGoal = await createGoal(supabase, {
      name: parsed.data.name,
      target_amount: targetAmountInCents,
      target_date: parsed.data.target_date,
    });
    return jsonResponse({ goal }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create savings goal";
    if (message.includes("3 active savings goals")) {
      return jsonResponse({ error: "You have reached the maximum of 3 active savings goals." }, 409);
    }
    return jsonResponse({ error: message }, 500);
  }
};
