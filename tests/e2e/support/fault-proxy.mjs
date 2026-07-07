// Deterministic Supabase fault-injection proxy for the E2E "SSR error surface" risk
// (test-plan.md #7). It forwards EVERYTHING to the real local Supabase so that auth,
// routing, and middleware stay real — EXCEPT the transactions data read, which it
// answers with a PostgREST-shaped 500 carrying a recognizable secret token.
//
// This is the only sanctioned network mock in the suite: SpendLens fetches Supabase
// server-side in .astro frontmatter, so browser-side page.route() cannot intercept it.
// Pointing the app's SUPABASE_URL at this proxy is how we make getUserTransactions()
// throw against the real running app.
//
// The fault is SCOPED to a single test user (not the whole server): the proxy
// decodes the forwarded Supabase JWT and only fails the read when the user's email
// starts with FAULT_EMAIL_PREFIX. Requests from any other user (and future
// happy-path tests) pass through to the real backend untouched.
//
// Env:
//   PROXY_PORT          port to listen on             (default 54399)
//   UPSTREAM_URL        real Supabase to forward to   (default http://127.0.0.1:54321)
//   LEAK_TOKEN          secret string embedded in the failed response, so the test can
//                       assert it never reaches the rendered page (default a fixed marker)
//   FAULT_EMAIL_PREFIX  only fault reads for this user's email prefix (default e2e-fault-)
import http from "node:http";

const PORT = Number(process.env.PROXY_PORT ?? 54399);
const UPSTREAM = new URL(process.env.UPSTREAM_URL ?? "http://127.0.0.1:54321");
const LEAK_TOKEN = process.env.LEAK_TOKEN ?? "SUPABASE_INTERNAL_LEAK_TOKEN_do_not_render";
const FAULT_EMAIL_PREFIX = process.env.FAULT_EMAIL_PREFIX ?? "e2e-fault-";

// Decode the `email` claim from a Supabase access token (Authorization: Bearer <jwt>),
// without verifying the signature — we only need to know WHOSE request this is.
function emailFromAuthHeader(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7).split(".")[1], "base64url").toString());
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

// The single data path we fault: the dashboard's getUserTransactions() read,
// and only for the designated fault user.
function isFaultedRequest(req) {
  if (req.method !== "GET" || !req.url.startsWith("/rest/v1/transactions")) return false;
  return emailFromAuthHeader(req)?.startsWith(FAULT_EMAIL_PREFIX) ?? false;
}

const server = http.createServer((req, res) => {
  if (isFaultedRequest(req)) {
    // PostgREST-shaped error envelope. `message`/`details`/`hint` carry the leak
    // token — exactly the raw backend text that must NOT surface in the error card.
    const body = JSON.stringify({
      code: "PGRST500",
      message: `permission denied for table transactions (${LEAK_TOKEN})`,
      details: `connection string host=db.internal password=${LEAK_TOKEN}`,
      hint: null,
    });
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }

  // Transparent pass-through to the real Supabase for everything else (auth included).
  const proxyReq = http.request(
    {
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: UPSTREAM.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  proxyReq.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "fault-proxy upstream error" }));
  });
  req.pipe(proxyReq);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[fault-proxy] listening on http://127.0.0.1:${PORT} → ${UPSTREAM.origin} (transactions read faulted)`);
});
