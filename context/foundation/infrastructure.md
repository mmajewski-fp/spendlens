---
project: SpendLens
researched_at: 2026-05-22T12:33:00+02:00
recommended_platform: Vercel
runner_up: Cloudflare Workers
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (SSR, output: server)
  runtime: Node.js 22+ (via @astrojs/vercel on Vercel)
  database: Supabase (external — PostgreSQL + auth)
---

## Recommendation

**Deploy on Vercel.**

Despite the project being scaffolded from the 10x Astro Starter with a Cloudflare Workers target,
the anti-bias cross-check on Cloudflare surfaced an active SSR workaround flag (`disable_nodejs_process_v2`)
that can silently break production on routine dependency updates, a mandatory paid plan from day one due to
Supabase round-trips exceeding the free tier's 10ms CPU limit, and multi-environment CI complexity that is
disproportionate for a solo after-hours developer. Vercel scores identically on all five agent-friendly
criteria, offers a true free Hobby tier that covers this MVP's traffic envelope without requiring an immediate
paid upgrade, provides full CLI deploy/rollback/logs, and ships a GA OAuth-backed MCP server that integrates
with Cursor natively. The adapter swap from `@astrojs/cloudflare` to `@astrojs/vercel` is a one-time migration
cost that buys a more stable day-to-day development loop for the 3-week sprint.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| **Vercel** | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | **5/5** |
| Cloudflare Workers | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | **5/5** |
| Netlify | ⚠️ Partial¹ | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | **4.5/5** |
| Render | ⚠️ Partial¹ | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | **4.5/5** |
| Railway | ⚠️ Partial¹ | ✅ Pass | ✅ Pass | ✅ Pass | ⚠️ Partial² | **4/5** |
| Fly.io | ⚠️ Partial¹ | ⚠️ Partial³ | ⚠️ Partial⁴ | ✅ Pass | ⚠️ Partial⁵ | **2.5/5** |

¹ No CLI rollback command — dashboard/API only  
² Remote MCP is public beta  
³ Requires Dockerfile; more operational surface than other managed platforms  
⁴ No `llms.txt`; GitHub MDX source available but no structured LLM index  
⁵ MCP tooling is for hosting custom MCP servers on Fly, not managing Fly deployments from Cursor

### Shortlisted Platforms

#### 1. Vercel (Recommended)

Vercel ties Cloudflare on all five criteria and wins on the specific constraints of this project.
The Hobby plan is genuinely free for the MVP's 10k–100k requests/month traffic envelope without
requiring a paid upgrade to handle Supabase round-trip latency (unlike Cloudflare's 10ms free-tier
CPU cap). The `vercel` CLI supports deploy, rollback, and log streaming. The official MCP server
at `https://mcp.vercel.com` is GA and OAuth-backed. The single cost is a one-time adapter swap
(`@astrojs/cloudflare` → `@astrojs/vercel`) with associated env access pattern updates throughout
the codebase. At $0 for MVP traffic, this is the lowest-cost path that avoids the Cloudflare
SSR workaround fragility.

#### 2. Cloudflare Workers

Cloudflare was the original starter target and scores 5/5 on all criteria. It was demoted due to
the combination of three factors: (a) the active `disable_nodejs_process_v2` workaround flag that
must be tracked in perpetuity against adapter and compatibility_date updates; (b) the free-tier
10ms CPU cap that makes Supabase SSR effectively paid from day one; and (c) multi-environment CI
complexity (build-time env baking requiring separate build artifacts per environment). For a 3-week
solo after-hours project, these operational burdens outweigh the benefit of avoiding an adapter swap.
Cloudflare remains an excellent choice if the project later needs edge-native performance or
co-located Workers KV/D1.

#### 3. Netlify

Netlify also scores well: official Astro 6 support via `@astrojs/netlify` v7.x (GA March 2026),
official MCP server, and good agent-readable documentation. It loses to Vercel on two points:
CLI rollback is not available (UI/API only), and the credit-based pricing model means bandwidth is
the primary cost driver — a project with even modest static asset delivery can exhaust free credits
well before hitting request-count limits, requiring an upgrade to Personal ($9/month) or Pro ($20/month).
The `netlify logs` CLI command is also still marked Beta as of May 2026.

## Anti-Bias Cross-Check: Vercel

### Devil's Advocate — Weaknesses

