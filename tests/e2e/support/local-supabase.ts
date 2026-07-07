import { createClient } from "@supabase/supabase-js";

/**
 * Local-Supabase constants + user lifecycle for the E2E suite.
 *
 * These are the standard `supabase start` demo keys (identical on every local
 * install; `npx supabase status -o env` prints them). They are NOT secrets — they
 * only unlock the disposable local dev database, never a real project.
 */
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
export const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/** Emails with this prefix are the ones the fault-proxy fails the transactions read for. */
export const FAULT_EMAIL_PREFIX = "e2e-fault-";
const PASSWORD = "test-password-123"; // ≥ 6 chars (config.toml minimum_password_length)

/** Service-role client — bypasses RLS. Setup/teardown ONLY (create/delete users). */
function adminClient() {
  return createClient(LOCAL_SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** Create a fresh confirmed user whose email carries the fault prefix. */
export async function createFaultUser(): Promise<TestUser> {
  const admin = adminClient();
  const email = `${FAULT_EMAIL_PREFIX}${crypto.randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return { id: data.user.id, email, password: PASSWORD };
}

/** Delete a user; FK ON DELETE CASCADE removes any of their rows. */
export async function deleteUser(id: string): Promise<void> {
  const admin = adminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) throw error;
}
