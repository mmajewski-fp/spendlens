import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Transaction } from "@/types";

export type TransactionWithCategory = Transaction & {
  category: Pick<Category, "name" | "slug"> | null;
};

export async function getUserTransactions(client: SupabaseClient): Promise<TransactionWithCategory[]> {
  const { data, error } = await client
    .from("transactions")
    .select("*, category:categories(name, slug)")
    .order("date", { ascending: false });

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
