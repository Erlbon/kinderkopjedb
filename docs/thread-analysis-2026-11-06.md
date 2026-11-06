# Race-thread analysis, 2026-11-06 (92 r/peloton threads)

What the old r/peloton race threads have in common, what changes from year to year and from stage to stage, and what the thread builder could fill in by itself. Nothing in the builder was changed for this review; the answers go on the decision page (one card per proposal, Yes / No / Later).

**How it was checked.** The Devvit thread finder (`apps/devvit`) searched r/peloton for 12 editions (Strade Bianche, Ronde van Vlaanderen, Paris-Nice, Tour de France, 2023-2025) and returned 92 threads with their markdown: 85 stage and one-day threads, 3 team presentations, 4 rest days. Each body was read with the existing importer (`parseOldThread`, `src/core/thread-import.ts`), and every link (1,362 in all) was grouped by race, row and address, with the year, date and stage number swapped for tokens so a link that only changes its year counts as one pattern. The stage tables were read the same way. All 92 were posted by PelotonMod, on race day at 07:00-10:00 UTC.

**Left out on purpose:** the 8 Paris-Nice 2025 threads (found only after the fix of today, titles without a year), women's races (not in the database), and the previews' contents (editorial choices, different every year).

**Effort:** small = under 2 minutes of work, medium = up to 10, large = more than 10.

**Overall.** The threads are far more regular than they look. Within one edition, every stage thread carries the same info table: in the 63 Tour stage threads of three years only 2 links appear in a single thread; the rest repeat in all 21. What changes per stage is the one-row stage table, and even that has patterns (stage page, profile image). Across years, the official site, social accounts, race centre and live-report pages stay the same, and start lists, Tissot and preview pages change only their year. So the builder can draft most of a thread from last year's: keep what is stable, move patterned links to the new year, and ask the moderator only for what is new. The importer misses part of this today because it files everything except four known link types as "this year only", and it skips several row labels the threads use.

---

## 1. Re-use from last year's threads

### 1. Draft a new edition from last year's thread
- **What:** today the importer (`toRegistryEntry`, `src/core/thread-import.ts:151`) keeps only the official site, Wikipedia, socials, FirstCycling id and PCS slug, and hands everything else back as "this year only". The analysis shows three kinds of links: **stable** (same address in two or more years: race centre `racecenter.letour.fr/en`, `cyclingnews.com/live-reports`, Eurosport, the socials), **patterned** (only the year changes: FirstCycling start list, `tissottiming.com/{year}/tdf/en-gb`, `cyclingnews.com/races/paris-nice-{year}/preview`, `inrng.com/{year}/03/paris-nice-preview-{year}`) and **new each year** (roadbook, San Luca map, /r/peloton content, broadcaster list).
- **Why:** a moderator starting the 2027 Tour now retypes about 15 links per thread that were right last year or are last year's with a new year number.
- **Fix:** "Start from last year": pick (or let the finder fetch) last year's thread of the race, sort each link into the three kinds, carry stable ones, rewrite patterned ones for the new year, and list the year-only ones as "replace or drop" with last year's address as a hint. Rows keep their order and labels.
- **Effort:** large. **Recommendation:** Yes (the main gain of this whole exercise).

### 2. Link patterns in the race registry ({year}, {stage}, {date})
- **What:** the registry can only build two links itself (FirstCycling start list, PCS live; `autoItems`, `src/core/render.ts:162`). The threads show more fixed patterns, per race: stage number `letour.fr/en/stage-{stage}` (all 63 Tour threads), stage profile image `firstcycling.com/img/ritt_etapper/{year}_17_{stage}.png` (58 of 63; the 2024 Tour used a `{year}_sanluca_17_{stage}.jpeg` variant, 2023 mixed `.jpg`/`.png`), Paris-Nice 2023 profile `sanluca.cc/road/men/aa33eb/{year}/{stage}/`, Tissot `{year}`.
- **Why:** one line in the registry fills that link in every thread of every year.
- **Fix:** registry entries get `links:` with a row, a text and an address with `{year}`, `{yy}`, `{stage}`, `{date}` tokens; the stage-table cells (stage, type, finish) get the same option (`stageUrl`, `typeUrl`, ...). Card 1 writes these patterns when it finds them.
- **Effort:** medium. **Recommendation:** Yes.

### 3. Stable links go to the registry by themselves
- **What:** links seen unchanged in two or more years of a race (table in the intro of card 1) are still treated as "this year only"; only four kinds are recognised by address (`src/core/thread-import.ts:184-221`).
- **Why:** the registry should learn the race centre, live-report and broadcaster pages once, not be told by hand.
- **Fix:** when two or more years of a race are imported, any link that is the same in both goes to the registry under its row. One year alone keeps today's behaviour.
- **Effort:** medium. **Recommendation:** Yes.

### 4. The /r/peloton content row, found by the finder
- **What:** every Tour stage thread links the edition's own r/peloton posts: Pre-Race Thread, Cheat Notes, Pet Predictions, Adopt-a-Rider, RFL & SRFL, SWL, TFTPT (7 links, the same in all 21 stage threads of a year). They are typed in by hand today.
- **Why:** these are posts in the same subreddit, a few days before the start: exactly what the Devvit finder can search for.
- **Fix:** the finder also looks for "Pre-race thread", "Cheat notes", "Stage Winners League", "RFL" etc. with the race name in the week before the start, and offers them as the content row.
- **Effort:** medium. **Recommendation:** Later (after cards 1-3; the list of game names needs your knowledge).

## 2. What the builder writes

