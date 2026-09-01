# Raport architektoniczny — Moduł 4 (10xArchitect)

> Two-pager oparty **wyłącznie** na artefaktach obecnych w tym repo + promptach modułu 4.
> Zasada: brakujący artefakt = **BRAK artefaktu**, bez uzupełniania domysłami.
> Data: 2026-07-13.

---

## 1. Opisane projekty

Artefakty modułu 4 pochodzą z **dwóch różnych projektów**:

| Projekt | Stack | Skala (orientacyjnie) | Przy którym artefakcie |
|---|---|---|---|
| **Duże monorepo JS/TS** (nazwa nie podana w artefaktach; struktura `channels/`, `platform/client`, `platform/types`, `webapp`, `admin_console` — spójna z monorepo webapp Mattermosta) | TypeScript/JS, workspace'y, analiza `dependency-cruiser` | duże legacy, wielowarstwowe | **L2** (mapa) — target ćwiczenia; **L3** (research) — pairuje z tym repo. Źródło: prompty `.claude/prompts/m4l2-2-structure-dependency-cruiser.md:24,64` |
| **SpendLens** (to repo, `kurs10x`) | Astro 6 SSR + React 19 + Tailwind 4 + Supabase, deploy Vercel | MVP, ~medium users; `target_scale: users: medium, qps: low` (`prd.md:8-11`) | **L4** (plan refaktoru) i **L5** (DDD): `context/domain/01-03` |

**Uwaga o kompletności:** synteza L2 (`context/map/repo-map.md`) i jej artefakty źródłowe (`context/map/artifact-1..3.md`) **nie istnieją w tym repo** — katalog `context/map/` jest nieobecny; przetrwały tylko prompty (`.claude/prompts/m4l2-*.md`). L4/L5 dotyczą innego repo (SpendLens) niż L2/L3.

---

## 2. Mapa projektu (z L2)

**BRAK artefaktu.** Zsyntetyzowana mapa (`context/map/repo-map.md`) nie została zapisana w tym repozytorium; `context/map/` nie istnieje. Nie odtwarzam jej wniosków (strefy ryzyka / lokalne centra / entry-pointy / unknowns) z pamięci — byłoby to zmyślanie.

Jedyny zweryfikowany ślad L2 to prompty, które mówią, **czego** mapa dotyczyła (nie jej wyników):
- Analiza `dependency-cruiser` dla `webapp` w najaktywniejszych obszarach: `channels/src/components/admin_console`, `channels/src/packages`, `channels/src/utils`, `channels/src/actions`, `platform/client/src`, `platform/types/src` (`m4l2-2-structure-dependency-cruiser.md:24`).
- Metoda: teren z historii gita → graf zależności → kontrybutorzy (`m4l2-1`, `-2`, `-3`).

> Aby uzupełnić tę sekcję: uruchomić syntezę wg `m4l2-repo-map-synthesis.md` i zapisać `context/map/repo-map.md`.

---

## 3. Analiza ficzera (z L3)

**BRAK artefaktu.** W repo nie ma researchu ficzera z modułu 4 (dla monorepo z L2). Obecne pliki `context/archive/*/research.md` to research **ścieżki budowania SpendLens** (moduły 1–3, np. `wedge-math-contract`, `connect-simulated-bank`) — inny projekt i inny etap niż L3-architect, więc nie repurposuję ich jako L3.

Nie podaję zatem: badanego przepływu, feature-overview ani technical-debt (w tym potwierdzenia ast-grepem) — nie mam artefaktu, na którym mógłbym je oprzeć.

> Aby uzupełnić: wybrać przepływ z jednej ze stref ryzyka mapy L2 i przeprowadzić research L3.

---

## 4. Plan refaktoryzacji (z L4) — SpendLens

Źródło: `context/domain/03-anti-corruption-layer.md` (główny plan) + `context/domain/02-invariant-aggregate-refactor.md` (refaktor siostrzany).

**Co refaktoryzowane — wybrana opcja:** izolacja SDK **Supabase** (`@supabase/supabase-js` + `@supabase/ssr`) za **Anti-Corruption Layer**. Docelowy kształt: wąskie porty (`SavingsGoalStore`, `TransactionStore`, `CategoryStore`, `AuthGateway`) + domenowy VO `AuthenticatedUser` zamiast typu `User` biblioteki; cała wiedza o Supabase zamknięta w `src/lib/adapters/supabase/**`, wstrzykiwana per-request przez `createDataContext` do `Astro.locals.data` (`03-…:4.2-4.4`).

**Refaktor siostrzany (L4/L5):** niezmiennik capa celów → agregat `SavingsGoalPortfolio`, z tłumaczeniem błędu DB po stabilnym SQLSTATE `SL001` zamiast dopasowania prozy (`02-…:4.3-4.5`).

