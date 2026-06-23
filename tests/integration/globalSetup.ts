import { execSync } from "node:child_process";

import type { TestProject } from "vitest/node";

interface SupabaseStatus {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

/**
 * Boot local Supabase (idempotent) and publish its connection info to the test
 * workers via Vitest's provide/inject (process.env from globalSetup does NOT
 * reliably reach forked workers). Requires Docker + the `supabase` CLI devDep.
 */
export default function setup(project: TestProject): void {
  try {
    execSync("npx supabase status -o json", { stdio: "pipe" });
  } catch {
    execSync("npx supabase start", { stdio: "inherit" });
  }
  const raw = execSync("npx supabase status -o json", { encoding: "utf8" });
  const status = JSON.parse(raw) as SupabaseStatus;

  project.provide("supabase", {
    url: status.API_URL,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
  });
}

declare module "vitest" {
  export interface ProvidedContext {
    supabase: { url: string; anonKey: string; serviceRoleKey: string };
  }
}
