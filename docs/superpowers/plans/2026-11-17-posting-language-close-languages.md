# Posting Language for Close Languages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect the posting language sentence by sentence, report close relatives franc can't separate as a close call, and match languages exactly, so Lesvexa's Spanish posting is rejected and no speaker of the posting's language is ever surely rejected.

**Architecture:**

- **Detector** (`facts/rules/posting-language.ts`):
  - It judges whole-sentence pieces of each paragraph.
  - Each piece is sure (one exact code), a close call (a set of close relatives), or dropped.
  - The result gains `closeCalls: string[][]` beside `codes`.
- **Matcher** (`matcher/rules/posting-language.ts`):
  - Exact codes pass on an exact match.
  - A close call is `unknown` for a speaker of one of its members.
  - Anything else fails.

**Tech Stack:** TypeScript, franc 6.2.0 (pinned), zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-posting-language-close-languages-design.md`

**Linear ticket:** none (this project uses no tracker).

## Global Constraints

- `MIN_TEXT = 200`, `MIN_PARAGRAPH = 50`, `MIN_SHARE = 0.25` and `MIN_MARGIN = 0.06` stay as they are.
- Galician (`glg`) stays out of the `ISO_639_1` table.
- Close-relative groups (ISO 639-1): `[da, nb, nn]`, `[id, ms]`, `[hr, sr, bs]`, `[cs, sk]`, `[ca, es]`, `[nl, af]`.
- Never-sure groups: `[id, ms]` and `[hr, sr, bs]`.
- Language match is exact. The only merge left in the matcher is `no`/`nb`/`nn`.
- `FACTS_VERSION` 3→4 and `MATCHER_VERSION` 7→8.
- The fail reason for exact codes keeps today's form: `posting is written in es, which you don't speak`.

## Review Focus

1. **A Malay posting where one sentence clears the margin for `id`.** A Malay speaker must get `unknown`, never `fail`. A never-sure group always reports its whole group. Pinned by the `ms` fixture test in Task 1 and by "never-sure group" in Task 2.
2. **Flattened text with no space after the period** (`reales.Buscamos`). It must split into sentences. `Next.js`, `Node.js` and decimals like `2.5` must not split. Pinned by `splits flattened sentences but not Next.js` in Task 1.
3. **franc codes that share one ISO 639-1 code** (`pes`/`prs` → `fa`, `quy`/`quz` → `qu`). A runner-up with the same ISO 639-1 code is the same language. It must not cost the winner its margin. Pinned by `same-code runner-up` in Task 1.
4. **Facts stored before this change have no `closeCalls`.** Parsing them must still succeed. Pinned by `old facts without closeCalls still parse` in Task 1.
5. **A mixed French/English paragraph.** It must never yield a sure language other than French or English. Pinned by the rewritten alternating test in Task 1.

---

## File Structure

- `apps/xjobs/src/modules/facts/rules/posting-language.ts`: sentence pieces, groups, piece calls, aggregation. One file, as today.
- `apps/xjobs/src/modules/facts/rules/posting-language.fixtures.testing.ts` (new): the measured clean postings and Lesvexa's HTML, from the Appendix.
- `apps/xjobs/src/modules/facts/rules/posting-language.spec.ts`: detector tests.
- `apps/xjobs/src/modules/facts/schema/facts.ts`: the `closeCalls` field.
- `apps/xjobs/src/modules/facts/config/facts.config.ts`: version bump.
- `apps/xjobs/src/modules/facts/rules/combine.spec.ts`: expected `postingLanguages` gains `closeCalls: []`.
- `apps/xjobs/src/modules/matcher/rules/posting-language.ts` and `.spec.ts`: close calls, exact match.
- `apps/xjobs/src/modules/matcher/rules/decide.spec.ts`: the four `postingLanguages` assignments gain `closeCalls: []`.
- `apps/xjobs/src/modules/matcher/config/matcher.config.ts`: version bump.

---

### Task 1: Detector judges sentences and reports close calls

**Files:**

- Modify: `apps/xjobs/src/modules/facts/rules/posting-language.ts`
- Create: `apps/xjobs/src/modules/facts/rules/posting-language.fixtures.testing.ts`
- Modify: `apps/xjobs/src/modules/facts/rules/posting-language.spec.ts`
- Modify: `apps/xjobs/src/modules/facts/schema/facts.ts:79-83`
- Modify: `apps/xjobs/src/modules/facts/config/facts.config.ts` (`FACTS_VERSION = 4`)
- Modify: `apps/xjobs/src/modules/facts/rules/combine.spec.ts:819-827`

