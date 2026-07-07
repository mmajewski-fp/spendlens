import path from "node:path";

// Shared filesystem paths for the E2E auth artifacts. Kept in a plain module (no
// test() calls) so playwright.config.ts can import them without tripping Playwright's
// "test() called in a config file" guard.
const AUTH_DIR = path.join(import.meta.dirname, "..", ".auth");
export const STORAGE_STATE = path.join(AUTH_DIR, "fault-user-state.json");
export const USER_ID_FILE = path.join(AUTH_DIR, "fault-user-id.txt");
export { AUTH_DIR };
