import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "@/types";

export async function getCategories(client: SupabaseClient): Promise<Category[]> {
  const { data, error } = await client.from("categories").select("id, name, slug").order("name");

  if (error) throw new Error(error.message);
  return data;
}
