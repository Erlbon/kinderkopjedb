# KinderkopjeDB

Season YAML in, Reddit-ready race threads out. Built for the r/peloton moderators; the
layout lives in a profile file, so other communities can reuse it.

It is a small static site that runs in your browser. Nothing is uploaded. It has six pages that share one
database:

| Page | What it does |
|---|---|
| Intro | The statement of intent, the three tasks the project is for, and the sources we have found useful. |
| Threads | Season YAML to Reddit-ready threads: calendar import, Wikipedia helpers, learning from old threads, stage tables, table layout. |
| Teams and points | UCI team ranking snapshots: seasons side by side, season to date against last year, points per month, WorldTeams/ProTeams. |
| Races | Look up a race: names, links, the 5x5 and the age statistics, each ready to copy. Filters by category, class, continent and name. Read only. |
| Collect | Gathering and cleaning: the capture queue and the results of each race, joining races that changed name, race names, race links. |
| Data | Save and open the database (.sqlite), ask it questions in SQL (read only), delete everything. |

## Where the data lives

All pages share one SQLite database (sql.js, SQLite compiled to WebAssembly, inside `app.js`). It is kept in your
browser (IndexedDB). **Save database** on the Data page gives you a `.sqlite` file: a backup, and the way to pass
the data to someone else (it opens in any SQLite tool). **Open database** replaces what is in the browser with such
a file. The file records its schema version; a file from a newer version of the tool is refused. Settings you edit
(season YAML, race registry, table layout) are in the same file. Data from the earlier one-page version, kept in the
browser's own storage, moves into the database the first time a page opens.

The Data page has a **Tables and fields** overview: every table and view with the meaning of each field, how they
link, and a button that shows the first rows or asks an example question; *Copy this overview as Markdown* gives it
to paste elsewhere. The views `v_team_points` and `v_results` are the easy way in. The overview is written in
`src/db/dictionary.ts`, and a test fails if it ever differs from the real schema (`src/db/schema.ts`).

## Public beta database

A SQLite file anyone can download from the Data page (`kinderkopjedb-public.sqlite`), published with the site. It is a **beta**:
it holds what has been collected so far (men's elite first), and says so inside the file, together with how much it holds
and when it was built. It has the races with their internal and external names, the results with the rider's age, the
race links, and the country and continent of every UCI code. To build a new one from capture files:

```
npm run beta -- "path/to/uci-capture.json" --note "what is different about this build"
```

It writes `data/public/kinderkopjedb-public.sqlite`; commit that file and the site build publishes it. Optional files add the
join lines (`--aliases`), rename lines (`--renames`), stored links (`--links`, JSON) and the race registry (`--registry`)
saved in the browser. Without them the races are not joined. The Data page button *Save a beta file from my own data*
builds the same file from the browser's database, with its joins, names and links, for whoever publishes it.

## Public dataset (what is in it, and what is not)

The Data page can **Save a public copy** of your database: the ranking and result tables with names, nations, places,
points, team names, race names, rider ages and race facts, and nothing else (saved texts, the capture queue, contributor
names and capture times are removed, and the file is rewritten so they do not linger inside it). Put that file
at `data/public/kinderkopjedb-public.sqlite` and commit it; the build then serves it as `kinderkopjedb-public.sqlite`, and
**Search the public dataset** on the Data page loads it and runs the SQL box against it. It is one static file read in
the visitor's own browser, so there is no server to overload. The file carries the UCI and Wikipedia credits and a
takedown contact (a GitHub issue).

## Running it

- **Online:** the GitHub Pages site (enabled from the repo settings: Pages, source GitHub Actions).
- **From a folder (offline):** download `kinderkopjedb.zip` from the latest release, unzip it, run `node serve.mjs`
  (or double-click `start.cmd`) and open http://localhost:8765. Use that address rather than opening the files
  directly: browsers keep a separate database for each file opened from disk, so the pages would not share data.
- **From the source:** `npm run build` then `npm start`.

## Using it (Threads page)

1. Optional: open a calendar `.ics` (for example the INRNG feed, saved from your browser). The page
   drafts a season: one-day races, plus stage races with one empty stage per day.
2. Edit the season YAML. Fill in route, length, type, times, previews, where to watch.
3. Press **Generate threads**. Each thread has Copy title / Copy body buttons and lists what is
   still `TBC`. Paste into Reddit's scheduled posts (Markdown mode).

## Team points (UCI World Ranking)

First slice of the data cube: team ranking snapshots by date, from UCI DataRide. UCI points only.

1. Drag the **Capture UCI table** link from the page to your bookmarks bar (the source is `tools/capture-dataride.js`).
2. On DataRide open a *team ranking* page. Pick the season and date with the page's own dropdowns (the address
   does not change when you do, so links cannot select a season). Press the bookmark on each page of the table
   (40 teams per page). It copies only the rows already on screen and sends no requests of its own.
