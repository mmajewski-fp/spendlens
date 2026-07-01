import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { importTransactions } from "@/lib/services/import-transactions";

export const prerender = false;

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Today's date as YYYY-MM-DD in UTC. Computed at the I/O boundary (the route),
 * not inside the pure generator — the generator stays deterministic on an
 * injected anchor. UTC keeps it TZ-independent (context/foundation/lessons.md).
 */
function todayUtc(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase is not configured" }, 500);
  }

  try {
    const { imported } = await importTransactions(supabase, context.locals.user.id, todayUtc());
    return jsonResponse({ imported }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import transactions";
    return jsonResponse({ error: message }, 500);
  }
};
