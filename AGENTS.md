# Repository Guidelines

Astro 6 SSR starter with React 19 islands, Tailwind 4, Supabase auth, shadcn/ui, and Cloudflare Workers deployment.

## Hard Rules

- Never add "use client" or Next.js directives — not used in this stack.
- Do not use React components for non-interactive content — use Astro components instead.
- Never expose `SUPABASE_URL` or `SUPABASE_KEY` to the client; both are server-only secrets declared in `astro.config.mjs` env schema.
- Never commit secrets to git; use `.dev.vars` (gitignored) for local Cloudflare dev secrets.
- API routes must export `const prerender = false`; all other pages are SSR by default (`output: "server"` in `@astro.config.mjs`).
- Never concatenate Tailwind classes manually — always use `cn()` from `@/lib/utils`.
- Always enable RLS on new Supabase tables with per-operation, per-role policies.

## Project Structure

- `src/components/` — Astro components (static/layout) and React components (interactive islands); `hooks/` for custom React hooks; `ui/` for shadcn/ui (new-york style)
- `src/lib/` — Supabase client, utilities, and `services/` for extracted business logic
- `src/pages/` — Astro pages; `src/pages/api/` for API endpoints
- `src/middleware.ts` — auth guard; add paths to the `PROTECTED_ROUTES` array to require authentication
- `src/types.ts` — shared entity and DTO types
- `supabase/migrations/` — SQL migration files named `YYYYMMDDHHmmss_short_description.sql`

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build; requires `SUPABASE_URL` + `SUPABASE_KEY` in environment
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier (Astro + Tailwind plugins)

Pre-commit hooks (husky + lint-staged) auto-run `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

CI gate (`@.github/workflows/ci.yml`): lint then build on every push/PR to `master`; both must pass.

## Coding Conventions

- Path alias `@/*` resolves to `src/*` (see `@tsconfig.json`).
- API routes export uppercase `GET`/`POST` functions; validate all input with zod.
- Add shadcn/ui components via `npx shadcn@latest add [name]` — do not hand-write files in `src/components/ui/`.
- Extract React hooks to `src/components/hooks/`; shared types to `src/types.ts`; services to `src/lib/services/`.
- No test runner is configured in this starter.

## Security & Configuration

- Production secrets: set via Cloudflare dashboard or `npx wrangler secret put`.
- GitHub CI requires `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets (Settings → Secrets).
