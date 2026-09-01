---
title: SpendLens — Anti-Corruption Layer dla Supabase (porty + adapter)
created: 2026-07-13
type: refactor-plan
---

# Anti-Corruption Layer: odseparowanie Supabase od domeny

> Produktem jest PLAN, nie implementacja. Poniższy kod to **pseudokod projektowy** —
> nie modyfikuje kodu produkcyjnego. Bazuje na `context/domain/01-domain-distillation.md`
> i `context/domain/02-invariant-aggregate-refactor.md`.

## KROK 0 — Kontekst

- **Dokumenty bazowe:**
  - `context/foundation/tech-stack.md:27-29` — Supabase wybrane jako część „single **opinionated bundle**" (PostgreSQL + auth + TypeScript SDK), „removing all infrastructure decisions from week one".
  - `README.md:13` — „Supabase — Authentication and **backend-as-a-service**".
  - `CLAUDE.md` (§Key conventions) — „**Services/helpers** go in `src/lib/` (or `src/lib/services/` for **extracted business logic**)"; „**Shared types** (entities, DTOs) go in `src/types.ts`".
- **Stack / zależności zewnętrzne** (`package.json` §dependencies): Astro 6, React 19, Tailwind 4, **`@supabase/supabase-js` ^2.99.1**, **`@supabase/ssr` ^0.10.3**, zod, lucide-react.
- **Warstwy kodu:** UI (Astro pages + React islands) → API routes (`src/pages/api/**`) + middleware → serwisy (`src/lib/services/**`) → persystencja/auth (Supabase) via fabryka `src/lib/supabase.ts`; typy współdzielone `src/types.ts`.

**Uwaga o intencji (rozjazd, nie deklaracja wprost):** żaden dokument NIE deklaruje wprost „Supabase ma być wymienialne" — przeciwnie, tech-stack świadomie wybiera *opinionated bundle*. Ale CLAUDE.md deklaruje warstwę serwisów jako miejsce **wyodrębnionej logiki biznesowej** oddzielone od frameworka — a kod tej granicy nie dotrzymuje: typ `SupabaseClient` i DSL zapytań przeciekają przez całą tę warstwę (KROK 3). Rozjazd jest więc: *„warstwa serwisów = logika domenowa"* (CLAUDE.md) vs *„serwisy = cienkie opakowania DSL Supabase z typem biblioteki w każdej sygnaturze"*.

---

## KROK 1 — Przeciekające zależności (inwentarz)

Sygnały przecieku i miejsca ich wystąpienia:

### Z-1: **Supabase SDK** (`@supabase/supabase-js` + `@supabase/ssr`) — przeciek przez WSZYSTKIE warstwy

Wszystkie pliki produkcyjne, które dziś „znają" Supabase:

| Warstwa | Plik:linia | Co przecieka |
|---|---|---|
| Typy globalne | `src/env.d.ts:3` | `import("@supabase/supabase-js").User` w `App.Locals.user` — **typ biblioteki w kontrakcie aplikacji** |
| Fabryka | `src/lib/supabase.ts:1` | `createServerClient`, `parseCookieHeader` z `@supabase/ssr` |
| Middleware | `src/middleware.ts:2,7,12` | `createClient` + `supabase.auth.getUser()` |
| Serwis | `src/lib/services/savings-goals.ts:1,17,32,40,51` | `SupabaseClient` **w sygnaturach domenowych** + DSL `:5,22-25,33,44,52` |
| Serwis | `src/lib/services/transactions.ts:1,6,20` | `SupabaseClient` w sygnaturach + DSL `:8-12,24-26` (`upsert{onConflict,ignoreDuplicates}`) |
| Serwis | `src/lib/services/categories.ts:1,4` | `SupabaseClient` w sygnaturze + DSL `:5` |
| Serwis | `src/lib/services/import-transactions.ts:11,23` | `SupabaseClient` w sygnaturze |
| API | `src/pages/api/goals.ts:4,22` | `createClient` + przekazanie klienta do serwisu |
| API | `src/pages/api/goals/[id].ts:4,25,51` | `createClient` (×2 w handlerach) |
| API | `src/pages/api/transactions/export.ts:4,20` | `createClient` |
| API | `src/pages/api/transactions/import.ts:2,32` | `createClient` |
| API (auth) | `src/pages/api/auth/signin.ts:2,9,13` | `createClient` + `supabase.auth.signInWithPassword` |
| API (auth) | `src/pages/api/auth/signup.ts:2,9,13` | `createClient` + `supabase.auth.signUp` |
| API (auth) | `src/pages/api/auth/signout.ts:2,5,7` | `createClient` + `supabase.auth.signOut` |
| UI/SSR | `src/pages/dashboard.astro:5,10` | `createClient` w frontmatter strony |
| UI/SSR | `src/pages/recommendations.astro:5,11` | `createClient` |
| UI/SSR | `src/pages/goals.astro:5,9` | `createClient` |
| UI/SSR | `src/pages/transactions.astro:4,9` | `createClient` |
| UI/SSR | `src/pages/transactions/import.astro:5,9` | `createClient` |