### 5. Read the row labels the threads really use
- **What:** the importer skips rows it has no name for (`LABELS`, `src/core/thread-import.ts:20-40`). Skipped in these threads: "Live ticker" (8), "Live coverage" (9), "TV & Streams" (10), "Liveticker", "Livetickers", "LiveTrackers", "Livetrackers", and labels with a colon ("Information:", "Previews:" ... in one 2023 thread). Paris-Nice 2024 has the header "Outlet type | Links" instead of an empty one.
- **Why:** these rows hold the trackers and TV links; skipping them loses exactly the links card 1 wants to carry.
- **Fix:** add the variants (tracker, watch, coverage), drop a trailing colon, and accept "Outlet type" as an info-table header.
- **Effort:** small. **Recommendation:** Yes.

### 6. Time zone from the date, with a converter link
- **What:** the builder writes "CET" unless a race says otherwise (`src/core/render.ts:140`), so a July stage comes out in CET. The threads mostly write CEST in summer, and three races linked the zone to a converter: `timeanddate.com/worldclock/converter.html?iso=<UTC start>` (Strade 2024, Flanders 2025) or `timebie.com` (Tour 2023-2024). Paris-Nice 2024 wrote the time in CET and UTC.
- **Why:** readers come from everywhere; the converter link answers "when is that for me".
- **Fix:** pick CET or CEST from the date for European races (the zone name stays a registry setting), and link the time to the timeanddate converter built from the date, start time and zone.
- **Effort:** small. **Recommendation:** Yes.

### 7. "Coverage starts at" as a field
- **What:** the start of the TV coverage is written by hand inside the TV row ("Race Coverage starts at 12:00 CEST" with a timebie link, Tour) or its own row ("Live video starts at 14:00 CET", Strade; "Begins @ 3.45 pm CET", Paris-Nice). The Tour's timebie link says `q=12` in all 42 threads of 2023 and 2024: it was copied, not set per stage.
- **Why:** a stage-by-stage fact that is easy to get wrong when copied.
- **Fix:** a `coverage` time per race or stage (like `start`/`end`), written into the coverage or TV row with the same zone and converter link as card 6.
- **Effort:** medium. **Recommendation:** Yes.

### 8. Two more table layouts
- **What:** six different stage-table headers in 12 editions. One-day races use "Profile" where the builder writes "Type" (Strade 2024-2025, Flanders 2023 and 2025), time as "Timing" or "Arrival time"; the 2025 Tour dropped Finish; 2024 wrote "Elevation" for Altitude.
- **Why:** the importer already warns when a layout matches none (`src/core/thread-import.ts:177`); these are the common ones.
- **Fix:** a one-day variant with "Profile" in the profile file (`data/profiles/peloton.yaml`), and the header names Elevation/Timing/Arrival time accepted as the same columns when reading.
- **Effort:** small. **Recommendation:** Yes.

### 9. Check a thread before it is posted
- **What:** mistakes found in these threads: empty links (`[Roadbook]()` and `[Video Highlights]()`, Flanders 2025; `[RFL]()`, Vuelta 2026), a placeholder (`letour.fr/en/#` as the broadcaster list, all 21 Tour threads of 2024), last year's address (Tissot 2025 in the Vuelta 2026 thread), and a stray chatbot sign-off left in a 2025 Tour rest-day text.
- **Why:** each was posted and stayed up; a check costs nothing.
- **Fix:** the builder warns (as it does for missing values) on empty links, `#` addresses, a year in an address that is not the thread's year, and common assistant boilerplate ("Let me know if you'd like").
- **Effort:** small. **Recommendation:** Yes.

### 10. Team presentation thread
- **What:** each of the three Tours had a team-presentation race thread two days before the start (short: time, stream link). The builder makes race, stage, rest and overall threads only.
- **Why:** a regular thread of the Grand Tours; the finder now counts them separately.
- **Fix:** a `presentation` date and time on a stage race gives one more thread from a profile template.
- **Effort:** small. **Recommendation:** Yes.

### 11. Extra sections: climbs, sprints, teams, past editions
- **What:** Paris-Nice 2024 added per-stage tables of KOMs (location, category, km, length, gradient), Sprints and Teams (with bib ranges); Flanders 2025 added "Past Editions" (last year's results and highlights, older full races).
- **Why:** readers like them, but they are made by hand.
- **Fix:** later: climbs and sprints need a data source per stage; "Past editions" can be built from FirstCycling results links for earlier years plus links the moderator adds.
- **Effort:** large. **Recommendation:** Later.

## Decisions (2026-11-06)
Yes to cards 1, 2, 3, 5, 6, 7, 8, 9 and 10; Later for 4 (the /r/peloton content row via the finder) and 11 (climbs, sprints, teams, past editions). All nine Yes cards were built the same day: 5 `4c274a2`, 8 `86b7750`, 6 `0befa05`, 9 `bcf157e`, 10 `ab66c5d`, 7 `a382f1c`, 2 `ae36eb4`, 3 `7faa08d`, 1 in the commit after it. Card 1 works from the "Learn from old threads" box on the Threads page: paste old threads (or the finder's copied JSON); last year's edition-only links are written as a comment above the race in the season, to replace or drop.

## Considered and not proposed
- **Carrying previews over:** every year's previews are new articles; only the pattern pages (card 2) carry.
- **Writing the rest-day and presentation texts:** they are personal, hand-written texts; the builder gives the frame only.
- **Titles without a year** (Paris-Nice 2025): the builder always writes the year; only the finder needed to cope, and does now.
