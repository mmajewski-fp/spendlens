---
title: SpendLens — Refaktor niezmiennika do agregatu-strażnika (SavingsGoalPortfolio)
created: 2026-07-13
type: refactor-plan
---

# Refaktor niezmiennika → agregat-strażnik

> Produktem jest PLAN, nie implementacja. Poniższy kod to **pseudokod projektowy** — nie
> modyfikuje kodu produkcyjnego. Bazuje na `context/domain/01-domain-distillation.md`
> (destylacja domeny) i weryfikuje reguły ponownie w źródłach.

## KROK 0 — Kontekst

- **Dokumenty:** `context/foundation/prd.md` (FR-006…FR-008, Business Logic, NFR), `context/foundation/roadmap.md` (S-04/S-05/S-08, ostrzeżenie o race), `context/foundation/lessons.md` (determinizm TZ/locale), `context/foundation/test-plan.md`.
- **Stack / warstwy** (gdzie żyje logika celów):
  - **Persystencja + niezmiennik DB:** `supabase/migrations/20260527000000_data_schema_foundation.sql` (tabela `savings_goals`, trigger `check_savings_goal_limit`, RLS).
  - **Data-access (serwis cienki):** `src/lib/services/savings-goals.ts` (`getUserGoals`, `createGoal`, `getGoalById`, `updateGoal`, `deleteGoal`).
  - **Walidacja domenowa (rozproszona):** `src/lib/goal-validation.ts` (zod + `isFutureDate`).
  - **API:** `src/pages/api/goals.ts` (POST), `src/pages/api/goals/[id].ts` (PUT/DELETE).
  - **UI (współ-strażnik):** `src/components/goals/GoalsManager.tsx`, strona SSR `src/pages/goals.astro`.
  - **Testy:** unit (Vitest, hermetyczne, mock Supabase) `src/pages/api/goals.test.ts`, `src/pages/api/goals/[id].test.ts`; integracyjne (`tests/integration/**`, realny lokalny Supabase, `vitest.config.integration.ts` — obecnie brak plików); mutacyjne (Stryker); e2e (Playwright). `TZ=UTC` przypięte we wszystkich runnerach.

---

## KROK 1 — Inwentarz niezmienników biznesowych

Reguły, które w domenie SpendLens MUSZĄ być zawsze prawdziwe (ze źródeł + kodu):

| # | Niezmiennik | Źródło | Gdzie „żyje" dziś |
|---|---|---|---|
| I-1 | **Użytkownik ma co najwyżej 3 *aktywne* cele oszczędnościowe.** | `prd.md:79` (FR-007) | Trigger DB (liczy WSZYSTKIE), API string-match, UI `atGoalCap` |
| I-2 | Rekomendacje muszą **domknąć lukę** do celu (minimalny zestaw cięć). | `prd.md:111` | `recommendations.ts:77-89` (funkcja czysta, obcięta do 5) |
| I-3 | Kwota transakcji zawsze **dodatnia**; znak niesie `type`. | `types.ts:13`; `simulated-bank.ts:17` | Komentarz typu + generator; DB bez `CHECK` |
| I-4 | `target_amount` celu **> 0**. | `goal-validation.ts:14` | zod na 2 route'ach; DB bez `CHECK` |
| I-5 | Termin celu to realna data; **przy tworzeniu w przyszłości**. | `prd.md:76`; `goal-validation.ts:26` | zod POST bezwarunkowo, PUT warunkowo (`goals/[id].ts:84`) |
| I-6 | Import jest **idempotentny** (jedna transakcja per `user_id,external_id`). | `roadmap.md:83` | `UNIQUE(user_id, external_id)` + upsert `ignoreDuplicates` |
| I-7 | **Ścisła izolacja per-user** — brak dostępu międzykontowego. | `prd.md:98` (NFR) | Polityki RLS `user_id = auth.uid()` |
| I-8 | Kategoria transakcji ∈ 11 stałych slugów (`other` fallback). | `roadmap.md:200` | Seed + `UNIQUE(slug)`; równoległy typ `CategorySlug` |

---

## KROK 2 — Klasyfikacja (3 osie) i wybór #1