Testy sprzężone z zależnością (mock/typ): `src/pages/api/goals.test.ts:10`, `.../goals/[id].test.ts:11`, `.../transactions/import.test.ts:10`, `.../transactions/export.test.ts:11`, `src/lib/services/savings-goals.test.ts:1,13,22`, `src/lib/services/transactions.test.ts:1,9,18` (stub `as unknown as SupabaseClient`).

**Trzy klasy sygnału w Z-1:**
1. **Typ biblioteki w sygnaturach domenowych** — `SupabaseClient` jest formalnym parametrem 4 serwisów (`savings-goals`, `transactions`, `categories`, `import-transactions`). Domena „mówi w języku" biblioteki.
2. **DSL persystencji rozlany po serwisach** — `.from("savings_goals").select("*").order(...)`, `.upsert(rows,{onConflict:"user_id,external_id",ignoreDuplicates:true})`, `.eq/.maybeSingle/.single` — schemat tabel i semantyka PostgREST są zaszyte w „logice biznesowej".
3. **Rekonstrukcja obiektu biblioteki zduplikowana** — `createClient(headers, cookies)` powtórzone dosłownie w **~14 miejscach** (middleware + 5 stron + 8 route'ów). Ten sam wzorzec konstrukcji po obu stronach granicy UI/serwer (strony SSR i route'y API).

### Inne kandydatki (odrzucone jako #1)
- **Astro** (`APIRoute`, `AstroCookies`, `astro:env/server`, `astro:middleware`) — to *platforma/framework* aplikacji, nie wymienialny sterownik; granica z natury. Nie ACL-owalne bez przepisania appki.
- **zod** — używane na granicy API (parsowanie wejścia) — właściwe miejsce; nie przecieka do domeny.
- **lucide-react / react** — czyste UI, nie przekracza granicy serwera.

---

## KROK 2 — Klasyfikacja i wybór #1

| Zależność | (a) Warstwy/pliki | (b) Ryzyko/koszt wymiany dziś | (c) Deklarowana wymienialność | Werdykt |
|---|---|---|---|---|
| **Z-1 Supabase SDK** | **~19 plików prod. w 5 warstwach** (typy, fabryka, middleware, serwisy, API, UI) | **Bardzo wysokie** — zmiana dostawcy danych/auth dotyka każdej warstwy; DSL i typy trzeba by przepisać wszędzie | Brak wprost; **rozjazd z CLAUDE.md** (serwis = logika, a jest opakowaniem DSL) | **← WYBÓR #1** |
| Astro | wszędzie | n/d (to platforma) | — | poza zakresem |
| zod | granica API | niskie | — | właściwie umiejscowione |

### Wybór i uzasadnienie

**Wybrany #1: Z-1 — Supabase SDK.** To jednoznacznie najgorszy przeciek na każdej mierzalnej osi:
- **(a)** dotyka pięciu warstw i ~19 plików produkcyjnych — od `env.d.ts` (typ `User` w kontrakcie `Locals`) po frontmatter każdej chronionej strony;
- **(b)** koszt wymiany dostawcy danych/uwierzytelniania (np. na Postgres+własne API, Drizzle/Prisma, inny BaaS) jest dziś rozproszony po całej aplikacji — nie ma jednego szwu; dodatkowo semantyka specyficzna dla PostgREST (upsert `onConflict`, kod błędu triggera z planu 02) jest wtopiona w serwisy i route'y;
- **(c)** choć dokumenty nie obiecują wymienialności, obiecują **warstwę serwisów jako wyodrębnioną logikę biznesową** (CLAUDE.md) — a ta warstwa jest dziś tylko cienką kalką DSL Supabase; to jest ten „rozjazd intencja-vs-kod".

