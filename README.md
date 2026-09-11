# SpendLens

![](./public/template.png)

A goal-anchored spending insight app. Users connect a (simulated) bank, set savings goals, and receive specific expense-cutting suggestions tied to each goal.

**Live:** <https://spendlens-self.vercel.app> — production deployment of `main`.

## Tech Stack

- [Astro](https://astro.build/) v6 — Modern web framework with server-first rendering
- [React](https://react.dev/) v19 — UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 — Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 — Utility-first CSS framework
- [Supabase](https://supabase.com/) — Authentication and backend-as-a-service
- [Vercel](https://vercel.com/) — Serverless deployment runtime (via `@astrojs/vercel`)

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)
- [Vercel CLI](https://vercel.com/docs/cli) for production deploys: `npm i -g vercel`

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/mmajewski-fp/spendlens.git
cd spendlens
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.env` file for local Astro dev:

```bash
cp .env.example .env
```

For Vercel-runtime parity (`vercel dev`), additionally create a `.env.local` with the same values — `.env.local` is what the Vercel CLI reads.

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` — Start Astro development server
- `npm run build` — Build for production
- `npm run preview` — Preview production build
- `npm run lint` — Run ESLint with type-checked rules
- `npm run lint:fix` — Auto-fix ESLint issues
- `npm run format` — Run Prettier

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── lib/ # Utilities, Supabase client, services
├── public/ # Public assets
├── supabase/ # Local Supabase config + migrations
└── context/ # Foundation docs, deployment plan, PRD
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` (and `.env.local` if you use `vercel dev`):

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

### Database migrations

The application schema lives in `supabase/migrations/` (e.g. `20260527000000_data_schema_foundation.sql`). It creates the `categories`, `transactions`, and `savings_goals` tables, enables row-level security with per-user policies (`user_id = auth.uid()`), seeds the fixed category taxonomy, and installs the trigger enforcing the 3-active-goals cap.

`npx supabase start` applies every pending migration automatically on first boot. To re-apply them against a running stack — dropping and recreating all local data — run:

```bash
npx supabase db reset
```

For a hosted project, push migrations with `npx supabase db push` (after `npx supabase link`). New migrations follow the `YYYYMMDDHHmmss_short_description.sql` naming convention.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` (and `.env.local`) files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

The app is live at **<https://spendlens-self.vercel.app>** (production alias; `spendlens-git-main-mmajewski-1226s-projects.vercel.app` tracks `main`).

This project deploys to [Vercel](https://vercel.com/) via the official `@astrojs/vercel` adapter. The platform decision and operational notes (preview URLs, rollback, secrets, logs) are documented in [context/foundation/infrastructure.md](./context/foundation/infrastructure.md). The full first-release migration plan lives in [context/deployment/deploy-plan.md](./context/deployment/deploy-plan.md).

### One-time project setup

1. Install the CLI and link the repo:

```bash
npm i -g vercel
vercel link
```

2. Add the production secrets (and preview secrets if you want previews to authenticate):

```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_KEY production
vercel env add SUPABASE_URL preview
vercel env add SUPABASE_KEY preview
```

### Deploy flow

- **Auto-deploy on merge**: pushing to `main` triggers a production deploy via Vercel's GitHub integration (configured in the Vercel dashboard under "Git").
- **Manual deploy**: `vercel --prod` from a clean working tree.
- **Rollback**: `vercel rollback <deployment-url>` (Hobby plan: previous deploy only — tag each release with `git tag` as a fallback rollback anchor).
- **Logs**: `vercel logs <deployment-url> --follow`.

## CI

GitHub Actions runs `lint + test + build` on every push and PR to `main` (see [.github/workflows/ci.yml](.github/workflows/ci.yml)). Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets in GitHub for the build step. Vercel deploys are triggered by the Git integration, not by this workflow.

## License

MIT
