import type { APIRoute } from "astro";
import { getUserTransactions } from "@/lib/services/transactions";
import { toCsv } from "@/lib/transactions-csv";
import { createClient } from "@/lib/supabase";
import { jsonResponse } from "@/lib/api";

export const prerender = false;

/** Today's date as YYYY-MM-DD from UTC components (server runs UTC on Vercel). */
function todayUtc(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase is not configured" }, 500);
  }

  try {
    const transactions = await getUserTransactions(supabase);
    const csv = toCsv(transactions);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="spendlens-transactions-${todayUtc()}.csv"`,
      },
    });
  } catch (error) {
    // Log the real error server-side; return a generic message so raw DB
    // phrasing (constraint/column names) never reaches the client.
    console.error("GET /api/transactions/export failed:", error);
    return jsonResponse({ error: "Failed to export transactions" }, 500);
  }
};