| # | (a) Rdzeniowość | (b) Rozsmarowanie po warstwach | (c) Egzekwowanie | Werdykt |
|---|---|---|---|---|
| I-1 (cap 3) | Wysoka — twarda reguła produktu FR-007; definiuje granicę modelu celów | **Bardzo wysokie — 3 warstwy**: DB trigger + API + UI, plus kontrakt „tekstu wyjątku" | **Niespójne / kruche** — DB egzekwuje, ale API tłumaczy przez `includes(string)`; UI jest drugim strażnikiem; „active" nieodwzorowane | **← WYBÓR #1** |
| I-2 (close-the-gap) | **Najwyższa** — to wedge produktu | **Niskie — 1 plik** (czysta funkcja, już scentralizowana) | Egzekwowany, ale niepoprawny (ciche niedomknięcie) | Najcenniejszy, ale to problem *kontraktu obliczenia*, nie *rozproszenia* — nie pasuje do wzorca agregatu |
| I-3 (amount>0) | Średnia (zasila Core) | Średnie | Deklarowany, nieegzekwowany w DB | Kandydat na `CHECK`, nie na agregat |
| I-4 (target_amount>0) | Średnia | Średnie (zod ×2) | Egzekwowany na wejściach, brak w DB | Wchłonę do agregatu jako niezmiennik encji |
| I-5 (future date) | Średnia | Średnie (POST≠PUT) | Niespójny między create/edit | Wchłonę do agregatu |
| I-6, I-7, I-8 | Wysoka (I-7) / średnia | Niskie | **Dobrze egzekwowane** (DB) | Zostawić |

### Wybór i uzasadnienie

**Wybrany #1: I-1 — „Użytkownik ma co najwyżej 3 aktywne cele oszczędnościowe".**

Kryterium zadania to niezmiennik **jednocześnie rdzeniowy I najsłabiej egzekwowany**, oceniany na trzech osiach — a wzorzec docelowy (KROK 4) to *agregat-strażnik*: jedno miejsce egzekucji, repozytorium ładujące/zapisujące agregat, atomowość w jednej transakcji, przeniesienie egzekucji z klienta na serwer, błąd domenowy zamiast cichej aktualizacji.

