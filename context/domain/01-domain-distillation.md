---
title: SpendLens — Destylacja domeny (Domain Distillation Map)
created: 2026-07-13
type: domain-distillation
---

# SpendLens — Destylacja domeny

> Mapa domeny biznesowej wydestylowana z dokumentów źródłowych ORAZ z kodu.
> Produktem jest mapa, nie kod. Wszystkie cytaty odwołują się do realnie
> zweryfikowanych plików i linii (`plik:linia`).

## KROK 0 — Kontekst projektu

**Dokumenty źródłowe (znalezione i przeczytane):**

- `context/foundation/prd.md` — Product Requirements Document (v1, `context_type: greenfield`, `product_type: web-app`). Główne źródło wymagań (FR-001…FR-011, US-01, Business Logic, NFR, Access Control, Non-Goals).
- `context/foundation/shape-notes.md` — notatki kształtowania idei + **seed idea (verbatim)** (`shape-notes.md:32`), zawierające pierwotny zakres (m.in. promocje i tańsze zamienniki — później odesłane do v2).
- `context/foundation/roadmap.md` — rozbicie PRD na pionowe wycinki (F-01, S-01…S-08), wszystkie w statusie `done`; zawiera rozstrzygnięcia otwartych pytań (taksonomia kategorii, próg alertu, format eksportu).
- `context/foundation/lessons.md` — rejestr powtarzalnych reguł (determinizm dat/locale, try/catch w SSR).
- `README.md`, `CLAUDE.md`, `AGENTS.md` — reguły techniczne i konwencje.
- `context/archive/*` — historia zmian (plan-brief / plan / research / impl-review dla każdego wycinka).

**Stack i struktura (gdzie żyje logika biznesowa):**

- Astro 6 SSR + React 19 islands + Tailwind 4 + Supabase (auth + Postgres), deploy Vercel (`CLAUDE.md`, `astro.config.mjs`).
- Warstwy:
  - **Domena / logika czysta:** `src/lib/services/*` (`recommendations.ts`, `spending-summary.ts`, `simulated-bank.ts`, `transaction-categorizer.ts`, `import-transactions.ts`) + `src/lib/goal-validation.ts`.
  - **Persystencja (data-access):** `src/lib/services/{savings-goals,transactions,categories}.ts` (cienkie wrappery Supabase).
  - **API:** `src/pages/api/**` (`goals.ts`, `goals/[id].ts`, `transactions/{import,export}.ts`).
  - **UI/SSR:** `src/pages/*.astro` + `src/components/**`.
  - **Schemat danych + niezmienniki DB:** `supabase/migrations/20260527000000_data_schema_foundation.sql`.
  - **Typy współdzielone (encje/DTO):** `src/types.ts`.

**Ograniczenie:** dokumenty wymagań istnieją i są bogate, więc analiza NIE opiera się wyłącznie na kodzie. Jedno zastrzeżenie: PRD i roadmapa są ze sobą lekko niespójne w treści FR-008 (patrz KROK 4, rozjazd wewnątrz dokumentów) — jako aktualny traktuję `prd.md` (nowszy `updated`).

---

## KROK 1 — Ubiquitous Language