**Interfaces:**

- Produces:
  - `interface PostingLanguages { codes: string[]; closeCalls: string[][]; confident: boolean }`.
  - `closeCalls` entries are sorted alphabetically within a set, and the sets are ordered by detected characters, descending.
  - `detectPostingLanguages(text: string): PostingLanguages`, with its signature unchanged.
  - The schema field is `closeCalls: z.array(z.array(z.string().length(2)).min(1)).default([])`, so `JobFactsDocument['postingLanguages']['closeCalls']` is `string[][]`.
- Fixtures file exports:
  - `CLEAN: Record<'es'|'pt_pt'|'pt_br'|'ca'|'it'|'ro'|'fr'|'cs'|'sk'|'pl'|'da'|'nb'|'sv'|'nl'|'de'|'id'|'ms'|'hr'|'en', string>`
  - `LESVEXA_HTML: string`
  - `LESVEXA_STORED: string`: the HTML with tags removed (`.replace(/<[^>]+>/g, '').trim()`), then the stored tail, i.e. the text ending in `responsabilidades.\\n\\n¡Queremos conocer tu talento!` with a literal backslash-n, as stored on dev.

- [ ] **Step 1: Write the fixtures file** from the Appendix.

- [ ] **Step 2: Write the failing tests** in `posting-language.spec.ts`. Keep the existing tests, change them as listed below, and add the new ones.

  **Changes to existing tests:**
  - Every exact `toEqual` on a result gains `closeCalls: []`.
  - Replace `a paragraph alternating French and English sentences is not confident` with `a paragraph alternating French and English never gives another language`:

    ```ts
    const r = detectPostingLanguages(ALTERNATING);
    expect(r.codes.every((c) => c === 'fr' || c === 'en')).toBe(true);
    expect(r.closeCalls).toEqual([]);
    ```

  **New tests:**
  - `Lesvexa as stored is Spanish`:

    ```ts
    expect(detectPostingLanguages(LESVEXA_STORED)).toEqual({
      codes: ['es'],
      closeCalls: [],
      confident: true,
    });
    ```

  - `Lesvexa with its breaks restored is Spanish`: the same assertion on `htmlToPlainText(LESVEXA_HTML)`. Import it from `src/modules/ingest/normalize/text`.
  - `clean postings in clearly separated languages are sure`. For each of `es, pt_pt, pt_br, it, ro, fr, pl, sv, de, en`:

    ```ts
    expect(detectPostingLanguages(CLEAN[key])).toEqual({
      codes: [code],
      closeCalls: [],
      confident: true,
    });
    ```

    Here `code` is the key's language: `pt` for both `pt_*` keys.

  - `a clean posting is never surely another language`. For every key in `CLEAN` with language `L`, let `r` be the result:

    ```ts
    expect(r.confident).toBe(true);
    expect(r.codes.every((c) => c === L)).toBe(true);
    expect(r.closeCalls.every((s) => s.includes(L))).toBe(true);
    expect(r.codes.length + r.closeCalls.length).toBeGreaterThan(0);
    ```

  - `Malay and Croatian are always a close call of their whole group`:
    - `detectPostingLanguages(CLEAN.ms)` gives `codes` `[]` and `closeCalls` `[['id','ms']]`.
    - `CLEAN.id` gives the same.
    - `CLEAN.hr` gives `codes` `[]` and `closeCalls` `[['bs','hr','sr']]`.
  - `splits flattened sentences but not Next.js`. Build a text of four Spanish sentences, each 60 to 120 characters, joined with no space (`...reales.Buscamos...`), the first mentioning `Next.js` and `2.5 años`. Assert `{ codes: ['es'], closeCalls: [], confident: true }`. Also assert that the exported helper `sentencePieces(text)` returns exactly 4 pieces.
  - `same-code runner-up`. Persian text of about 300 characters (write one sentence set about a backend job in Persian) gives `codes: ['fa']`. If franc separates `pes` from `prs` by the margin anyway, keep the test as a regression guard.
  - `old facts without closeCalls still parse`, in the same spec or in `facts/schema` tests if a schema spec exists. `jobFactsDocumentSchema.shape` access is awkward, so parse a full document from `combine.spec`'s helper with `closeCalls` deleted, and expect `success` to be true and `closeCalls` to equal `[]`.