3. Press *Download collection* in its box and open the file in KinderkopjeDB. Repeat for each date you want.

The page then shows the seasons side by side (the latest ranking captured for each season), season to date against
the same date last year, and points earned per month against last year. Rules: the ranking used for "the same date last year" is the latest one on or before that day, never a later
one; a month's points need the previous month-end ranking, otherwise the month stays empty; teams are matched by
UCI's team id (the same team keeps its id when its name or code changes, as with UAD in 2025 and UEX in 2026).
The id follows UCI's licence, so it can join teams that are different organisations (the Qhubeka licence became
Q36.5): check a line that jumps oddly.

Merged teams are listed in `data/cube/team-lineage.yaml` (Lotto and Intermarché-Wanty merged for 2026, UCI ids 929
and 1372). With "Combine merged teams" ticked, earlier seasons add the two teams' points together so that the
merged team compares like with like; ranks in those seasons are where the combined total would stand.
Capture the month-end rankings (and the latest ranking) for each season you want to compare.

UCI points reset on 1 January, so every ranking is a season-to-date total and January's monthly figure is the
total itself. Seasons still being raced are listed in `data/cube/seasons.yaml` (2026 for now); the page leaves
them out unless you tick "Include unfinished seasons". Remove the year from that file once its final ranking
(after the last race) has been captured.

### WorldTeams and ProTeams

The main interest is the WorldTeams (WT) and ProTeams (PT); lower-level teams matter when they beat them.
"Look up team levels (Wikipedia)" fetches, for each captured season, the WorldTeam list (the "UCI WorldTeam"
article) and the ProTeam list ("List of <year> UCI ProTeams and Continental teams"), one request at a time with
a pause, and matches them to the captured teams by UCI code and then by name. Anything not found is shown;
a team outside the captured part of a ranking (only the pages you captured) cannot be matched. Levels are
saved in the cube. With "Only WorldTeams and ProTeams" ticked the tables show just those teams, and a table
lists every WT/PT team that a lower-level team finished above. Wikipedia is a secondary source: check the
unmatched list.

## Collecting race results (UCI points): the Collect page

Per-race results come from DataRide, UCI's results site (`dataride.uci.ch`). One bookmark, *Capture UCI race*
(source `tools/capture-uci-race.js`), reads three kinds of DataRide road pages that you open yourself:

1. **The competition list** (`/iframe/Results/10/`). Pick a season and a category (Men Elite, Women Elite) with the
   page's own filters and press the bookmark. It pages through the whole list by itself (40 rows a page). The queue
   gets every race with its class (`2.UWT`, `1.Pro`, `1.1` ...), dates and country, and lines the editions of a race
   up by name across the years.
2. **A competition** (a link in that list, opened from the queue). The bookmark opens every closed row (the stages and
   the final classification) and notes the events: each event is named after its row ("Stage 5: Stage Classification").
3. **An event** (a link on the competition page): the *Final Classification: General Classification* and each *Stage
   Classification*. A race is counted by these (a 21-stage Giro is 22 events). The jersey classifications (points,
   mountains, youth, teams) and the standings after each stage ("Stage General Classification", "Overall ...") are not
   counted: they are cumulative and give at most a point or two to the leader. The bookmark copies the rows that score points (rank,
   rider, team, age, nation, result, points) and goes on to the next page of the table while every row on the page
   scored; the rows are added to the same event.

