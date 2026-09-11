import { defineMiddleware } from "astro:middleware";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/recommendations", "/goals", "/transactions"];

/**
 * Upper bound for resolving the session on a request.
 *
 * supabase-js retries a failed token refresh with exponential backoff for up to
 * AUTO_REFRESH_TICK_DURATION_MS (30s). With an unreachable auth server and a stale
 * session cookie that stalls *every* SSR response — including the sign-in page and
 * POST /api/auth/signin — for ~25s. Cap it so an auth outage degrades to
 * "signed out" instead of hanging the whole app.
 */
const AUTH_TIMEOUT_MS = 3000;

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

async function resolveUser(supabase: SupabaseClient): Promise<User | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Never rejects, so a late failure after the timeout wins can't surface as an
  // unhandled rejection.
  const lookup = supabase.auth.getUser().then(
    ({ data }) => data.user ?? null,
    (error: unknown) => {
      console.warn("[auth] getUser() failed, treating request as unauthenticated:", error);
      return null;
    },
  );

  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[auth] getUser() exceeded ${AUTH_TIMEOUT_MS}ms, treating request as unauthenticated. Is the Supabase auth server reachable?`,
      );
      resolve(null);
    }, AUTH_TIMEOUT_MS);
  });

  try {
    return await Promise.race([lookup, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  context.locals.user = supabase ? await resolveUser(supabase) : null;

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
