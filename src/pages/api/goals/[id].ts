import type { APIRoute } from "astro";
import { deleteGoal } from "@/lib/services/savings-goals";
import { createClient } from "@/lib/supabase";
import { jsonResponse } from "@/lib/api";

export const prerender = false;

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
