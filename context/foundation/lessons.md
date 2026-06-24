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

## Don't depend on ambient timezone or locale in deterministic logic/tests

- **Context**: Any deterministic logic or test that touches dates/times or string ordering — e.g. cut-math date windows, months-remaining, category sort — and any Vitest/Stryker run.
- **Problem**: Ambient timezone and default-locale collation vary across machines/CI/Stryker workers. This rollout hit it twice: a DST-crossing goal date computed months=6 instead of 5, and an unpinned localeCompare tie-break could reorder categories by environment. Tests pass locally and flake elsewhere; logic produces different results per host.
- **Rule**: Never let deterministic logic or tests depend on the ambient timezone or default locale. Pin TZ=UTC on the process invocation (not just in config), and use codepoint comparison or an explicit locale instead of bare localeCompare.
- **Applies to**: plan, implement, impl-review