Dla każdego pojęcia: definicja → cytat źródłowy (dokument) → miejsce w kodzie (lub „BRAK w kodzie").

| Pojęcie | Definicja (język domeny) | Źródło (dokument) | W kodzie |
|---|---|---|---|
| **Goal-Saver** | Persona: osoba z konkretnym celem oszczędnościowym (kwota + termin) i podłączonym kontem, która regularnie nie domyka celu. | `prd.md:26` „Primary persona: The Goal-Saver" | BRAK w kodzie (koncept produktowy, nie encja) |
| **Savings Goal** | Cel oszczędnościowy = nazwa + kwota docelowa + termin. | `prd.md:76` (FR-006) | `types.ts:29` `SavingsGoal`; `savings-goals.ts:16` `createGoal`; migracja `savings_goals` |
| **Target amount** | Kwota docelowa celu, przechowywana jako całkowite centy. | `prd.md:76` | `types.ts:35` `target_amount`; walidacja `goal-validation.ts:14` |
| **Timeframe / Target date** | Termin osiągnięcia celu (data kalendarzowa). | `prd.md:76` „target amount and a timeframe" | `types.ts:37` `target_date`; `goal-validation.ts:17` `isoDateSchema` |
| **Active goal (≤ 3)** | „Aktywny" cel; użytkownik może mieć do 3 jednocześnie. | `prd.md:79` (FR-007) | ⚠ „active" NIE istnieje jako stan — trigger liczy WSZYSTKIE cele (`migration` `check_savings_goal_limit`); „active" pojawia się tylko w copy UI `GoalsManager.tsx:314` i komunikacie `goals.ts:52`. Patrz rozjazd D1. |
| **Transaction** | Pojedynczy ruch pieniężny (przychód lub wydatek) użytkownika. | `prd.md:72` (FR-005) | `types.ts:9` `Transaction`; `transactions.ts` |
| **Income / Expense (type)** | Znak transakcji niesiony przez `type`, nigdy przez kwotę. | `prd.md:72`, Business Logic `prd.md:108` | `types.ts:1` `TransactionType`; `simulated-bank.ts:16` |
| **Amount (cents)** | Kwota jako dodatnia liczba całkowita centów. | (konwencja) | `types.ts:13` „Always positive"; migracja `amount integer NOT NULL` (bez `> 0`). Patrz D4. |
| **Category / Taksonomia (11 stałych)** | Stały słownik 11 kategorii; `Other` jako fallback. | `roadmap.md:200` (Q3 resolved) | `types.ts:3` `Category`; seed w migracji; `transaction-categorizer.ts:15` typ `CategorySlug` |
| **Auto-categorization** | Automatyczne przypisanie kategorii na podstawie opisu. | `prd.md:69` (FR-004), `roadmap.md:90` | `transaction-categorizer.ts:64` `categorize()` (skan słów kluczowych) |
| **Simulated Banking API / Connect Bank** | Źródło danych bankowych: symulowane API, z którym użytkownik „łączy" konto. | `prd.md:65` (FR-003) | `simulated-bank.ts:109` `generateTransactions` (deterministyczny generator w repo). „Connect/konto" — patrz D8. |
| **Import (idempotentny)** | Pobranie i utrwalenie transakcji; ponowne łączenie nie duplikuje. | `roadmap.md:83` (S-01) | `import-transactions.ts:23`; klucz `external_id` + `UNIQUE(user_id, external_id)` |
| **Monthly income** | Suma przychodów w oknie (30 dni), wejście do reguły. | `prd.md:108` | `recommendations.ts:40` `monthlyIncomeCents` |
| **Monthly surplus** | Miesięczny przychód − miesięczne wydatki. | `prd.md:111` | `recommendations.ts:44` `monthlySurplusCents` |
| **Required monthly saving** | Ile trzeba oszczędzać miesięcznie, by domknąć cel w terminie. | `prd.md:111` | `recommendations.ts:72` `requiredMonthlySavingCents` |
| **Gap** | Brakująca kwota = wymagane oszczędzanie − nadwyżka (≥ 0). | `prd.md:111` „close the gap" | `recommendations.ts:73` `gapCents` |
| **On track** | Cel osiągalny bez cięć (gap = 0). | (wyprowadzone z reguły) | `recommendations.ts:74` `isOnTrack` |
| **Suggestion (expense-cutting)** | Konkretne cięcie: kategoria + szacowana oszczędność. | `prd.md:89` (FR-010), `prd.md:51` (AC) | `types.ts:41` `Suggestion`; `recommendations.ts:76-89` |
| **Excessive spending alert** | Alert dla kategorii przekraczającej próg 12% miesięcznego przychodu. | `prd.md:86` (FR-009), `prd.md:132` (próg) | `types.ts:48` `SpendingAlert`; `recommendations.ts:12,53-65` |
| **Threshold (12% income)** | `floor(monthly_income × 0.12)`, alert gdy `spend > threshold`; brak alertów przy income = 0. | `prd.md:132` | `recommendations.ts:12` `ALERT_INCOME_FRACTION` |
| **Expired goal** | Cel z terminem w przeszłości. | (wyprowadzone) | `types.ts:63` `isExpired`; `recommendations.ts:70`. Wciąż liczony do capa i dostaje rekomendacje — patrz D1. |
| **Spending Summary / Dashboard** | Podsumowanie wydatków pogrupowane po kategorii (kwoty + %). | `prd.md:69` (FR-004) | `types.ts:86` `SpendingSummary`; `spending-summary.ts:61` `computeSpendingSummary` |
| **Export (CSV)** | Pobranie skategoryzowanych transakcji jako `text/csv`. | `prd.md:130` (Q1 resolved) | `transactions-csv.ts`; `export.ts:15` |
| **Per-user isolation (RLS)** | Ścisła izolacja danych — każdy widzi tylko swoje. | `prd.md:98` (NFR) | Polityki RLS w migracji (`user_id = auth.uid()`) |

---

## KROK 2 — Klasyfikacja subdomen (Core / Supporting / Generic)

Rdzeń = to, co jest przewagą produktu. Wg roadmapy „the product wedge … is that recommendations are *goal-anchored*" (`roadmap.md:20`) i north star S-06 (`roadmap.md:24`).

| Obszar / pojęcie | Kategoria | Uzasadnienie (odwołanie do celów) |
|---|---|---|
| **Silnik rekomendacji goal-anchored** (surplus → required saving → gap → ranking cięć) | **CORE** | To „the wedge" — `roadmap.md:20`; north star `roadmap.md:24`; „spending insight is only useful when it is goal-anchored and actionable" `prd.md:22`. Bez tego produkt = generyczny budżetowy. Kod: `recommendations.ts`. |
| **Excessive-spending alerts (próg 12%)** | **CORE** | Sprzężone z FR-010 w jednej sekcji; „Neither is useful alone; together they close the loop" `prd.md:87`. Współdzieli dane i bucketing z silnikiem. |
| **Auto-categorization / taksonomia** | **SUPPORTING** | Warstwa różnicująca względem surowej listy banku (`prd.md:73`), ale sama w sobie nie jest przewagą — jest wejściem do rdzenia. Kod: `transaction-categorizer.ts`. |
| **Savings goals (CRUD + cap 3)** | **SUPPORTING** | Cele są wejściem rdzenia; wartość powstaje dopiero w rekomendacjach (`prd.md:77`). Zarządzanie celami to wsparcie, nie sedno. |
| **Import z symulowanego banku** | **SUPPORTING** | Konieczne, by dane w ogóle były (`roadmap.md:81`), ale symulacja jest jawnie tymczasowa (`prd.md:122` Non-Goals). |
| **Spending summary / dashboard** | **SUPPORTING** | „Keep this slice thin — it is not the wedge" `roadmap.md:128`. Pierwsza powierzchnia po imporcie, ale nie przewaga. |
| **Transactions list** | **SUPPORTING** | „A raw list duplicates the bank app's view" — wartość tylko przez kategorię `roadmap.md:140`. |
| **Export CSV** | **SUPPORTING** (nice-to-have) | FR-011 oznaczone `nice-to-have` `prd.md:93`; „easiest slice to defer" `roadmap.md:165`. |
| **Auth (email + hasło)** | **GENERIC** | „email/password is a valid first-class auth path for an MVP" `prd.md:59`; realizowane standardowo przez Supabase, brak logiki domenowej. |
| **RLS / izolacja danych** | **GENERIC** (mechanizm) egzekwujący **CORE guardrail** | Mechanizm generyczny (Postgres RLS), ale egzekwuje twardy guardrail produktu `prd.md:39,98`. |
| **Money-as-cents / formatowanie** | **GENERIC** | Konwencja techniczna (`types.ts:13`, `format-money.ts`). |

**Wniosek:** jedyny prawdziwy Core to `recommendations.ts` (silnik + alerty). Cała reszta to wsparcie i infrastruktura, która ma sens tylko o tyle, o ile zasila rdzeń.

---

## KROK 3 — Kandydaci na agregaty i ich niezmienniki

| Kandydat na agregat (root) | Niezmiennik (MUSI być zawsze prawdziwy) | Cytat źródłowy | Status egzekwowania w kodzie |
|---|---|---|---|
| **SavingsGoal** (per użytkownik) | Użytkownik ma **≤ 3** cele jednocześnie. | `prd.md:79` (FR-007) | **Egzekwowany** przez trigger DB `check_savings_goal_limit` (BEFORE INSERT). Dodatkowo UI `GoalsManager.tsx:48` (`atGoalCap`) i API łapie wyjątek `goals.ts:51`. ⚠ Trigger liczy WSZYSTKIE cele, nie „aktywne" (D1); sprzężenie API↔DB przez string-match (D2). |
| **SavingsGoal** | `target_amount` > 0. | `goal-validation.ts:14` „must be greater than 0" | **Deklarowany** (zod na API `goals.ts`, `goals/[id].ts`). **Ignorowany** przez DB — brak `CHECK (target_amount > 0)` w migracji. |
| **SavingsGoal** | Termin celu jest realną datą; przy tworzeniu — w przyszłości. | `prd.md:76`; reguła w `goal-validation.ts:26` | **Egzekwowany** przy POST (`goals.ts:14`); przy PUT warunkowo — tylko gdy data się zmienia (`goals/[id].ts:84`). Nie egzekwowane w DB. |
| **Transaction / Ledger** (per użytkownik) | Kwota zawsze dodatnia; znak niesie `type`. | `types.ts:13`; `simulated-bank.ts:17` | **Deklarowany** (komentarz typu) i **produkowany** przez generator. **Ignorowany** przez DB (`amount integer NOT NULL`, brak `> 0`) — patrz D4. |
| **Transaction** | Idempotencja importu: jedna transakcja per `(user_id, external_id)`. | `roadmap.md:83` (S-01), `import-transactions.ts:4` | **Egzekwowany** — `UNIQUE (user_id, external_id)` + upsert `ignoreDuplicates` (`transactions.ts:25`). |
| **Transaction** | `type ∈ {income, expense}`. | `types.ts:1` | **Egzekwowany** — `CHECK (type IN ('income','expense'))` w migracji. |
| **Wszystkie encje** | Ścisła izolacja per-user; brak dostępu międzykontowego. | `prd.md:98` (NFR), `prd.md:39` | **Egzekwowany** — polityki RLS `user_id = auth.uid()` na `transactions` i `savings_goals`. |
| **Category** (dane referencyjne) | Stały zbiór 11 slugów; `other` jako fallback. | `roadmap.md:200` | **Egzekwowany częściowo** — seed w migracji + `UNIQUE(slug)`; ale typ `CategorySlug` (`transaction-categorizer.ts:15`) to druga, niezależna deklaracja tych samych 11 wartości (ryzyko dryfu z DB). |

**Uwaga o agregacie „Recommendations":** `RecommendationsResult`/`GoalRecommendation` (`types.ts:57-77`) NIE są agregatem persystentnym — to **wynik usługi domenowej** (`computeRecommendations`, funkcja czysta liczona na żądanie). To dobra decyzja: brak cache'u = edycja/usunięcie celu wpływa na kolejne wyliczenie bez inwalidacji (`prd.md:83`, `roadmap.md:177`).

---

## KROK 4 — Rozjazdy MODEL vs KOD

Najcenniejsza część: gdzie wiedza domenowa istnieje w dokumencie, a kod jej nie odwzorowuje (lub odwzorowuje inaczej).

| # | Dokument mówi (X) | Kod robi (Y) | Dowód (plik:linia) |
|---|---|---|---|
| **D1** | Do 3 **aktywnych** celów; „active savings goals" (FR-007). Słowo „active" sugeruje stan/cykl życia. | Nie istnieje pojęcie „active" — brak kolumny `status`/`is_active`. Trigger liczy WSZYSTKIE cele użytkownika. Cel **wygasły** (`isExpired`) nadal zajmuje slot capa i nadal generuje rekomendacje. „active" to tylko tekst w UI/komunikacie. | `prd.md:79`; migracja `check_savings_goal_limit` (`COUNT(*) … WHERE user_id = NEW.user_id`); `recommendations.ts:70-102`; `GoalsManager.tsx:314`; `goals.ts:52` |
| **D2** | Reguła capa to niezmiennik domenowy (FR-007). | Egzekucja poprawnie w DB, ale API rozpoznaje ją przez **kruche dopasowanie stringa** komunikatu wyjątku. Zmiana treści komunikatu w triggerze → API zwróci 500 zamiast 409. | `goals.ts:51` `message.includes("3 active savings goals")` vs `migration` `RAISE EXCEPTION 'A user may not hold more than 3 active savings goals'` |
| **D3** | „surfaces the **minimum set of cuts that would close the gap**" (Business Logic). AC: „At least one suggestion … Suggestions are mathematically correct". | Zachłanny wybór od największej kategorii, **twardo obcięty do 5** sugestii (`MAX_SUGGESTIONS`). Jeśli 5 największych kategorii nie pokrywa luki, `remaining > 0` — luka NIE zostaje domknięta, a lista nie jest gwarantowanie „minimalna". | `prd.md:111`; `recommendations.ts:13,77-89` |
| **D4** | Kwota „Always positive"; znak niesie `type`. | Niezmiennik zadeklarowany w typie i pilnowany przez generator, ale **DB nie egzekwuje** `amount > 0` — dozwolony insert 0/ujemnej kwoty (RLS przepuszcza, gdy `user_id` się zgadza). | `types.ts:13`; migracja `amount integer NOT NULL` (brak `CHECK > 0`) |
| **D5** | Wizja: kategorie „excessive **relative to your goal**". | Alerty są **relative to income** (12% miesięcznego przychodu), całkowicie niezależne od celu. (PRD Business Logic doprecyzowuje „relative to income" — więc rozjazd jest między *narracją wizji* a implementacją; próg income-relative jest zgodny z FR-009.) | `prd.md:22` vs `prd.md:114,132`; `recommendations.ts:53-65` |
| **D6** | „single source of truth shared with the dashboard so the two views can never disagree on spending" (komentarz w kodzie). | Wspólny jest tylko **bucketing** (`summarizeByCategory`), ale **okna czasowe się różnią**: dashboard = bieżący **miesiąc kalendarzowy** (`computeSpendingSummary`), rekomendacje/alerty = **kroczące 30 dni** (`WINDOW_DAYS`). Te same kategorie mogą pokazać różne kwoty na obu ekranach. | `spending-summary.ts:22,61-69`; `recommendations.ts:11,30-35` |
| **D7** | Cel to (kwota + termin); reguła liczy „additional monthly saving required to reach each goal". | Brak pojęcia **postępu/już-odłożonej kwoty** — `requiredMonthlySaving = ceil(target_amount / months)` zakłada start od zera przy każdym wyliczeniu. Model celu nie ma `current_amount`. Spójne z minimalizmem PRD, ale reguła nie potrafi „odliczyć" dotychczasowych oszczędności. | `prd.md:76,111`; `types.ts:29-39` (brak pola postępu); `recommendations.ts:72` |
| **D8** | „connect their **account** to the simulated banking API" (FR-003) — implikuje encję połączenia/konta. | Brak encji `bank_account`/`connection`; „połączenie" to jednorazowe wywołanie deterministycznego generatora w repo. Tożsamość źródła nosi wyłącznie `external_id = sim-${userId}-${i}`. (Jawnie zaakceptowane jako wybór implementacyjny w PRD.) | `prd.md:66`; `simulated-bank.ts:109-113`; `import-transactions.ts:23` |
| **D9** (wewn. dokumentów) | Rozjazd w samych źródłach: `shape-notes.md:92` „edit … → v2 backlog. Delete only in MVP" vs `prd.md:83` „edit is now in scope and shipped". | Kod ma pełną edycję (PUT). Zgodny z nowszym PRD; shape-notes są nieaktualne. | `shape-notes.md:92` vs `prd.md:83`; `goals/[id].ts:46` |

