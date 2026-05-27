import type { SupabaseClient } from "@supabase/supabase-js";
import type { SavingsGoal } from "@/types";

export async function getUserGoals(client: SupabaseClient): Promise<SavingsGoal[]> {
  const { data, error } = await client.from("savings_goals").select("*").order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data as SavingsGoal[];
}

interface InsertResult {
  data: SavingsGoal | null;
  error: { message: string } | null;
}

export async function createGoal(
  client: SupabaseClient,
  goalData: Omit<SavingsGoal, "id" | "user_id" | "created_at">,
): Promise<SavingsGoal> {
  const result = (await client.from("savings_goals").insert(goalData).select().single()) as InsertResult;

  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Failed to create savings goal");
  return result.data;
}

export async function deleteGoal(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("savings_goals").delete().eq("id", id);

  if (error) throw new Error(error.message);
}