**Zastrzeżenie uczciwościowe (nie-przeceniam ryzyka):** groźny wariant „biblioteka serwerowa w bundlu klienta" **dziś NIE występuje** — wyspy React (`GoalsManager`, `RecommendationsPanel`, `ImportPanel`, formularze auth) rozmawiają z serwerem przez `fetch` do route'ów API i **nie importują** `@supabase` (grep w KROK 6), a fabryka `src/lib/supabase.ts:3` importuje `astro:env/server`, co strukturalnie blokuje jej wciągnięcie do klienta. Przeciek Z-1 jest więc problemem **sprzężenia/utrzymania i kosztu wymiany**, nie żywym wyciekiem sekretu do bundla. ACL dodatkowo zamienia tę dzisiejszą gwarancję z „przypadkowej/konwencyjnej" na **wymuszoną strukturalnie**.

---

## KROK 3 — Diagnoza Z-1

### 3.1 Typ biblioteki w sygnaturach domenowych

`src/lib/services/savings-goals.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";          // :1
export async function getUserGoals(client: SupabaseClient): Promise<SavingsGoal[]> {  // :4
  const { data, error } = await client.from("savings_goals").select("*").order("created_at", { ascending: true }); // :5
```
Analogicznie `transactions.ts:1,6,20`, `categories.ts:1,4`, `import-transactions.ts:11,23`. Domena nie da się skompilować bez typu Supabase.

### 3.2 DSL persystencji wtopiony w „logikę"

`src/lib/services/transactions.ts:24-26`:
```ts
.from("transactions")
.upsert(rows, { onConflict: "user_id,external_id", ignoreDuplicates: true })  // niezmiennik idempotencji (I-6) wyrażony w DSL PostgREST
.select();
```
`savings-goals.ts:22-25,33,44,52` — nazwy tabel, `.maybeSingle()`, rzutowania `as SingleRowResult`. Kształt tabel + semantyka PostgREST są w warstwie, która wg CLAUDE.md ma być logiką biznesową.

### 3.3 Typ biblioteki w kontrakcie aplikacji

`src/env.d.ts:3`:
```ts
user: import("@supabase/supabase-js").User | null;
```
Każdy strażnik (`middleware.ts:19`, `goals.ts:18`, `import.ts:28` itd.) czyta `context.locals.user`, więc **typ `User` Supabase jest de facto typem domenowym „zalogowanego użytkownika"** w całej aplikacji, choć używamy z niego wyłącznie `.id`.

### 3.4 Rekonstrukcja + auth po obu stronach granicy

`createClient(headers, cookies)` w 14 miejscach (KROK 1). Auth-SDK wołane w middleware **i** w route'ach: `middleware.ts:12` (`getUser`), `signin.ts:13`, `signup.ts:13`, `signout.ts:7`. Zero jednego miejsca wiedzy o „jak rozmawiamy z Supabase".

### 3.5 Częściowy szew, który nie wystarcza

`src/lib/supabase.ts` **jest** zalążkiem szwu — ale kończy się na *konstrukcji*: zwraca surowy `SupabaseClient`, którego typ i DSL płyną dalej. To fabryka, nie ACL.

---

## KROK 4 — Projekt ACL (porty + adapter + VO)

Zasada: **cała wiedza o Supabase w jednym katalogu** `src/lib/adapters/supabase/**`. Reszta kodu zna wyłącznie **porty** (interfejsy domenowe) i **typy domenowe**.

### 4.1 Domenowy value object tożsamości (zastępuje `User` Supabase)

```ts
// src/lib/domain/authenticated-user.ts  (nowy) — JEDYNA wiedza o kształcie „użytkownika"
export interface AuthenticatedUser {   // tylko to, czego appka używa
  readonly id: string;
  readonly email: string | null;
}
```
`env.d.ts` → `user: AuthenticatedUser | null` (bez `@supabase`).

### 4.2 Wąskie porty (interfejsy domenowe) — reszta kodu zna tylko to

