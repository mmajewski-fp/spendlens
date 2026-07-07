// Launches the E2E app server for the "SSR error surface" risk: the fault-proxy plus
// an `astro dev` instance whose SUPABASE_URL points at that proxy. Playwright manages
// this as its single webServer; both children die when Playwright sends SIGTERM.
import { spawn } from "node:child_process";

const PROXY_PORT = process.env.PROXY_PORT ?? "54399";
const APP_PORT = process.env.E2E_APP_PORT ?? "4399";
// Standard local `supabase start` demo anon key (not a secret) — mirrors local-supabase.ts.
const ANON_KEY =
  process.env.E2E_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const children = [];
function start(cmd, args, extraEnv) {
  const child = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...extraEnv } });
  children.push(child);
  child.on("exit", (code) => {
    // If one process dies, tear the whole server down so Playwright fails fast.
    shutdown(code ?? 1);
  });
}

function shutdown(code) {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code ?? 0);
}
process.on("SIGTERM", () => {
  shutdown(0);
});
process.on("SIGINT", () => {
  shutdown(0);
});

start("node", ["tests/e2e/support/fault-proxy.mjs"], { PROXY_PORT });
start("npx", ["astro", "dev", "--port", APP_PORT], {
  SUPABASE_URL: `http://127.0.0.1:${PROXY_PORT}`,
  SUPABASE_KEY: ANON_KEY,
});
