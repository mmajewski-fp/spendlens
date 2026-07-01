/**
 * Import orchestrator (S-01).
 *
 * The one impure step: wire the pure generator + categorizer to persistence.
 * Resolves category slugs to ids, shapes rows, and hands them to the idempotent
 * `createTransactions` (upsert on UNIQUE(user_id, external_id)). Re-running with
 * the same `(userId, today→external_id)` inserts nothing new, so `imported`
 * reports only newly-landed rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transaction } from "@/types";
import { getCategories } from "@/lib/services/categories";
import { createTransactions } from "@/lib/services/transactions";
import { generateTransactions } from "@/lib/services/simulated-bank";
import { categorize, OTHER_SLUG } from "@/lib/services/transaction-categorizer";

export interface ImportResult {
  /** Count of newly-inserted rows (0 on a re-connect — duplicates are ignored). */
  imported: number;
}

export async function importTransactions(client: SupabaseClient, userId: string, today: string): Promise<ImportResult> {
  const categories = await getCategories(client);
  const slugToId = new Map(categories.map((c) => [c.slug, c.id]));
  // Fallback chain: mapped slug → its id, else the seeded `other` id, else null
  // (category_id is nullable and downstream treats null as Other).
  const otherId = slugToId.get(OTHER_SLUG) ?? null;

  const rows: Omit<Transaction, "id" | "created_at">[] = generateTransactions(userId, today).map((t) => ({
    user_id: userId,
    category_id: slugToId.get(categorize(t.description)) ?? otherId,
    amount: t.amount,
    type: t.type,
    description: t.description,
    date: t.date,
    external_id: t.external_id,
  }));

  const inserted = await createTransactions(client, rows);
  return { imported: inserted.length };
}