```ts
// src/lib/ports/index.ts  (nowy) — ZERO importów @supabase
import type { SavingsGoal, TransactionWithCategory, Transaction, Category } from "@/types";
import type { AuthenticatedUser } from "@/lib/domain/authenticated-user";

export interface SavingsGoalStore {
  list(): Promise<SavingsGoal[]>;
  getById(id: string): Promise<SavingsGoal | null>;
  create(userId: string, draft: NewGoalDraft): Promise<SavingsGoal>;   // rzuca GoalCapExceededError (plan 02)
  update(id: string, patch: GoalPatch): Promise<SavingsGoal>;
  delete(id: string): Promise<void>;
}
export interface TransactionStore {
  list(since?: string): Promise<TransactionWithCategory[]>;
  upsertMany(rows: NewTransactionRow[]): Promise<Transaction[]>;       // idempotencja I-6 to szczegół adaptera
}
export interface CategoryStore { list(): Promise<Category[]>; }

export interface AuthGateway {
  currentUser(): Promise<AuthenticatedUser | null>;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
}
export type AuthResult = { ok: true } | { ok: false; message: string };

/** Kompozycja portów wstrzykiwana per-request (patrz 4.4). */
export interface DataContext {
  goals: SavingsGoalStore;
  transactions: TransactionStore;
  categories: CategoryStore;
  auth: AuthGateway;
}
```

### 4.3 Adapter — JEDYNE miejsce znające Supabase (mapowanie z/do persystencji, konwersja typów, kody błędów)

```ts
// src/lib/adapters/supabase/client.ts  (nowy) — przenosi tu logikę z src/lib/supabase.ts
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
export function makeRawClient(headers: Headers, cookies: AstroCookies): SupabaseClient | null { /* jak dziś */ }

// src/lib/adapters/supabase/savings-goal.store.ts  (nowy)
import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
export class SupabaseSavingsGoalStore implements SavingsGoalStore {
  constructor(private readonly db: SupabaseClient) {}
  async list() {
    const { data, error } = await this.db.from("savings_goals").select("*").order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data as SavingsGoal[];
  }
  async create(userId: string, draft: NewGoalDraft) {
    const { data, error } = await this.db.from("savings_goals").insert({ ...draft, user_id: userId }).select().single();
    if (error) {
      if ((error as PostgrestError).code === "SL001") throw new GoalCapExceededError(3); // kontrakt z planu 02 — TU, nie w API
      throw new Error(error.message);
    }
    return data as SavingsGoal;
  }
  // getById / update / delete — analogicznie; cały DSL i rzutowania rezydują TYLKO tutaj
}

// src/lib/adapters/supabase/auth.gateway.ts  (nowy)
export class SupabaseAuthGateway implements AuthGateway {
  constructor(private readonly db: SupabaseClient) {}
  async currentUser(): Promise<AuthenticatedUser | null> {
    const { data } = await this.db.auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? null } : null; // MAPOWANIE User→VO
  }
  async signIn(email, password) {
    const { error } = await this.db.auth.signInWithPassword({ email, password });
    return error ? { ok: false, message: error.message } : { ok: true };
  }
  // signUp / signOut — analogicznie
}
```

### 4.4 Kompozycja per-request — likwiduje 14× rekonstrukcję

```ts
// src/lib/adapters/supabase/context.ts  (nowy)
export function createDataContext(headers: Headers, cookies: AstroCookies): DataContext | null {
  const db = makeRawClient(headers, cookies);
  if (!db) return null;
  return {
    goals: new SupabaseSavingsGoalStore(db),
    transactions: new SupabaseTransactionStore(db),
    categories: new SupabaseCategoryStore(db),
    auth: new SupabaseAuthGateway(db),
  };
}
```
Middleware buduje `DataContext` raz i wystawia w `context.locals` (obok `user: AuthenticatedUser`), więc route'y i strony **nie wołają już `createClient`** — sięgają po `locals.data.goals` itd. Serwisy domenowe (`recommendations.ts`, `spending-summary.ts` — już czyste) i przyszły agregat `SavingsGoalPortfolio` (plan 02) przyjmują **porty**, nie `SupabaseClient`.

---

## KROK 5 — Dowód izolacji + before/after

### 5.1 Wymiana biblioteki dotyka wyłącznie adaptera

Aby zamienić Supabase (np. na Postgres+Drizzle albo inny BaaS) wystarczy dodać `src/lib/adapters/<nowy>/**` implementujący te same porty i przełączyć `createDataContext`. **Nie zmieniają się:** `src/types.ts`, `src/lib/services/recommendations.ts`, `spending-summary.ts`, żaden route API (kontrakty HTTP), żadna strona/wyspa UI, żadna tabela (migracje SQL to osobny artefakt persystencji). Porty i typy domenowe stanowią zamrożony kontrakt.

### 5.2 Before/after (zduplikowane/przeciekające miejsca)