The bookmark clicks only the page's own controls (a row's triangle, the next-page button), one click at a time with a
pause, as you would, and has a Stop button. After a competition or a complete event it opens the next missing page by
itself after a 5-second countdown (this race's pages first, then the next race in the list; *Stay here* cancels), so you
press the bookmark once per page. *Get everything for this race* reads all of the race's missing pages in a hidden frame,
one page at a time with a pause, for the long stage races. Pages and races that never load can be skipped. It never
calls DataRide's data service itself: each page loads its own data. The clicking is in `src/core/autopilot.ts`, the
order of the pages in `nextPageToOpen` (`src/core/dataride.ts`).

Then press *Download collection* in the bookmark's box and open the file on the Collect page. The queue shows
per race and year how many events are captured, and can be limited to WorldTour, ProSeries and championships.
Every result row keeps the team the rider
rode for at the time, which is what the monthly team comparison needs.

The queue has a category chooser (men's elite is the default, women's elite, or both: only those two are collected),
a name search, and a sort by name, by class (WorldTour first) or by most to do. A race that changed its name (a
sponsor added, "Strade Bianche" becoming "Strade Bianche Donne") shows as two rows until you join them: under *Same
race, different names*, **Find joins** lists the likely pairs (one name starts the other, the years never overlap) for
you to decide: the same race, or different races. Pairs called the same race are written as lines `old name = name it
continues as` in the box below, and pairs called different races are remembered and not suggested again. Do it once after capturing a season; nothing is joined without your tick.
A race with more than two names is one longer line, `first = second = third = name it continues as`: every name before
the last is joined into the last. Sponsors added, dropped or changed anywhere in the name are found (a shorter name
inside a longer one), and the plain core name is the one the sponsored versions are folded into.

**Internal and external race names.** Every race has an internal name, what this project and the database call it
(by default the shortest name UCI has used, without sponsors, for example `Classic Brugge-De Panne`), and external names:
how UCI wrote it in each year, kept with the years. Under *Same race, different names* the **Race names** part finds a
race by any of its names and lets you change the internal name (a line `any external name = Internal name` is saved).
The database has them as `race` (one row per race, men's and women's elite apart) and `race_name` (its external names),
and every edition and result carries a `race_id`, so one race has the same id in every year whatever it was called.

**Race links.** Each race can have its official site, Wikipedia page, social media and FirstCycling page. They come from three places: the race registry of the Threads tab,
Wikidata, and links typed in by hand on a race's card under *Race names*. **Find links (World Tour)** asks Wikidata
about the World Tour races of the chosen category, one race at a time with a pause, trying each name a race has had,
and shows every match with its description for you to decide: *Same race*, *Not the same* or *Don't know*. Nothing is
saved from a match until you decide, and a match marked *Not the same* is not offered again. They are in the database as
`race_link`. A `country` table gives every UCI country code its continent and UCI confederation, for filtering.

DataRide numbers the races itself: the number in `CompetitionResults/<id>` is the race edition's id in this tool
(`race_result.uci_id`), and the number in `EventResults/<id>` identifies one event (`classification.event_id`).
A page saved with *Save as* does not work, and uci.org race pages are not used: UCI loads the results when a section
is opened and they never reach a saved file. UCI has not agreed to any automated collection, so nothing here crawls.

## Stage tables

Paste the table from your internal work thread into "Import a stage table". Columns are found by their
header names, so any order works (Date first, Stage first ...). It reads the stage link, route (and its
map/profile image link), length in km, type and finish (with their image links), altitude in metres and
the times. Days without a stage between two stages become rest days. What you paste wins over data already
in the season.

## Table layout

Moderators build their tables differently. The "Table layout" section lets you drag the column headers into
your own order, switch columns on and off, rename them, set alignment, and choose how dates (for example
`09/07`, `Thu. 09/07`, `13.Sep`, `13 Sep`), lengths (`186km`, `186 km`, `186,2`) and times are written.
Your layout is saved in your browser and can be shared as YAML. Named layouts (such as the Vuelta's
stage-first table) live in `data/profiles/peloton.yaml`; a race can ask for one with `table:` in the registry.

## Easy / Medium / Hard

`typeByAltitude` in the profile gives the Type from the metres climbed: Easy up to 2000, Medium 2001-3499,
Hard 3500 and up. It fills in a missing Type, and warns when a Type you wrote disagrees with the rule
(for example a stage of 3950 m marked Medium). TTT and ITT are not checked. Length is stored in km and
altitude in metres.

## Learning from old threads

Paste old race threads (markdown) into "Learn from old threads". The tool reads the title (year, name,
ME/WE, class) and the Information rows, and fills the race registry:

- **Carries over every year:** official site, Wikipedia page, Social Media, FirstCycling id (from the start
  list link), PCS slug (from the live-tracker link) and any other Information links.
- **Left out as year-specific:** Roadbook, Previews, /r/Peloton Content, Where to watch, other trackers.
- Row names from different years are understood (Live Tracker/Live Trackers, TV/Streams/Where to Watch ...).
  A row with words around its links (for example "on HBO Max, ...") is kept as plain markdown.
- Men's and women's editions become separate registry entries (their FirstCycling ids and PCS slugs differ).

From then on a new season only needs the race listed: the Information, Social Media and Live Trackers
rows fill themselves in with the new year.

## Wikipedia helpers

The page can draft data from Wikipedia and Wikidata (their APIs allow this and the page calls them
straight from your browser):

- **Fill stages + rest days:** reads the "Stage characteristics" table of an edition page
  (for example `2026 Tour de France`): stage numbers, dates, courses, lengths, types, rest days.
  Anything you already typed for a stage is kept; Wikipedia only fills gaps.
- **Look up website:** finds the race on Wikidata and offers its official website and Wikipedia link
  for the race registry. Men's and women's editions are separate entries; pick the right one.

Wikipedia is a secondary source. Its stage types (flat, hilly, mountain, ITT, TTT) are not the same
vocabulary as r/peloton's own Type values (for example "Hard"), so treat them as drafts.

## Race classes

`data/classes.yaml` lists the UCI classification codes (1.UWT, 2.WWT, 1.Pro, 1.1 ... and WC for
championships). Class codes are checked: an unknown class, or a one-day class on a race with stages,
shows up as a warning on the thread. The calendar import offers WorldTour/WWT, ProSeries and
championships by default.

## Data files

| File | What |
|---|---|
| `data/profiles/peloton.yaml` | Title templates, table columns, info rows, rest-day text. Edit when the community changes its layout. |
| `data/peloton/races.yaml` | Races that return every year (official site, socials, FirstCycling id, PCS slug), per category. Enter once. |
| `data/peloton/<year>.yaml` | The season: dates, route details, per-race extras. `2026-fixtures.yaml` holds two real threads as test fixtures. |

Standard layout plus extras: any race or stage can add `extra:` rows and a free-text `notes:`.
Race-level extras apply to every thread of that race.

Thread types: one-day race, stage (one per stage), rest day (list the dates in `restDays:`, used for
the three-week Grand Tours), and an optional overall thread (`mega: true`).

## Data sources

The tool reads no websites. Calendars come from files you give it. Some sites (FirstCycling, for one)
forbid automated access, so the plan is for moderators to save pages from their own
browser. Do not add scrapers for sites that ban them without their written permission.

## Developing

```
npm install
npm run check    # type check + tests
npm run build    # dist/index.html, one self-contained file
```

Enable the hooks once per clone: `git config core.hooksPath .githooks`
(pre-commit: control-character and syntax gate; pre-push: tests).

Releases: tag `v0.1.0` and push the tag; the workflow attaches `kinderkopjedb.zip`.

## Licence

MIT, see `LICENSE`. Material from Wikipedia, UCI and r/peloton used in the tests, and the data the tool reads, is not
covered by it: see `NOTICE.md`.
