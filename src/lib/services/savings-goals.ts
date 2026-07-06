import type { SupabaseClient } from "@supabase/supabase-js";
import type { SavingsGoal } from "@/types";

export async function getUserGoals(client: SupabaseClient): Promise<SavingsGoal[]> {
  const { data, error } = await client.from("savings_goals").select("*").order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data as SavingsGoal[];
}

interface SingleRowResult {
  data: SavingsGoal | null;
  error: { message: string } | null;
}

export async function createGoal(
  client: SupabaseClient,
  userId: string,
  goalData: Omit<SavingsGoal, "id" | "user_id" | "created_at">,
): Promise<SavingsGoal> {
  const result = (await client
    .from("savings_goals")
    .insert({ ...goalData, user_id: userId })
    .select()
    .single()) as SingleRowResult;

  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Failed to create savings goal");
  return result.data;
}

export async function getGoalById(client: SupabaseClient, id: string): Promise<SavingsGoal | null> {
  const result = (await client.from("savings_goals").select("*").eq("id", id).maybeSingle()) as SingleRowResult;

  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function updateGoal(
  client: SupabaseClient,
  id: string,
  fields: Pick<SavingsGoal, "name" | "target_amount" | "target_date">,
): Promise<SavingsGoal> {
  const result = (await client.from("savings_goals").update(fields).eq("id", id).select().single()) as SingleRowResult;

  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Failed to update savings goal");
  return result.data;
}

export async function deleteGoal(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("savings_goals").delete().eq("id", id);

  if (error) throw new Error(error.message);
}