**Czego świadomie NIE robimy:** nie wymieniamy Supabase teraz (tylko szykujemy szew); nie ruszamy kontraktów HTTP route'ów, tabel/migracji ani UI; nie obejmujemy ACL-em Astro (platforma) ani zod (właściwie na granicy API); groźnego wariantu „serwerowy SDK w bundlu klienta" **nie naprawiamy, bo dziś nie występuje** (wyspy używają `fetch`; `astro:env/server` blokuje import na kliencie) (`03-…:KROK 2 zastrzeżenie`).

**Fazy (jak weryfikowane):**
1. Porty + VO `AuthenticatedUser`, zmiana `env.d.ts` — *auto:* `build` + typecheck.
2. Adapter Supabase (przeniesiony DSL + fabryka) — *auto:* testy integracyjne na realnym lokalnym Supabase (`vitest.config.integration.ts`).
3. `createDataContext` + middleware wystawia `locals.data`/`locals.user` — *auto:* build + integracja.
4. Route'y API na `locals.data.*`; testy mockują porty, nie `@/lib/supabase` — *auto:* vitest unit (hermetyczne).
5. Strony SSR na `Astro.locals.data.*` (z try/catch) — *auto:* build; *ręcznie:* smoke.
6. Serwisy domenowe przyjmują porty; usunięcie ostatnich importów `SupabaseClient` — *auto:* grep.
7. Weryfikacja końcowa — *auto:* `grep -rn "@supabase" src/` = tylko adapter; `build`+`test`+`test:integration`; *ręcznie:* e2e smoke (auth + create goal) (`03-…:6.1-6.2`).

---

## 5. Domena wg DDD (z L5) — SpendLens

Źródła: `context/domain/01-domain-distillation.md`, `02`, `03`.

**Ubiquitous language (kluczowe pojęcia):** Goal-Saver (persona), **Savings Goal** (nazwa + kwota + termin), **Suggestion** (cięcie: kategoria + oszczędność), **Excessive spending alert** (próg 12% miesięcznego przychodu), **Monthly surplus / gap** (wejście reguły wedge) (`01-…:KROK 1`).

**Najważniejsze rozjazdy model-vs-kod** (`01-…:KROK 4`):
- **D1 — „active" to fantom:** FR-007 mówi „3 *aktywne* cele", a trigger liczy WSZYSTKIE (brak kolumny statusu); cele wygasłe zajmują slot i dostają rekomendacje.
- **D3 — „domknij lukę" vs cap 5:** reguła obcięta do 5 sugestii i może cicho nie zamknąć luki (`recommendations.ts` wg `01`).
- **D4 — `amount > 0`:** zadeklarowane w typie, **nieegzekwowane w DB**.

**Niezmiennik #1 i jego agregat:** #1 = **„użytkownik ma co najwyżej 3 aktywne cele oszczędnościowe"** (FR-007) — wybrany jako jednocześnie rdzeniowy i najsłabiej/najbardziej niespójnie egzekwowany (dziś: trigger DB + kruchy string-match w API `goals.ts:51` + strażnik w UI `atGoalCap`). Należy do agregatu **`SavingsGoalPortfolio`** (granica = wszystkie cele jednego usera), jedynego miejsca egzekucji (`02-…:KROK 2-4`).

**Anti-Corruption Layer — co przecieka i przez ile warstw:** przecieka **SDK Supabase**, przez **5 warstw / 19 plików produkcyjnych** (typy globalne, fabryka, middleware, serwisy, API, UI): typ `SupabaseClient` w sygnaturach 4 serwisów, DSL PostgREST wtopiony w „logikę", `User` jako typ w `env.d.ts:3`, `createClient(headers,cookies)` zrekonstruowane w **~14 miejscach**. Po refaktorze wiedza kurczy się do **6 plików** w jednym katalogu adaptera (`03-…:KROK 1, 6.1`).

---

## 6. Decyzje, które należą do mnie

AI zsyntetyzowało analizę i trzy plany, ale rozstrzygnięcia strategiczne pozostają moje. **Po pierwsze — luka artefaktów:** L2/L3 dotyczą innego repo i nie zostały zapisane tutaj; muszę zdecydować, czy je odtworzyć (`context/map/`) czy uznać moduł za świadomie rozdzielony (analiza na dużym legacy, refaktor na własnym MVP). **Po drugie — wybór niezmiennika #1:** AI wskazało, że *najcenniejszy* jest wedge rekomendacji (D3), ale do wzorca agregatu wybrało cap celów (I-1) — akceptuję ten kompromis, bo D3 to problem kontraktu obliczenia, nie rozproszenia. **Po trzecie — definicja „active" = `target_date >= today`:** to zmiana zachowania produktu (cap przestaje liczyć wygasłe cele) i jest **decyzją produktową**, którą muszę zatwierdzić przed implementacją, nie założeniem AI. **Po czwarte — kolejność i zakres:** czy w ogóle wykonywać ACL teraz (koszt vs. brak żywego wycieku sekretu dziś), czy najpierw domknąć D3/D4; to priorytetyzacja pod moje ograniczenie czasowe (3-tyg. MVP solo, `tech-stack.md`). **Po piąte — świadome „NIE":** przyjmuję zawężenie, że Astro i zod zostają poza ACL.