- [ ] **Step 3: Run the tests to verify they fail**

  Run: `npx nx test xjobs -- posting-language`
  Expected: FAIL. `closeCalls` is missing, Lesvexa is not confident, and `sentencePieces` is not exported.

- [ ] **Step 4: Implement**

  **Constants and exports** in `posting-language.ts`:
  - `GROUPS: string[][]` (Global Constraints).
  - `NEVER_SURE: Set<string>`, holding the members of the never-sure groups.
  - `export function sentencePieces(paragraph: string): string[]`:
    - Split on `/(?<=[.!?])\s*(?=[\p{Lu}¡¿\p{Extended_Pictographic}])/u`.
    - Join each piece under `MIN_PARAGRAPH` to the next piece. A short last piece joins the previous one.
    - Trim each piece.
  - Update the header comment and the `MIN_MARGIN` doc to say margins are judged per sentence piece.

  **Piece call.** This algorithm isn't fixed by the tests:

  ```ts
  type Call = { sure: string } | { group: string[]; members: string[] } | null;

  function callPiece(piece: string): Call {
    // francAll → [ISO 639-1, score][]; skip 'und'; keep only the first entry per ISO 639-1 code
    const scores = ...;
    if (scores.length === 0) return null;
    const [winner, top] = scores[0];
    const group = GROUPS.find((g) => g.includes(winner)) ?? [winner];
    const outside = scores.find(([c]) => !group.includes(c));
    if (outside && top - outside[1] < MIN_MARGIN) return null;
    const near = scores.filter(([c, s]) => group.includes(c) && top - s < MIN_MARGIN).map(([c]) => c);
    if (NEVER_SURE.has(winner)) return { group, members: [...group].sort() };
    if (near.length === 1) return { sure: winner };
    return { group, members: [...near].sort() };
  }
  ```

  **Aggregation** in `detectPostingLanguages`:
  1. For each paragraph from `paragraphs(text)`, call each of its `sentencePieces`.
  2. Add the piece length to a per-sure-code tally, or to a per-group tally keyed by the group's first member. A group's tally keeps the union of its members.
  3. `detected` is the sum of all counted pieces.
  4. Keep the `MIN_TEXT` checks as today.
  5. Keep the codes and groups whose share is at least `MIN_SHARE`, and sort each list by characters, descending.

- [ ] **Step 5: Update the schema, the facts version and combine.spec**
  - In `facts.ts`, add the `closeCalls` field from Interfaces with the doc comment `/** Sets of close relatives the detector could not tell apart, each sorted. */`.
  - Set `FACTS_VERSION = 4`.
  - In `combine.spec.ts`, both expected `postingLanguages` objects gain `closeCalls: []`.

- [ ] **Step 6: Run the tests to verify they pass**

  Run: `npx nx test xjobs -- posting-language combine`
  Expected: PASS.

  If a clearly-separated fixture fails only its exact `toEqual` while the rule test passes, print its piece calls and report the scores. Don't change the fixture text or a threshold to make it pass.

- [ ] **Step 7: Typecheck and commit**

  Run: `npx nx typecheck xjobs`
  Expected: errors only in the matcher's `decide.spec.ts` and `posting-language.spec.ts`, which Task 2 fixes. If you want a green commit, add `closeCalls: []` to those four `decide.spec.ts` assignments now.

  ```bash
  git add apps/xjobs/src/modules/facts
  git commit -m "feat(facts): detect posting language per sentence, with close calls"
  ```