1. **Adapter swap breaks Cloudflare-specific env access patterns.** `astro:env/server` in the current codebase reads secrets via Cloudflare's `context.locals.runtime.env` binding. Switching to `@astrojs/vercel` requires updating the Supabase client factory, middleware, and all API routes to use Vercel's env injection (`process.env`). This is not a one-line change.

2. **Hobby rollback is limited to the immediately previous deploy.** If a bad deploy goes to production and a follow-up commit has already landed, the rollback target is gone. The only path forward is a forward fix — no time travel available on Hobby.

3. **Hobby plan hard-pauses the project on resource overage.** When CPU hours (4/month) or invocations (1M/month) are exceeded, Vercel pauses the entire project and users get 503s. A scraper, a viral link, or a misconfigured retry loop can take the MVP offline with no graceful degradation.

4. **Hobby plan prohibits commercial use.** The ToS requirement for Pro ($20/month) on commercial projects is in the terms of service, not the pricing page. This constraint becomes relevant the moment SpendLens takes a payment or acquires paying users.

5. **Active open bug in Astro 6 + Vercel hybrid mode** (issue #16520, May 2026): chunk hash mismatches cause runtime 404s on `/_astro/*.js` in hybrid (`output: 'static'` + `prerender=false`) builds. The project's `output: 'server'` config sidesteps this, but it signals active integration rough edges at this Astro major version.

### Pre-Mortem — How This Could Fail

The team migrated SpendLens to Vercel. The adapter swap (`npx astro add vercel`) succeeded, but
the first production deploy silently broke authentication: `SUPABASE_URL` and `SUPABASE_KEY`,
previously accessed via Cloudflare's `context.locals.runtime.env` through `astro:env/server`, were
`undefined` at runtime. The Astro env schema validated them at build time (where Vercel injects them),
but the runtime access pattern had changed. Diagnosing this required a weekend of `vercel logs --follow`
tracing before isolating the env access mismatch.

Six weeks later, a Friday evening deploy caused the spending dashboard to blank-screen for ~20% of
users — a stale Vercel edge CDN cache serving old `/_astro/*.js` chunk filenames. By Saturday morning
the developer had identified the cause, but three small commits had landed since the broken deploy,
and Vercel Hobby's single-previous-deploy rollback window was gone. The forward fix was tested
directly in production (Preview URL protection requires Pro, so there was no staging environment).
The developer resolved to upgrade to Pro after two more close calls, doubling the project's monthly cost.

### Unknown Unknowns

- **Preview deployments are publicly accessible by default on Hobby.** Every git push creates a public preview URL. Auth endpoints, test users, and any Supabase seed data are reachable through these URLs. Password-protected previews require the Pro plan.

- **Hobby ToS commercial-use bar is invisible until it matters.** The restriction appears in the terms of service, not the pricing page. It applies at first revenue, not first user.

- **`@astrojs/vercel` is maintained by the Astro team, not Vercel.** When Vercel ships a platform change requiring adapter updates, there's an inherent lag. Vercel's `llms-full.txt` won't document adapter gaps that are technically Astro's responsibility to patch.

- **Vercel MCP OAuth expires silently.** When the OAuth token at `mcp.vercel.com` expires, MCP tools in Cursor return empty results or generic failures without surfacing a clear "re-authenticate" prompt. Re-authentication requires completing another OAuth flow manually.

- **The 4 CPU-hours/month Hobby cap is the binding limit for SSR apps, not the 1M invocation cap.** At 100ms average function duration, the CPU-hours cap is reached at ~144,000 requests/month — well within range if the Supabase queries slow down (N+1 patterns, index misses, cold connections). Any performance regression directly eats into this headroom in ways that aren't visible until the project is paused.

## Operational Story

- **Preview deploys**: every git push to any branch creates a publicly accessible preview URL at `<branch>-<project>.vercel.app`. These are not password-protected on Hobby — use Supabase RLS to ensure preview builds cannot access production data. Preview URLs are stable per branch and update automatically on each push.
- **Secrets**: environment variables are set via `vercel env add SUPABASE_URL production` (CLI) or the Vercel dashboard. Secrets are encrypted at rest, scoped to environment (development / preview / production), and are never visible after creation. Rotation: remove the old value, add the new one; the next deploy picks up the change automatically.
- **Rollback**: `vercel rollback [deployment-url]` reverts to a previous deployment (Hobby: previous deploy only; Pro: any prior). Time-to-revert: ~30 seconds. Data caveat: database migrations that shipped with the rolled-back deploy do not revert automatically — manage Supabase migrations independently.
- **Approval**: Vercel's CLI and MCP server can deploy to production unattended. Actions requiring a human: billing tier changes, team member access changes, domain DNS configuration. Production secret rotation via CLI is safe for an agent to perform.
- **Logs**: `vercel logs [deployment-url] --follow` streams runtime logs in real time. Build logs: `vercel inspect [deployment-url]`. Via MCP in Cursor: the Vercel MCP server exposes log access as a structured tool call. Log retention: 1 hour on Hobby; 1 day on Pro.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Adapter swap breaks `astro:env/server` env access | Devil's advocate | H | H | Update `src/lib/supabase.ts` and all API routes to use `process.env` before first deploy; validate with `vercel dev` locally |
| Hobby plan pauses project on CPU-hour overage | Devil's advocate | M | H | Monitor CPU usage in Vercel dashboard weekly; upgrade to Pro before launching to real users; optimize Supabase queries to reduce function duration |
| Hobby rollback limited to previous deploy only | Devil's advocate | M | M | Tag releases with `git tag` before each production deploy; maintain the ability to `git revert` and redeploy as the rollback path |
| Preview URLs publicly expose auth endpoints | Unknown unknowns | H | M | Scope all Supabase data access to authenticated users via RLS (already required by PRD); treat previews as untrusted environments |
| Hobby ToS prohibits commercial use | Unknown unknowns | L (MVP) → H (if monetized) | H | Document upgrade to Pro as a launch gate if SpendLens ever takes payment |
| `@astrojs/vercel` lag on Vercel platform changes | Unknown unknowns | L | M | Pin `@astrojs/vercel` version in `package.json`; review Astro adapter changelog before any major `npm update` |
| Vercel MCP OAuth expires silently | Unknown unknowns | M | L | Re-authenticate when Cursor's Vercel MCP tools return unexpected empty results; check token validity first before debugging tool behavior |
| N+1 Supabase queries burning CPU hours | Unknown unknowns (pre-mortem) | M | M | Use Astro's data loading patterns with single batched queries per page; add Vercel Speed Insights to detect slow routes early |

## Getting Started

The following steps apply to the exact stack: Astro 6 + `@astrojs/vercel` + Supabase (external) + GitHub Actions CI. Verify you are on `@astrojs/vercel` v10.x (peer dep: `astro ^6.0.0`) before running.

1. **Swap the adapter**

   ```bash
   npm uninstall @astrojs/cloudflare
   npx astro add vercel
   ```

   In `astro.config.mjs`, replace:
   ```ts
   import cloudflare from '@astrojs/cloudflare';
   // adapter: cloudflare()
   ```
   with:
   ```ts
   import vercel from '@astrojs/vercel';
   // adapter: vercel()
   ```

2. **Update env access throughout the codebase**

   `astro:env/server` secrets previously accessed via Cloudflare's `context.locals.runtime.env`
   must now be read as standard `process.env.*` variables at runtime. Update `src/lib/supabase.ts`
   and any other file that imports from `astro:env/server` or accesses `locals.runtime.env`.
   Verify with `vercel dev` locally (install Vercel CLI: `npm i -g vercel`).

3. **Set production secrets via CLI**

   ```bash
   vercel env add SUPABASE_URL production
   vercel env add SUPABASE_KEY production
   ```

   For local development, `vercel dev` reads from `.env.local` (gitignored) — equivalent to
   the previous `.dev.vars` for Cloudflare.

4. **Connect repo and configure GitHub Actions**

   Link the project: `vercel link`. For CI, use the official Vercel GitHub Action or the
   `vercel --prod` CLI command with a `VERCEL_TOKEN` repository secret. Auto-deploy on merge
   to `main` is configured in the Vercel dashboard under "Git" settings — no separate workflow
   file is required for the standard deploy flow.

5. **Configure the Vercel MCP server in Cursor**

   Add to `~/.cursor/mcp.json` (or Cursor's MCP settings):
   ```json
   {
     "mcpServers": {
       "vercel": {
         "url": "https://mcp.vercel.com/mcp"
       }
     }
   }
   ```
   On first use, Cursor will prompt for OAuth authentication. After authenticating, tools for
   deploy, logs, env var management, and project status are available as structured MCP calls
   directly in Cursor chat.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup beyond deploy integration
- Production-scale architecture (multi-region, HA, DR)