---

## KROK 5 — Ranking refaktoru

Szeregowanie kandydatów wg **wartości** (jak rdzeniowy jest niezmiennik) × **ryzyka** (jak słabo dziś egzekwowany).

| Ranga | Niezmiennik / rozjazd | Wartość (rdzeń?) | Ryzyko (słabość egzekucji) | Rekomendacja |
|---|---|---|---|---|
| **#1** | **D3 — „close the gap" vs twardy cap 5 i brak gwarancji domknięcia** | **Bardzo wysoka** — to sedno wedge'a (`roadmap.md:116` „If the suggestions feel wrong … the entire product hypothesis takes the hit"). | **Wysokie** — cicha niepoprawność: przy dużej luce sugestie nie sumują się do gapu, a użytkownik nie wie, że lista jest ucięta. Brak niezmiennika „suma sugestii ≥ gap lub jawny sygnał niedomknięcia". | **#1 do refaktoru.** Uczynić `computeRecommendations` prawdziwym agregatem reguły: jawny stan „gap niedomknięty" (residual) w `GoalRecommendation`, świadoma decyzja o cap 5 (albo podnieść, albo pokazać „i N więcej"). Najpierw test na hand-worked example (zgodnie z `roadmap.md:116`). |
| **#2** | **D1 — fantomowe „active"; wygasłe cele liczone do capa i rekomendowane** | Wysoka — dotyka capa (FR-007) i sensu rekomendacji. | Wysokie — semantyka „active" nigdzie nieodwzorowana; wygasły cel zaśmieca wedge agresywnymi cięciami (`months` floored do 1). | Zdefiniować, czym jest „active" (np. `target_date >= today`), i albo wykluczyć wygasłe z capa i/lub z rekomendacji, albo świadomie usunąć słowo „active" z PRD. Domknąć jako niezmiennik agregatu SavingsGoal. |
| **#3** | **D4 — `amount > 0` niewymuszony w DB** | Średnia (transakcje = Supporting, ale zasilają całą matematykę rdzenia). | Wysokie — jedna ujemna/zerowa kwota psuje sumy income/surplus/alertów w całym Core. | Dodać `CHECK (amount > 0)` w migracji (przenieść niezmiennik z komentarza do bazy — jedyne źródło prawdy dla ledgera). |
| **#4** | **D6 — dwie definicje „miesiąca" (kalendarz vs 30 dni krocz.)** | Średnia — podważa obietnicę spójności między dashboardem a rekomendacjami. | Średnie — komentarz o „single source of truth" usypia czujność; kwoty mogą się różnić bez alarmu. | Ujednolicić okno (jedna stała/parametr) lub jawnie udokumentować i nazwać różnicę w modelu. |
| **#5** | **D2 — sprzężenie API↔DB przez string komunikatu** | Niska/średnia. | Średnie — regresja przy zmianie tekstu wyjątku (500 zamiast 409). | Zastąpić stabilnym sygnałem (kod błędu Postgresa / dedykowany `errcode` w triggerze) lub kontraktem serwisu. |

