# KinderkopjeDB on Reddit (Devvit)

A Devvit app that runs inside Reddit. First piece: the **thread finder**. It searches a
subreddit (r/peloton by default) for the old race threads of each race edition in the
database, using the race and stage dates to tell the right threads from the rest.

The matching code is shared with the web page: `src/core/thread-match.ts` in the repo root
(tests in `tests/thread-match.test.ts`). This folder holds only the Reddit side.

## Which races it searches

`src/shared/editions.json`, written from the public database:

    npm run editions                                   # test set: Strade, Flanders, Paris-Nice, Tour 2023-2025
    npm run editions -- --races tourfrance,giroditalia --years 2021-2026
    npm run editions -- --all

When r/peloton calls a race something else than the UCI does, add the name to
`data/peloton/reddit-names.yaml` (repo root).

## Running it

Needs Node 24+ and a Reddit account connected to Reddit Developers.

    npm install
    npm run login        # once, opens the browser
    npm run playtest     # builds, uploads and installs on your test subreddit

Then, on the test subreddit: the subreddit menu, **[KinderkopjeDB] Thread finder**, creates a
post. Open it, type the subreddit to search, **Search all**. Each edition shows how many threads
it found, which stages are missing, and the searches it ran. **Copy results** gives the JSON
(titles, links, dates, markdown bodies) for the thread importer.