### Task 2: Matcher matches languages exactly and turns close calls into unknown

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/rules/posting-language.ts`
- Modify: `apps/xjobs/src/modules/matcher/rules/posting-language.spec.ts`
- Modify: `apps/xjobs/src/modules/matcher/rules/decide.spec.ts:89,122,138,157`
- Modify: `apps/xjobs/src/modules/matcher/config/matcher.config.ts` (`MATCHER_VERSION = 8`)

**Interfaces:**

- Consumes: `facts.postingLanguages.closeCalls: string[][]` from Task 1.
- Produces: `checkPostingLanguage(facts, profile): Check`, with its signature unchanged.

- [ ] **Step 1: Write the failing tests** in the matcher `posting-language.spec.ts`.

  **Changes to existing tests:**
  - `doc` becomes `doc(codes: string[], confident = true, closeCalls: string[][] = [])`.
  - Replace `Croatian, Serbian and Bosnian match one another` with `Croatian does not match a sure Serbian posting`:

    ```ts
    expect(
      checkPostingLanguage(doc(['sr']), {
        ...profile,
        languages: [{ lang: 'hr', level: 'fluent' }],
      }).outcome,
    ).toBe('fail');
    ```

  - Keep the Norwegian test as it is.

  **New tests:**
  - `Catalan does not match Spanish`: `doc(['ca'])` with a profile of only `es` gives `fail`.
  - `a close call is unknown for a speaker of one member`: `doc([], true, [['da','nb']])` with a profile of only `da` gives:

    ```ts
    expect(c).toMatchObject({
      outcome: 'unknown',
      unsure: false,
      unsureField: null,
    });
    expect(c.reason).toBe("posting is in one of da, nb; can't tell which");
    ```

  - `never-sure group`: `doc([], true, [['id','ms']])` with a profile of only `ms` gives `unknown`.
  - `a close call fails a speaker of none`: `doc([], true, [['da','nb']])` with the default `en`/`fr` profile gives `fail`, with the reason `"posting is written in one of da/nb, which you don't speak"`.
  - `an exact code beats a close call`: `doc(['en'], true, [['da','nb']])` with the default profile gives `pass`.
  - `a Norwegian (no) profile is unknown on a {da, nb} close call`: `doc([], true, [['da','nb']])` with `no` gives `unknown`. The `nb` family maps to `no`.
  - Keep `Spanish posting rejects a profile without Spanish`, and add:

    ```ts
    expect(c.reason).toBe("posting is written in es, which you don't speak");
    ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx nx test xjobs -- matcher/rules/posting-language`
  Expected: FAIL on the Croatian, Catalan and close-call tests.

- [ ] **Step 3: Implement**
  - `SAME_LANGUAGE` keeps only `no`, `nb` and `nn`. Update the doc comments on it and on `checkPostingLanguage`.
  - **Order of checks:**
    1. Not confident, or both `codes` and `closeCalls` are empty: unknown, with today's reason.
    2. A spoken family appears in `codes`: pass, with today's reason.
    3. The first close-call set with a spoken family member: unknown, reason `` `posting is in one of ${set.join(', ')}; can't tell which` ``.
    4. Otherwise fail, reason `` `posting is written in ${[...codes, ...closeCalls.map((s) => `one of ${s.join('/')}`)].join(', ')}, which you don't speak` ``.
  - Set `MATCHER_VERSION = 8`.
  - In `decide.spec.ts`, add `closeCalls: []` to the four assignments, if Task 1 didn't already.

- [ ] **Step 4: Run what CI runs**

  Run: `npx nx run-many -t lint test build typecheck`
  Expected: all green.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/xjobs/src/modules/matcher
  git commit -m "feat(matcher): exact posting-language match, close calls unknown"
  ```

### Task 3: Push and open the PR

- [ ] **Step 1:** `git push -u origin feat/posting-language-close-languages`
- [ ] **Step 2:** `gh pr create --base main`. The body links the spec and lists the post-merge steps below, ending with the attribution line.

## After merge (on dev, by the human or with their go-ahead)

1. Once the engine is deployed, the match sweep rebuilds facts older than `FACTS_VERSION` 4. Then run `pnpm --filter @xjobs/xjobs db:rematch -- --all`.
2. Check on dev:
   - Job `01a1e588-3689-726e-93cd-e1ac57953e55` is rejected with `posting is written in es, which you don't speak`.
   - The 113 `postingLanguage` unknowns drop.
   - No profile fails `postingLanguage` on a language it speaks.
   - The other four Spanish jobs from the brief show `es`.
3. Log the flattened LinkedIn `descriptionText` (spec non-goal) as its own roadmap item. The phase 3 briefs are on `docs/phase-3-language-and-apply-link-briefs`.

## Appendix: fixtures

`posting-language.fixtures.testing.ts` exports `CLEAN` with exactly these texts, which were measured on 2026-11-17:

```ts
export const CLEAN = {
  es: 'Buscamos un ingeniero de software con experiencia para unirse a nuestro equipo de plataforma en Madrid. Serás responsable de diseñar, construir y mantener los servicios que usan miles de clientes cada día, y trabajarás de cerca con producto y diseño para decidir qué construimos y por qué. Valoramos a las personas que hacen preguntas, que escriben pruebas y que se preocupan por la calidad del código. Ofrecemos un salario competitivo, horario flexible, formación continua y la posibilidad de trabajar desde casa varios días a la semana.',
  pt_pt: 'Estamos à procura de um engenheiro de software com experiência para integrar a nossa equipa de plataforma em Lisboa. Vais ser responsável por desenhar, construir e manter os serviços que milhares de clientes utilizam todos os dias, e vais trabalhar de perto com o produto e o design para decidir o que construímos e porquê. Valorizamos pessoas que fazem perguntas, que escrevem testes e que se preocupam com a qualidade do código. Oferecemos um salário competitivo, horário flexível, formação contínua e a possibilidade de trabalhar a partir de casa vários dias por semana.',
  pt_br: 'Estamos procurando um engenheiro de software com experiência para fazer parte do nosso time de plataforma em São Paulo. Você vai ser responsável por projetar, construir e manter os serviços que milhares de clientes usam todos os dias, e vai trabalhar junto com produto e design para decidir o que a gente constrói e por quê. Valorizamos pessoas que fazem perguntas, que escrevem testes e que se importam com a qualidade do código. Oferecemos salário competitivo, horário flexível, vale-refeição, plano de saúde e a possibilidade de trabalhar de casa alguns dias por semana.',
  ca: 'Busquem un enginyer de programari amb experiència per incorporar-se al nostre equip de plataforma a Barcelona. Seràs responsable de dissenyar, construir i mantenir els serveis que fan servir milers de clients cada dia, i treballaràs de prop amb producte i disseny per decidir què construïm i per què. Valorem les persones que fan preguntes, que escriuen proves i que es preocupen per la qualitat del codi. Oferim un sou competitiu, horari flexible, formació contínua i la possibilitat de treballar des de casa diversos dies a la setmana.',
  it: 'Cerchiamo un ingegnere del software con esperienza da inserire nel nostro team di piattaforma a Milano. Sarai responsabile della progettazione, dello sviluppo e della manutenzione dei servizi che migliaia di clienti usano ogni giorno, e lavorerai a stretto contatto con prodotto e design per decidere cosa costruiamo e perché. Apprezziamo le persone che fanno domande, che scrivono test e che tengono alla qualità del codice. Offriamo uno stipendio competitivo, orario flessibile, formazione continua e la possibilità di lavorare da casa alcuni giorni alla settimana.',
  ro: 'Căutăm un inginer software cu experiență care să se alăture echipei noastre de platformă din București. Vei fi responsabil de proiectarea, construirea și întreținerea serviciilor pe care mii de clienți le folosesc în fiecare zi și vei lucra îndeaproape cu echipele de produs și design pentru a decide ce construim și de ce. Apreciem oamenii care pun întrebări, care scriu teste și cărora le pasă de calitatea codului. Oferim un salariu competitiv, program flexibil, formare continuă și posibilitatea de a lucra de acasă câteva zile pe săptămână.',
  fr: 'Nous recherchons un ingénieur logiciel expérimenté pour rejoindre notre équipe plateforme à Paris. Vous serez responsable de concevoir, construire et maintenir les services que des milliers de clients utilisent chaque jour, et vous travaillerez étroitement avec le produit et le design pour décider de ce que nous construisons et pourquoi. Nous apprécions les personnes qui posent des questions, qui écrivent des tests et qui se soucient de la qualité du code. Nous offrons un salaire compétitif, des horaires flexibles, de la formation continue et la possibilité de télétravailler plusieurs jours par semaine.',
  cs: 'Hledáme zkušeného softwarového inženýra do našeho platformního týmu v Praze. Budete zodpovědný za návrh, vývoj a údržbu služeb, které každý den používají tisíce zákazníků, a budete úzce spolupracovat s produktovým a designovým týmem na rozhodování, co a proč stavíme. Oceňujeme lidi, kteří se ptají, píší testy a záleží jim na kvalitě kódu. Nabízíme konkurenceschopnou mzdu, pružnou pracovní dobu, další vzdělávání a možnost pracovat několik dní v týdnu z domova.',
  sk: 'Hľadáme skúseného softvérového inžiniera do nášho platformového tímu v Bratislave. Budete zodpovedný za návrh, vývoj a údržbu služieb, ktoré každý deň používajú tisíce zákazníkov, a budete úzko spolupracovať s produktovým a dizajnovým tímom pri rozhodovaní, čo a prečo staviame. Oceňujeme ľudí, ktorí sa pýtajú, píšu testy a záleží im na kvalite kódu. Ponúkame konkurencieschopnú mzdu, pružný pracovný čas, ďalšie vzdelávanie a možnosť pracovať niekoľko dní v týždni z domu.',
  pl: 'Szukamy doświadczonego inżyniera oprogramowania do naszego zespołu platformy w Warszawie. Będziesz odpowiedzialny za projektowanie, budowanie i utrzymanie usług, z których codziennie korzystają tysiące klientów, i będziesz blisko współpracować z zespołami produktu i designu, decydując, co i dlaczego budujemy. Cenimy osoby, które zadają pytania, piszą testy i dbają o jakość kodu. Oferujemy konkurencyjne wynagrodzenie, elastyczne godziny pracy, ciągłe szkolenia i możliwość pracy z domu kilka dni w tygodniu.',
  da: 'Vi søger en erfaren softwareudvikler til vores platformteam i København. Du bliver ansvarlig for at designe, bygge og vedligeholde de tjenester, som tusindvis af kunder bruger hver dag, og du kommer til at arbejde tæt sammen med produkt og design om at beslutte, hvad vi bygger og hvorfor. Vi værdsætter folk, der stiller spørgsmål, skriver tests og går op i kvaliteten af koden. Vi tilbyder en konkurrencedygtig løn, fleksible arbejdstider, løbende efteruddannelse og mulighed for at arbejde hjemmefra flere dage om ugen.',
  nb: 'Vi søker en erfaren programvareutvikler til plattformteamet vårt i Oslo. Du blir ansvarlig for å designe, bygge og vedlikeholde tjenestene som tusenvis av kunder bruker hver dag, og du kommer til å jobbe tett med produkt og design for å bestemme hva vi bygger og hvorfor. Vi setter pris på folk som stiller spørsmål, skriver tester og bryr seg om kvaliteten på koden. Vi tilbyr konkurransedyktig lønn, fleksibel arbeidstid, kontinuerlig opplæring og mulighet til å jobbe hjemmefra flere dager i uken.',
  sv: 'Vi söker en erfaren mjukvaruutvecklare till vårt plattformsteam i Stockholm. Du kommer att ansvara för att designa, bygga och underhålla de tjänster som tusentals kunder använder varje dag, och du kommer att arbeta nära produkt och design för att bestämma vad vi bygger och varför. Vi uppskattar människor som ställer frågor, skriver tester och bryr sig om kodens kvalitet. Vi erbjuder konkurrenskraftig lön, flexibla arbetstider, kontinuerlig utbildning och möjlighet att arbeta hemifrån flera dagar i veckan.',
  nl: 'Wij zoeken een ervaren software-engineer voor ons platformteam in Amsterdam. Je bent verantwoordelijk voor het ontwerpen, bouwen en onderhouden van de diensten die duizenden klanten elke dag gebruiken, en je werkt nauw samen met product en design om te beslissen wat we bouwen en waarom. We waarderen mensen die vragen stellen, tests schrijven en om de kwaliteit van de code geven. We bieden een concurrerend salaris, flexibele werktijden, doorlopende opleiding en de mogelijkheid om een paar dagen per week thuis te werken.',
  de: 'Wir suchen eine erfahrene Softwareentwicklerin oder einen erfahrenen Softwareentwickler für unser Plattformteam in Berlin. Du bist verantwortlich für Entwurf, Aufbau und Wartung der Dienste, die tausende Kunden jeden Tag nutzen, und arbeitest eng mit Produkt und Design zusammen, um zu entscheiden, was wir bauen und warum. Wir schätzen Menschen, die Fragen stellen, Tests schreiben und denen die Qualität des Codes wichtig ist. Wir bieten ein wettbewerbsfähiges Gehalt, flexible Arbeitszeiten, Weiterbildung und die Möglichkeit, mehrere Tage pro Woche von zu Hause zu arbeiten.',
  id: 'Kami mencari seorang software engineer berpengalaman untuk bergabung dengan tim platform kami di Jakarta. Kamu akan bertanggung jawab untuk merancang, membangun, dan memelihara layanan yang digunakan oleh ribuan pelanggan setiap hari, serta bekerja sama dengan tim produk dan desain untuk memutuskan apa yang kami bangun dan mengapa. Kami menghargai orang yang suka bertanya, menulis pengujian, dan peduli dengan kualitas kode. Kami menawarkan gaji yang kompetitif, jam kerja fleksibel, pelatihan berkelanjutan, dan kesempatan bekerja dari rumah beberapa hari dalam seminggu.',
  ms: 'Kami sedang mencari seorang jurutera perisian yang berpengalaman untuk menyertai pasukan platform kami di Kuala Lumpur. Anda akan bertanggungjawab untuk mereka bentuk, membina dan menyelenggara perkhidmatan yang digunakan oleh ribuan pelanggan setiap hari, dan bekerjasama rapat dengan pasukan produk dan reka bentuk untuk menentukan apa yang kami bina dan mengapa. Kami menghargai orang yang bertanya soalan, menulis ujian dan mengambil berat tentang kualiti kod. Kami menawarkan gaji yang kompetitif, waktu kerja yang fleksibel, latihan berterusan dan peluang untuk bekerja dari rumah beberapa hari seminggu.',
  hr: 'Tražimo iskusnog softverskog inženjera za naš tim platforme u Zagrebu. Bit ćeš odgovoran za dizajn, izgradnju i održavanje usluga koje tisuće korisnika koriste svaki dan, a blisko ćeš surađivati s timovima za proizvod i dizajn kako bismo odlučili što gradimo i zašto. Cijenimo ljude koji postavljaju pitanja, pišu testove i brinu o kvaliteti koda. Nudimo konkurentnu plaću, fleksibilno radno vrijeme, stalnu edukaciju i mogućnost rada od kuće nekoliko dana u tjednu.',
  en: 'We are looking for an experienced software engineer to join our platform team in London. You will be responsible for designing, building and maintaining the services that thousands of customers use every day, and you will work closely with product and design to decide what we build and why. We value people who ask questions, write tests and care about the quality of the code. We offer a competitive salary, flexible hours, ongoing training and the option to work from home several days a week.',
};
```