| Miejsce | Before | After |
|---|---|---|
| `env.d.ts:3` | `user: import("@supabase/supabase-js").User \| null` | `user: AuthenticatedUser \| null` (VO domenowy) |
| `src/lib/supabase.ts` | fabryka zwraca surowy `SupabaseClient` | logika przeniesiona do `adapters/supabase/client.ts`; poza adapterem niewidoczna |
| `services/savings-goals.ts` (typ+DSL) | `getUserGoals(client: SupabaseClient)` + DSL | znika; DSL → `SupabaseSavingsGoalStore`; wywołujący zna `SavingsGoalStore` |
| `services/transactions.ts:24-26` | `upsert({onConflict, ignoreDuplicates})` w „logice" | idempotencja I-6 ukryta w `SupabaseTransactionStore.upsertMany()` |
| `services/categories.ts`, `import-transactions.ts` | biorą `SupabaseClient` | biorą `CategoryStore` / porty |
| `createClient(headers,cookies)` ×14 (middleware, 5 stron, 8 route'ów) | rekonstrukcja w każdym pliku | jedno `createDataContext` w middleware → `locals.data` |
| `signin/signup/signout.ts` + `middleware.ts` | wołają `supabase.auth.*` bezpośrednio | wołają `locals.data.auth.*` (port) |
| cap→błąd (plan 02) | `message.includes("... 3 active ...")` w `goals.ts:51` | `PostgrestError.code==='SL001'` → `GoalCapExceededError` **w adapterze**; API mapuje tylko typ błędu |

### 5.3 UI dostaje dane domenowe, nie obiekt biblioteki

Dziś strony SSR (`goals.astro:17`, `recommendations.astro:22`, `dashboard.astro`, `transactions.astro`) tworzą klienta i wołają serwisy. Po refaktorze frontmatter woła `Astro.locals.data.goals.list()` / `.transactions.list(since)` — dostaje `SavingsGoal[]` / `TransactionWithCategory[]` (typy z `src/types.ts`), nigdy `SupabaseClient`. Wyspy React już dziś dostają czyste typy przez propsy/`fetch` — to się nie zmienia.

### 5.4 Otwarte pytania zależne od kontraktu Supabase — rozstrzygnięcie i miejsce zakodowania

- **Idempotentny import (I-6):** kontrakt PostgREST `upsert(onConflict:"user_id,external_id", ignoreDuplicates)` zwraca tylko nowo-wstawione wiersze. Decyzja: pozostaje semantyką adaptera; port `upsertMany` obiecuje „zwraca realnie wstawione". **Kodować w** `SupabaseTransactionStore`, nie w `import.ts`.
- **Sygnał przekroczenia capa (plan 02):** Supabase zwraca `PostgrestError.code`. Decyzja (z planu 02): stabilny SQLSTATE `SL001`. **Kodować w** `SupabaseSavingsGoalStore.create()` — tłumaczenie kod→`GoalCapExceededError`. Route zna tylko błąd domenowy.
- **Sesja/cookies (`@supabase/ssr`):** `parseCookieHeader` + `getAll/setAll`. **Kodować w** `adapters/supabase/client.ts`; porty nie znają cookies.

---

## KROK 6 — Weryfikacja i plan

### 6.1 Kryterium sukcesu (grep)

Po refaktorze:
```
grep -rn "@supabase" src/            # ⇒ wyłącznie pliki w src/lib/adapters/supabase/**
grep -rn "SupabaseClient" src/       # ⇒ jw. (plus stuby testów adaptera)
grep -rn "createClient(" src/pages   # ⇒ brak (zastąpione locals.data)
```

**Dziś znają Z-1 (do wyzerowania poza adapterem):** `env.d.ts`, `lib/supabase.ts`, `middleware.ts`, `services/{savings-goals,transactions,categories,import-transactions}.ts`, `pages/api/goals.ts`, `pages/api/goals/[id].ts`, `pages/api/auth/{signin,signup,signout}.ts`, `pages/api/transactions/{export,import}.ts`, `pages/{dashboard,recommendations,goals,transactions}.astro`, `pages/transactions/import.astro` (19 plików).

**Po refaktorze znają Z-1 (docelowo jedyne):** `src/lib/adapters/supabase/{client,savings-goal.store,transaction.store,category.store,auth.gateway,context}.ts`. Wszystkie 19 powyższych — już NIE (zależą od portów/VO/`locals.data`).

### 6.2 Plan faz (konwencja projektu: `/10x-new` → `/10x-plan` → `/10x-implement`; Vitest unit+integration, Stryker, Playwright)

1. **Porty + VO** (`src/lib/ports`, `src/lib/domain/authenticated-user.ts`) — czyste interfejsy, zero I/O. Zmiana `env.d.ts` na `AuthenticatedUser`.
2. **Adapter Supabase** (`src/lib/adapters/supabase/**`) — przenieś `lib/supabase.ts` i DSL z serwisów; **[INTEGRACJA]** testy adapterów na realnym lokalnym Supabase (`tests/integration/**`, `vitest.config.integration.ts`) — w tym mapowanie `SL001`→`GoalCapExceededError` i idempotencja upsert.
3. **Kompozycja + middleware** — `createDataContext`, wystawienie `locals.data` i `locals.user: AuthenticatedUser`; middleware woła `auth.currentUser()`.
4. **Route'y API** — zamień `createClient`+serwis na `locals.data.*`; **zaktualizuj** hermetyczne testy (`goals.test.ts`, `[id].test.ts`, `transactions/*.test.ts`) tak, by **mockowały porty**, nie `@/lib/supabase`. Kontrakty HTTP bez zmian.
5. **Strony SSR** — frontmatter na `Astro.locals.data.*`; zachowaj try/catch (lessons.md: brak blank-500).
6. **Serwisy domenowe** — `import-transactions.ts` i przyszły `SavingsGoalPortfolio` (plan 02) przyjmują porty; usuń ostatnie importy `SupabaseClient`.
7. **Weryfikacja** — grep z 6.1 = zielony; `npm run build` + `npm run test` + `test:integration`; e2e smoke (auth + create goal) bez zmian zachowania.

### 6.3 Nowe nazwy „load-bearing" do rejestru kontraktów

`AuthenticatedUser` (VO tożsamości), porty `SavingsGoalStore` / `TransactionStore` / `CategoryStore` / `AuthGateway`, `DataContext` (+ `Astro.locals.data`), `createDataContext`, katalog-granica `src/lib/adapters/supabase/**`, SQLSTATE `SL001` jako kontrakt adapter↔DB (współdzielony z planem 02).

---

## Podsumowanie

Spośród zależności zewnętrznych jednoznacznie najgorszym przeciekiem jest **Supabase SDK** (`@supabase/supabase-js` + `@supabase/ssr`): jego typ `SupabaseClient` stoi w sygnaturach czterech serwisów domenowych, jego DSL PostgREST (nazwy tabel, `upsert{onConflict,ignoreDuplicates}`, `.maybeSingle`) jest wtopiony w warstwę, którą CLAUDE.md deklaruje jako „wyodrębnioną logikę biznesową", jego typ `User` jest de facto typem domenowym użytkownika w `env.d.ts:3`, a fabryka `createClient(headers,cookies)` jest zrekonstruowana w ~14 miejscach po obu stronach granicy UI/serwer — łącznie 19 plików produkcyjnych w 5 warstwach. Dokumenty nie obiecują wymienialności wprost (tech-stack świadomie wybiera *opinionated bundle*), ale obiecują rozdział logiki od frameworka, którego kod nie dotrzymuje — to rozjazd intencja-vs-kod. Uczciwie: groźny wariant „biblioteka serwerowa w bundlu klienta" dziś nie występuje (wyspy używają `fetch`, a `astro:env/server` blokuje import fabryki na kliencie), więc problem to sprzężenie i koszt wymiany, nie żywy wyciek sekretu. Projekt ACL wprowadza wąskie porty (`SavingsGoalStore`, `TransactionStore`, `CategoryStore`, `AuthGateway`) i domenowy VO `AuthenticatedUser`, a całą wiedzę o Supabase — mapowanie wierszy, konwersję `User`→VO, semantykę upsert i tłumaczenie kodu błędu `SL001`→`GoalCapExceededError` — zamyka w jednym katalogu adaptera `src/lib/adapters/supabase/**`, wstrzykiwanym per-request przez `createDataContext` do `Astro.locals.data`. Dowód izolacji: wymiana dostawcy dotyka wyłącznie adaptera — typy domenowe, serwisy czyste, route'y, strony i tabele pozostają nietknięte, a UI dostaje gotowe dane domenowe zamiast surowego klienta. Kryterium sukcesu jest sprawdzalne mechanicznie: `grep -rn "@supabase" src/` po refaktorze zwraca wyłącznie pliki adaptera, redukując 19 plików-świadków do sześciu w jednej granicy.