**Wskazanie #1:** refaktor **silnika rekomendacji** (`recommendations.ts`) wokół rozjazdu **D3**. Jest to jedyny obszar Core, jego niezmiennik („cięcia domykają lukę") jest najsłabiej egzekwowany, a błąd tutaj uderza wprost w hipotezę produktu — dokładnie ostrzeżenie z `roadmap.md:116`.

---

## Podsumowanie

Artefakt destyluje domenę SpendLens z PRD, shape-notes, roadmapy i kodu w pięciu krokach: Ubiquitous Language (23 pojęcia z cytatami źródło↔kod), klasyfikację subdomen, kandydatów na agregaty z niezmiennikami, rejestr rozjazdów model↔kod oraz ranking refaktoru. Jedynym prawdziwym rdzeniem (Core) jest silnik rekomendacji goal-anchored wraz z alertami nadmiernych wydatków — reszta (kategoryzacja, cele, import, dashboard, eksport) to warstwa wspierająca, która ma sens tylko o tyle, o ile zasila rdzeń. Model danych jest zaskakująco czysty (pieniądze w centach, idempotentny import przez `external_id`, izolacja RLS, rekomendacje jako czysta funkcja bez cache'u), ale destylacja ujawnia dziewięć rozjazdów — najgroźniejszy to cicha rozbieżność między obietnicą „domknij lukę do celu" a implementacją, która zachłannie tnie tylko 5 największych kategorii i nie sygnalizuje, gdy luka pozostaje otwarta. Drugi w kolejności: słowo „active" z FR-007 nie ma odwzorowania w modelu — trigger liczy wszystkie cele, a cele wygasłe nadal zajmują slot i generują agresywne rekomendacje. Najważniejszy wniosek: cała wartość produktu koncentruje się w jednym pliku (`recommendations.ts`), więc to właśnie tam należy najpierw podnieść niezmienniki do rangi jawnego kontraktu agregatu — zanim zostaną utrwalone przez kolejne wycinki.
