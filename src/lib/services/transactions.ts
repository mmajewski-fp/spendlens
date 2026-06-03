import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionWithCategory, Transaction } from "@/types";

export type { TransactionWithCategory };

export async function getUserTransactions(client: SupabaseClient, since?: string): Promise<TransactionWithCategory[]> {
  let query = client
    .from("transactions")
    .select("*, category:categories(name, slug)")
    .order("date", { ascending: false });

  if (since) query = query.gte("date", since);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as TransactionWithCategory[];
}

export async function createTransactions(
  client: SupabaseClient,
  rows: Omit<Transaction, "id" | "created_at">[],
): Promise<Transaction[]> {
  const { data, error } = await client
    .from("transactions")
    .upsert(rows, { onConflict: "user_id,external_id", ignoreDuplicates: true })
    .select();

  if (error) throw new Error(error.message);
  return data as Transaction[];
}
