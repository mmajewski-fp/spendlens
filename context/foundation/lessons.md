# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Treat Phase N+1's Props interface as the authoritative prop surface

- **Context**: cross-phase plan for an Astro SSR page passing data to a React island
- **Problem**: Phase 2 said "pass result and goals as props"; Phase 3's Props interface declared only result. The mismatch created an ambiguity — which phase's contract wins? The implementation had to make a judgment call.
- **Rule**: When a downstream phase defines a component's Props interface, that interface is the authoritative specification of what props are needed. Upstream phases should not independently enumerate props — they should defer to "pass the required props as defined in Phase N+1" to avoid cross-phase contract drift.
- **Applies to**: plan

## Wrap SSR data-fetching in try/catch to avoid blank 500 pages

- **Context**: any Astro SSR page that calls service helpers in its frontmatter
- **Problem**: getUserTransactions threw on a Supabase error; no try/catch → Vercel returned a blank 500 page
- **Rule**: Wrap all service-helper calls in Astro SSR frontmatter in a try/catch so transient Supabase errors render a graceful error card instead of a blank 500 page.
- **Applies to**: implement