`LESVEXA_HTML` is the stored `descriptionHtml` of job `01a1e588-3689-726e-93cd-e1ac57953e55`, verbatim:

```ts
export const LESVEXA_HTML = '<p>🚀 <b>¡ÚNETE A LESVEXA! | CONVOCATORIA DE PROGRAMADOR JUNIOR</b></p><p>En <b>LESVEXA</b> estamos buscando un <b>Desarrollador de Software Junior</b> con ganas de aprender, aportar ideas y participar en el desarrollo de soluciones tecnológicas reales.</p><p>Buscamos una persona proactiva, responsable, con iniciativa y pasión por la programación, que quiera seguir desarrollando sus habilidades y crecer profesionalmente.</p><p>💻 <b>Conocimientos técnicos deseables:</b></p><ul><li>JavaScript / TypeScript</li><li>React y Next.js</li><li>HTML, CSS y Tailwind CSS</li><li>Python</li><li>Excel VBA y automatización de procesos</li><li>Bases de datos SQL (PostgreSQL, MySQL u otras)</li><li>Git y GitHub</li></ul><p><i>No es necesario dominar todas las tecnologías. Valoramos los conocimientos básicos, la capacidad de aprendizaje y las ganas de asumir nuevos retos.</i></p><p>🎯 <b>¿Qué harás en LESVEXA?</b></p><ul><li>Participar en el desarrollo y mantenimiento de aplicaciones web.</li><li>Colaborar en proyectos de automatización y herramientas empresariales.</li><li>Apoyar en la implementación de nuevas funcionalidades.</li><li>Identificar errores y proponer mejoras.</li><li>Trabajar en conjunto en el desarrollo de soluciones de software.</li></ul><p>✅ <b>Perfil que buscamos:</b></p><ul><li>Estudiante de últimos ciclos, egresado o profesional de Ingeniería de Sistemas, Ingeniería de Software, Computación o carreras afines.</li><li>Conocimientos básicos de programación.</li><li>Capacidad para trabajar en equipo.</li><li>Responsabilidad, compromiso y disposición para aprender.</li></ul><p>🌱 <b>¿Qué ofrecemos?</b></p><ul><li>Participación en proyectos reales de desarrollo de software.</li><li>Oportunidad de aprendizaje y crecimiento profesional.</li><li>Ambiente colaborativo y espacio para aportar ideas.</li><li>Posibilidad de asumir nuevos desafíos y responsabilidades.</li></ul><br><br><p><b>¡Queremos conocer tu talento!</b></p><br>';
```
