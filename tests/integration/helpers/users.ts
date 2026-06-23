import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inject } from "vitest";

export interface TestUser {
  id: string;
  email: string;
  /** Anon-key client signed in AS this user — every query runs under their JWT (RLS applies). */
  client: SupabaseClient;
}

const PASSWORD = "test-password-123"; // ≥ 6 chars (config.toml minimum_password_length = 6)

function conn() {
  return inject("supabase");
}

/**
 * Service-role (secret) client — bypasses RLS. Use for SETUP/TEARDOWN ONLY
 * (creating + deleting users). NEVER assert through it.
 */
export function adminClient(): SupabaseClient {
  const { url, serviceRoleKey } = conn();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as SupabaseClient;
}

/** Create a fresh confirmed user and return an anon client authenticated AS them. */
export async function createTestUser(admin: SupabaseClient): Promise<TestUser> {
  const { url, anonKey } = conn();
  const email = `user-${crypto.randomUUID()}@example.test`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as SupabaseClient;
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;

  return { id: data.user.id, email, client };
}

/** Delete a user; FK ON DELETE CASCADE removes their goals + transactions. */
export async function deleteTestUser(admin: SupabaseClient, id: string): Promise<void> {
  await admin.auth.admin.deleteUser(id);
}