Uczciwe zastrzeżenie: **najcenniejszym** niezmiennikiem jest I-2 (wedge, `roadmap.md:116`). Ale I-2 żyje w **jednej** czystej funkcji (`recommendations.ts`) — jest już scentralizowany; jego słabość to *poprawność kontraktu obliczenia*, nie *rozproszenie egzekucji*. Wzorzec agregatu-strażnika nie ma tam czego konsolidować (brak persystencji, brak transakcji, brak strażnika w kliencie, brak połykanego błędu). I-2 należy do osobnego planu (refaktor kontraktu `GoalRecommendation` — patrz distillation §Ranking #1).

I-1 jest natomiast **wzorcowym** przypadkiem dla tego wzorca, bo spełnia wszystkie trzy osie łącznie:
- **(a)** twarda, użytkownikowi-widoczna reguła (FR-007, `prd.md:79`);
- **(b)** maksymalnie rozsmarowana — DB + API + UI + niejawny kontrakt tekstu wyjątku;
- **(c)** najsłabiej i najbardziej niespójnie egzekwowana z reguł, które w ogóle mają wiele warstw: serwer aplikacyjny **nie liczy** celów, tylko **zgaduje** naruszenie po treści komunikatu (`goals.ts:51`), a semantyka „active" nie istnieje w modelu.

Dodatkowo I-1 to **niezmiennik kolekcji** („co najwyżej N w zbiorze") — podręcznikowy powód istnienia agregatu: pojedyncza encja `SavingsGoal` nie może pilnować reguły obejmującej rodzeństwo; granicą agregatu musi być cały *portfel celów użytkownika*. Przy okazji agregat wchłania I-4 i I-5 (własne niezmienniki encji `SavingsGoal`) i domyka rozjazd „active" (D1 z destylacji).

---

## KROK 3 — Diagnoza I-1 (gdzie dziś żyje reguła)

### 3.1 Persystencja — jedyny realny strażnik (ale liczy zły zbiór)

`supabase/migrations/20260527000000_data_schema_foundation.sql`, sekcja „4. 3-goal cap trigger":

```sql
CREATE OR REPLACE FUNCTION check_savings_goal_limit() ...
  IF (SELECT COUNT(*) FROM savings_goals WHERE user_id = NEW.user_id) >= 3 THEN
    RAISE EXCEPTION 'A user may not hold more than 3 active savings goals';
  ...
CREATE TRIGGER enforce_savings_goal_limit BEFORE INSERT ON savings_goals ...
```

- ✔ Atomowe (BEFORE INSERT w tej samej transakcji → brak realnego TOCTOU na tierze DB).
- ✗ **Liczy WSZYSTKIE cele**, nie „aktywne" — brak `WHERE target_date >= CURRENT_DATE`; komunikat mówi „active", zapytanie temu przeczy (rozjazd D1).
- ✗ Sygnalizuje naruszenie **prozą** (domyślny SQLSTATE `P0001`), zmuszając warstwy wyżej do parsowania tekstu.

### 3.2 Serwis data-access — reguły NIE ma

`src/lib/services/savings-goals.ts:16-30` — `createGoal` robi czysty `insert(...).select().single()`; **żadnego liczenia** ani preconditions. Reguła całkowicie deleguje w dół do triggera.

### 3.3 API — połknięcie/mistranslacja przez kruchy string-match

`src/pages/api/goals.ts:42-55`:

```ts
try {
  const goal = await createGoal(supabase, context.locals.user.id, {...});
  return jsonResponse({ goal }, 201);
} catch (error) {
  const message = error instanceof Error ? error.message : "Failed to create savings goal";
  if (message.includes("3 active savings goals")) {        // :51 — kruchy kontrakt na PROZIE
    return jsonResponse({ error: "You have reached the maximum of 3 active savings goals." }, 409);
  }
  return jsonResponse({ error: message }, 500);             // :54 — inaczej naruszenie „ucieka" jako 500
}
```

- ✗ **Serwer nie egzekwuje reguły** — tylko rozpoznaje ślad triggera po treści komunikatu.
- ✗ **Fail-open na literówce**: zmiana tekstu w triggerze (np. usunięcie „active") → naruszenie capa wraca jako **500**, nie 409. To „log-i-jedź" zamiast czystego fail-fast na nazwanym warunku.
- ✗ Ten kruchy kontrakt jest **zabetonowany testem** `src/pages/api/goals.test.ts:49-53` (`mockRejectedValue(new Error("... 3 active savings goals"))` → oczekuje 409) — test utrwala prozę jako API.

### 3.4 UI — drugi, niezależny strażnik (duplikacja reguły)

`src/components/goals/GoalsManager.tsx`:
- `:48` `const atGoalCap = goals.length >= 3;` — **reguła „3" zaszyta po raz drugi**, po stronie klienta.
- `:139` `if (atGoalCap || isSubmitting) return;` — klient **blokuje** wysłanie 4. celu.
- `:325 / :337 / :356` `disabled={atGoalCap}`, `:314` copy „max 3 active goals".

Skutek: przy dziś działającym triggerze klient jest w praktyce *pierwszym* strażnikiem; obejście UI (bezpośredni `curl` POST) trafia dopiero na trigger, a jego naruszenie jest mistranslowane (3.3). Liczba „3" i słowo „active" żyją w **czterech** miejscach (SQL, komunikat SQL, API-string, UI) bez jednego źródła prawdy.

### 3.5 Powiązane niezmienniki tej samej encji (do wchłonięcia)

- I-4 `target_amount > 0`: `goal-validation.ts:14` (zod) — egzekwowany na obu route'ach, **brak `CHECK` w DB** (`savings_goals.target_amount integer NOT NULL`).
- I-5 future-date: `goals.ts:14` (POST, bezwarunkowo) vs `goals/[id].ts:84` (PUT, tylko gdy data się zmienia) — logika rozdzielona i lekko rozjechana.

**Podsumowanie diagnozy:** I-1 nie ma właściciela. Jest „egzekwowana" przez skutek uboczny triggera, tłumaczona przez dopasowanie prozy i duplikowana w kliencie; definicja zbioru („active") jest niespójna między komunikatem a zapytaniem.

---

## KROK 4 — Projekt agregatu-strażnika: `SavingsGoalPortfolio`

### 4.1 Granica i model

**Agregat root: `SavingsGoalPortfolio`** — portfel celów jednego użytkownika. Jest JEDYNYM miejscem egzekwowania I-1 (i I-4, I-5 dla encji `SavingsGoal` w środku).

```
SavingsGoalPortfolio (root, boundary = wszystkie cele user_id)
├─ userId: UserId
├─ goals: SavingsGoal[]            // encje wewnątrz granicy
└─ niezmiennik: liczba AKTYWNYCH celów ≤ MAX_ACTIVE_GOALS (3)

SavingsGoal (encja w granicy agregatu)
├─ id, name (1..100), targetAmountCents (> 0), targetDate (realna data)
└─ isActive(today) := targetDate >= today
```

**Decyzja do potwierdzenia produktowego (domyka D1):** „aktywny" = `target_date >= today`. Cap liczy tylko aktywne; cele wygasłe nie zajmują slotu. To zmienia dzisiejsze zachowanie (dziś liczone są wszystkie). Bezpieczny wariant zachowawczy: `MAX = 3` nad *wszystkimi* celami (bez zmiany semantyki) — ale wtedy należy **usunąć słowo „active"** z FR-007/komunikatów. Rekomendacja: przyjąć `isActive = niewygasły`, bo tylko aktywne cele generują sensowne rekomendacje. Wartość `MAX_ACTIVE_GOALS` i definicja „active" to nowe **load-bearing** nazwy (KROK 5.4).

### 4.2 Nazwane błędy domenowe (fail-fast, bez cichej aktualizacji)

```ts
// src/lib/domain/errors.ts  (nowy)
export class DomainError extends Error {}
export class GoalCapExceededError extends DomainError {   // I-1
  readonly code = "GOAL_CAP_EXCEEDED";
  constructor(readonly max: number) { super(`A user may not hold more than ${max} active savings goals`); }
}
export class InvalidGoalError extends DomainError {        // I-4 / I-5 / nazwa
  readonly code = "INVALID_GOAL";
  constructor(readonly field: "name" | "target_amount" | "target_date", message: string) { super(message); }
}
```

### 4.3 Metody domenowe z preconditions

```ts
// src/lib/domain/savings-goal-portfolio.ts  (nowy) — czysty, bez I/O
const MAX_ACTIVE_GOALS = 3;

export class SavingsGoalPortfolio {
  private constructor(readonly userId: string, private readonly goals: SavingsGoal[]) {}

  static rehydrate(userId: string, goals: SavingsGoal[]): SavingsGoalPortfolio {
    return new SavingsGoalPortfolio(userId, goals);
  }

  private activeCount(today: Date): number {
    return this.goals.filter((g) => toDateOnly(g.target_date) >= today).length;
  }

  /** Precondition: activeCount < MAX. Zwraca DRAFT do zapisu; NIE dotyka DB. */
  addGoal(draft: NewGoalDraft, today: Date): NewGoalDraft {
    // I-4 / I-5 / nazwa — walidacja encji w jednym miejscu (fail-fast):
    SavingsGoalPortfolio.assertValidDraft(draft, { requireFutureDate: true, today });
    // I-1 — niezmiennik kolekcji:
    if (this.activeCount(today) >= MAX_ACTIVE_GOALS) throw new GoalCapExceededError(MAX_ACTIVE_GOALS);
    return draft;
  }

  /** Edycja: I-1 nie dotyczy (brak nowego celu); future-date tylko gdy data się zmienia. */
  editGoal(existing: SavingsGoal, patch: GoalPatch, today: Date): GoalPatch {
    const dateChanged = patch.target_date !== existing.target_date;
    SavingsGoalPortfolio.assertValidDraft(patch, { requireFutureDate: dateChanged, today });
    return patch;
  }

  static assertValidDraft(d: {name: string; target_amount: number; target_date: string},
                          opts: {requireFutureDate: boolean; today: Date}): void {
    if (d.name.trim().length < 1 || d.name.trim().length > 100)
      throw new InvalidGoalError("name", "Goal name must be 1–100 characters");
    if (!Number.isInteger(d.target_amount) || d.target_amount <= 0)          // I-4
      throw new InvalidGoalError("target_amount", "Target amount must be greater than 0");
    if (!isRealDate(d.target_date))                                          // I-5
      throw new InvalidGoalError("target_date", "Target date must be a valid date");
    if (opts.requireFutureDate && !isFutureDate(d.target_date, opts.today))
      throw new InvalidGoalError("target_date", "Target date must be in the future");
  }
}
```

`src/lib/goal-validation.ts` zostaje jako *parser wejścia* (zod: kształt/typ, dolary→centy w route), ale **reguły biznesowe** (>0, future, cap) stają się wyłączną własnością agregatu.

### 4.4 Repozytorium — ładuje/zapisuje agregat, tłumaczy naruszenie DB po STABILNYM kodzie

```ts
// src/lib/repositories/savings-goal-repository.ts  (nowy)
export class SavingsGoalRepository {
  constructor(private readonly client: SupabaseClient) {}

  /** Ładuje CAŁY portfel (nie rozsiane zapytania). RLS scopuje do właściciela (I-7). */
  async load(userId: string): Promise<SavingsGoalPortfolio> {
    const { data, error } = await this.client.from("savings_goals").select("*").order("created_at");
    if (error) throw new Error(error.message);
    return SavingsGoalPortfolio.rehydrate(userId, data as SavingsGoal[]);
  }

  /** Insert + tłumaczenie naruszenia capa po SQLSTATE (nie po treści!). */
  async add(userId: string, draft: NewGoalDraft): Promise<SavingsGoal> {
    const { data, error } = await this.client.from("savings_goals")
      .insert({ ...draft, user_id: userId }).select().single();
    if (error) {
      if (error.code === "SL001") throw new GoalCapExceededError(MAX_ACTIVE_GOALS); // stabilny kontrakt
      throw new Error(error.message);
    }
    return data as SavingsGoal;
  }
}
```

**Atomowość (I-1 to niezmiennik kolekcji → wyścig w app-tier):** ostatecznym strażnikiem pozostaje **trigger w JEDNEJ transakcji z insertem** — app-tier `activeCount()` służy szybkiemu fail-fast i dobremu UX, ale nie jest źródłem prawdy przy współbieżności. Migracja podnosi trigger do stabilnego kontraktu i poprawnego zbioru:

```sql
-- nowa migracja YYYYMMDDHHmmss_goal_cap_active_and_errcode.sql (PLAN)
CREATE OR REPLACE FUNCTION check_savings_goal_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM savings_goals
        WHERE user_id = NEW.user_id AND target_date >= CURRENT_DATE) >= 3 THEN   -- „active"
    RAISE EXCEPTION 'savings goal cap exceeded' USING ERRCODE = 'SL001';         -- stabilny kod
  END IF;
  RETURN NEW;
END; $$;
-- oraz belt-and-suspenders dla I-4:
ALTER TABLE savings_goals ADD CONSTRAINT savings_goals_amount_positive CHECK (target_amount > 0);
```
*(Uwaga: `CURRENT_DATE` po stronie DB używa strefy serwera; zgodnie z `lessons.md` serwer/Vercel działa w UTC, tak jak `todayUtc()` w route'ach — spójne.)*

### 4.5 Cienki route: parse → metoda agregatu → mapowanie błędu

```ts
// src/pages/api/goals.ts (POST) — PO refaktorze (szkic)
const parsed = createGoalSchema.safeParse(await req.json());   // parse wejścia (zod: kształt + dolary)
if (!parsed.success) return jsonResponse({ error: parsed.error.issues[0].message }, 400);

const repo = new SavingsGoalRepository(supabase);
const portfolio = await repo.load(user.id);
try {
  const draft = portfolio.addGoal(toCents(parsed.data), todayUtc());   // niezmiennik na SERWERZE
  const goal = await repo.add(user.id, draft);
  return jsonResponse({ goal }, 201);
} catch (e) {
  if (e instanceof GoalCapExceededError)  return jsonResponse({ error: "You have reached the maximum of 3 active savings goals." }, 409);
  if (e instanceof InvalidGoalError)      return jsonResponse({ error: e.message }, 400);
  console.error("POST /api/goals failed:", e);
  return jsonResponse({ error: "Failed to create savings goal" }, 500);
}
```

- **Egzekucja przenosi się z klienta na serwer:** agregat odrzuca 4. cel niezależnie od UI; obejście `curl` również dostaje **409 (nazwany błąd)**, nigdy 500-z-połknięcia.
- **UI degraduje się do afordancji:** `atGoalCap`/`disabled` zostają jako podpowiedź UX, ale przestają być *strażnikiem*; „3" znika z logiki klienta na rzecz sygnału z serwera (409 → komunikat).

---

## KROK 5 — Before/After, plan faz, testy, nazwy

### 5.1 Before / After (każde dzisiejsze miejsce reguły)

| Miejsce (plik:linia) | Before | After |
|---|---|---|
| `migration` trigger | `COUNT(*)` wszystkich; `RAISE EXCEPTION 'A user may not hold more than 3 active…'` (proza, SQLSTATE P0001) | `COUNT(*) WHERE target_date >= CURRENT_DATE`; `RAISE … USING ERRCODE='SL001'`; + `CHECK (target_amount > 0)` |
| `savings-goals.ts:16` `createGoal` | goły insert, zero reguł | zastąpione `SavingsGoalRepository.add()` (mapuje `SL001`→`GoalCapExceededError`) |
| `goals.ts:51-54` | `message.includes("3 active savings goals")` → 409, inaczej 500 | `catch (GoalCapExceededError)`→409, `(InvalidGoalError)`→400, reszta→500 (generic) |
| `goals.ts` (przepływ) | insert-then-guess | `repo.load()` → `portfolio.addGoal()` (precondition) → `repo.add()` |
| `goals/[id].ts:84` (PUT future-date) | reguła inline w handlerze | `portfolio.editGoal()` (jedno źródło reguły future-date) |
| `goal-validation.ts:14` | zod = jedyny strażnik `>0` | zod parsuje kształt; `>0` egzekwuje agregat + DB `CHECK` |
| `GoalsManager.tsx:48,139,314…` | klient = współ-strażnik reguły „3/active" | afordancja UX; brak liczby-reguły w logice; działa na 409 z serwera |
| `goals.test.ts:49-53` | zabetonowuje prozę wyjątku jako kontrakt | test na `GoalCapExceededError`→409 (kontrakt = typ błędu, nie tekst) |

### 5.2 Plan faz (test-first tam, gdzie jest logika czysta)

Projekt ma dyscyplinę test-first + runnery (Vitest unit/integration, Stryker, Playwright). Kolejność:

1. **[TEST-FIRST] Agregat `SavingsGoalPortfolio` + błędy domenowe** — czysta logika, idealna dla TDD (red→green→refactor). Bez I/O. `TZ=UTC`, `today` wstrzykiwane (lessons.md: brak ambientnego czasu).
2. **[TEST-FIRST] `SavingsGoalRepository`** — unit z mockiem Supabase: mapowanie `error.code==='SL001'`→`GoalCapExceededError`; passthrough innych błędów.
3. **Refaktor route'ów** (`goals.ts`, `goals/[id].ts`) do przepływu load→metoda→map; **zaktualizować** istniejące hermetyczne testy (`goals.test.ts`, `[id].test.ts`) na kontrakt typu-błędu zamiast prozy.
4. **Migracja DB** (`errcode SL001`, `WHERE target_date>=CURRENT_DATE`, `CHECK amount>0`). **[INTEGRACJA]** dodać `tests/integration/savings-goal-cap.test.ts` (realny lokalny Supabase — dziś katalog pusty) dowodzący capa i izolacji per-user na realnym triggerze.
5. **UI** — zdegradować `GoalsManager` strażnika do afordancji; usunąć zaszytą „3" z logiki, oprzeć komunikat na 409. **[E2E]** Playwright: próba 4. celu pokazuje komunikat capa (per `/10x-e2e`, ryzyko „przekroczenie capa").
6. **Mutacja (Stryker)** na module agregatu — próg operatorów granicznych (`>=` vs `>`, `MAX-1`).

### 5.3 Przypadki testowe dla niezmiennika (legalne / nielegalne)

**Agregat (unit, test-first):**
- ✔ `addGoal` przy 0/1/2 aktywnych → zwraca draft.
- ✗ `addGoal` przy 3 aktywnych → rzuca `GoalCapExceededError(3)` (nie modyfikuje stanu).
- ✔ `addGoal` przy 3 celach z czego 1 **wygasły** (`target_date < today`) → **przechodzi** (aktywne = 2). *(dowodzi definicji „active"; blokuje regresję D1)*
- **granica:** dokładnie 2 aktywne → ✔; dokładnie 3 → ✗ (test operatora `>=`).
- ✗ `target_amount = 0` / ujemne / niecałkowite → `InvalidGoalError("target_amount")`.
- ✗ `name` pusty / >100 znaków → `InvalidGoalError("name")`.
- ✗ create z datą przeszłą/dzisiejszą → `InvalidGoalError("target_date")`; ✔ data jutrzejsza.
- ✔ `editGoal` bez zmiany daty na **wygasłym** celu (rename) → przechodzi; ✗ zmiana daty na przeszłą → błąd.

**Repozytorium (unit):** `error.code==='SL001'`→`GoalCapExceededError`; inny kod → generyczny `Error` (nie mylony z capem).

**Route (unit, hermetyczny):** cap→**409**; walidacja→400; sukces→201; **regres kluczowy:** zmiana treści komunikatu triggera NIE psuje mapowania (kontrakt = kod/typ, nie proza).

**Integracja (realny Supabase):** 4. insert aktywnego celu → wyjątek `SL001`; user B nie widzi/nie liczy celów usera A (I-7); `CHECK` odrzuca `target_amount<=0`.

**E2E:** UI blokuje formularz przy 3 aktywnych i pokazuje komunikat 409 przy próbie obejścia.

### 5.4 Nowe nazwy „load-bearing" do rejestru kontraktów

Jeśli projekt prowadzi rejestr kontraktów (typy/nazwy współdzielone — `src/types.ts`, konwencje), zarejestrować:

- `SavingsGoalPortfolio` — agregat root (granica = cele jednego usera).
- `MAX_ACTIVE_GOALS = 3` — jedyne źródło liczby capa.
- Definicja **„active goal"** := `target_date >= today` (kontrakt semantyczny, domyka FR-007/D1).
- `GoalCapExceededError` (code `"GOAL_CAP_EXCEEDED"`) i `InvalidGoalError` (code `"INVALID_GOAL"`) — nazwane błędy domenowe.
- SQLSTATE **`SL001`** — stabilny kontrakt „cap exceeded" między triggerem a `SavingsGoalRepository` (zastępuje kruchy string-match z `goals.ts:51`).
- `SavingsGoalRepository` (`load` / `add`) — brama persystencji agregatu.

---

## Podsumowanie

Spośród ośmiu zidentyfikowanych niezmienników wybrałem I-1 — „użytkownik ma co najwyżej 3 aktywne cele oszczędnościowe" (FR-007, `prd.md:79`) — jako refaktor #1, bo jest jednocześnie twardą regułą produktu, maksymalnie rozsmarowaną po warstwach (trigger DB + string-match w API + strażnik w UI + niejawny kontrakt treści wyjątku) i najsłabiej/niespójnie egzekwowaną: serwer aplikacyjny nie liczy celów, tylko zgaduje naruszenie po prozie komunikatu (`goals.ts:51`), a naruszenie „ucieka" jako 500 zamiast czystego 409, gdy tekst się nie zgadza. Świadomie NIE wybrałem najcenniejszego niezmiennika (I-2, wedge rekomendacji), bo żyje on w jednej czystej funkcji — to problem kontraktu obliczenia, nie rozproszenia, więc wzorzec agregatu-strażnika tam nie pasuje. Diagnoza pokazuje, że liczba „3" i słowo „active" żyją w czterech miejscach bez źródła prawdy, a semantyka „active" jest wewnętrznie sprzeczna (komunikat mówi „active", zapytanie liczy wszystkie — rozjazd D1). Projekt wprowadza agregat `SavingsGoalPortfolio` jako jedyne miejsce egzekucji: metody `addGoal`/`editGoal` z preconditions rzucającymi nazwane błędy domenowe (`GoalCapExceededError`, `InvalidGoalError`), repozytorium ładujące/zapisujące cały portfel i tłumaczące naruszenie po stabilnym SQLSTATE `SL001` (nie po tekście), oraz cienkie route'y mapujące błąd domenowy na 409/400 — z atomowością utrzymaną przez trigger w jednej transakcji z insertem. Egzekucja przenosi się z klienta na serwer (UI degraduje się do afordancji UX), a plan faz jest test-first dla logiki czystej, z pełną listą przypadków legalnych i nielegalnych oraz nowymi nazwami load-bearing do rejestru kontraktów.
