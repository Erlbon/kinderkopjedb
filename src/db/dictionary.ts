/**
 * What is in the KinderkopjeDB database, in plain language: every table and view, every column, how they link.
 * Shown on the Data page and kept honest by a test that compares it with the real schema.
 */

export interface ColumnDoc {
  name: string;
  meaning: string;
}

export interface TableDoc {
  name: string;
  kind: "table" | "view";
  summary: string;
  columns: ColumnDoc[];
  /** how it links to other tables, in a sentence */
  links?: string;
  /** a question worth asking of it, as SQL */
  example: { title: string; sql: string };
}

export const DICTIONARY: TableDoc[] = [
  {
    name: "team_snapshot",
    kind: "table",
    summary: "One row per captured UCI World Ranking (team ranking) date.",
    columns: [
      { name: "id", meaning: "Row number, used by team_rank." },
      { name: "season", meaning: "The season the ranking belongs to. UCI points start again at zero on 1 January." },
      { name: "date", meaning: "The ranking date shown on DataRide, as yyyy-mm-dd. Unique." },
      { name: "moment_id", meaning: "UCI's own number for this ranking snapshot." },
      { name: "complete", meaning: "1 if every team of the ranking was captured, 0 if only some pages were (the usual case: top 40)." },
    ],
    links: "team_rank.snapshot_id = team_snapshot.id",
    example: { title: "Which ranking dates have been captured?", sql: "SELECT season, date, complete, (SELECT COUNT(*) FROM team_rank r WHERE r.snapshot_id = s.id) AS teams FROM team_snapshot s ORDER BY date" },
  },
  {
    name: "team_rank",
    kind: "table",
    summary: "The teams of each captured ranking: position and points on that date.",
    columns: [
      { name: "snapshot_id", meaning: "Which ranking date: team_snapshot.id." },
      { name: "team_id", meaning: "UCI's team number. It stays with the team's licence when the name or code changes (UAE: UAD in 2025, UEX in 2026), so use it to follow a team over the years." },
      { name: "code", meaning: "The team's UCI code in that season, for example UAD." },
      { name: "name", meaning: "The team's name in that season." },
      { name: "nation", meaning: "The team's nation (UCI's three-letter code)." },
      { name: "rank", meaning: "Position in the ranking on that date." },
      { name: "points", meaning: "UCI World Ranking points, season to date." },
    ],
    links: "snapshot_id -> team_snapshot.id; team_id also appears in team_level",
    example: { title: "The top 10 of the newest captured ranking", sql: "SELECT rank, code, name, points FROM v_team_points WHERE date = (SELECT MAX(date) FROM team_snapshot) ORDER BY rank LIMIT 10" },
  },
  {
    name: "team_level",
    kind: "table",
    summary: "Which teams were WorldTeams or ProTeams in a season (from Wikipedia). Teams that are not listed are lower-level, mostly Continental.",
    columns: [
      { name: "season", meaning: "The season." },
      { name: "team_id", meaning: "UCI's team number, as in team_rank." },
      { name: "level", meaning: "WT = WorldTeam, PT = ProTeam." },
    ],
    links: "team_id = team_rank.team_id",
    example: { title: "WorldTeams and ProTeams per season", sql: "SELECT season, level, COUNT(*) AS teams FROM team_level GROUP BY season, level ORDER BY season DESC, level" },
  },
  {
    name: "race_result",
    kind: "table",
    summary: "One row per captured race edition (a race in one year). Each edition has its own number on DataRide, UCI's results site.",
    columns: [
      { name: "uci_id", meaning: "DataRide's competition number for this edition (the number in dataride.uci.ch/iframe/CompetitionResults/<number>). Each year of a race has its own." },
      { name: "year", meaning: "The year of the edition." },
      { name: "name", meaning: "The race name as DataRide writes it." },
      { name: "class", meaning: "The UCI class, for example 2.UWT, 1.Pro, 1.1." },
      { name: "class_text", meaning: "The full class text from the page, for example '1.Pro - 1 day - UCI ProSeries'." },
      { name: "dates", meaning: "The dates as UCI writes them, for example '11 Oct 2026'." },
      { name: "country", meaning: "The country (UCI's three-letter code)." },
      { name: "captured_at", meaning: "When it was captured (date and time)." },
      { name: "contributor", meaning: "Who captured it. Not used by the current capture; always empty in a public copy." },
      { name: "race_id", meaning: "Which race this edition belongs to: race.race_id. The same race has the same id in every year, whatever it was called." },
    ],
    links: "classification.uci_id = race_result.uci_id",
    example: { title: "Races captured so far, and by whom", sql: "SELECT year, name, class, dates, contributor FROM race_result ORDER BY year, name" },
  },
  {
    name: "classification",
    kind: "table",
    summary: "A result list of a race: the General Classification or one stage (one DataRide event).",
    columns: [
      { name: "id", meaning: "Row number, used by result_row." },
      { name: "uci_id", meaning: "Which race edition: race_result.uci_id." },
      { name: "label", meaning: "The name of the event, for example 'General Classification' or 'Stage 3'." },
      { name: "title", meaning: "The page's heading, for example 'Giro del Veneto Individual Road Race'." },
      { name: "total_rows", meaning: "How many rows the table had. Only the rows that score points are kept in result_row." },
      { name: "event_id", meaning: "DataRide's number for this event (the number in .../EventResults/<number>)." },
    ],
    links: "uci_id -> race_result.uci_id; result_row.classification_id = classification.id",
    example: { title: "How many rows scored points, out of how many", sql: "SELECT r.name, r.year, c.label, c.total_rows, (SELECT COUNT(*) FROM result_row w WHERE w.classification_id = c.id) AS scoring_rows FROM classification c JOIN race_result r ON r.uci_id = c.uci_id ORDER BY r.year, r.name" },
  },
  {
    name: "result_row",
    kind: "table",
    summary: "One row per rider who scored UCI points in a result list.",
    columns: [
      { name: "classification_id", meaning: "Which result list: classification.id." },
      { name: "rank", meaning: "The place in that list. Empty when the page showed none." },
      { name: "rider", meaning: "First name and SURNAME as UCI writes them." },
      { name: "team", meaning: "The team name as written on the race page. This is a name, not a team number." },
      { name: "age", meaning: "The rider's age at the time of the race, as DataRide shows it (19 to 50 in the captured data, present on every row). Part of the public file." },
      { name: "nation", meaning: "The rider's nation (three-letter code)." },
      { name: "result", meaning: "The time or gap as shown, for example 4:31:46 or +02." },
      { name: "points", meaning: "UCI points this result gave." },
    ],
    links: "classification_id -> classification.id. The view v_results joins all three tables.",
    example: { title: "The riders who scored most in the captured races", sql: "SELECT rider, team, SUM(points) AS points, COUNT(*) AS results FROM v_results GROUP BY rider, team ORDER BY points DESC LIMIT 20" },
  },
  {
    name: "race",
    kind: "table",
    summary: "One row per race (men's or women's elite), the same race in every year whatever it was called. Races that changed their name are joined into one.",
    columns: [
      { name: "race_id", meaning: "The race's number." },
      { name: "key", meaning: "What the number follows when races are joined: a short form of the core name, with the category." },
      { name: "name", meaning: "The internal name: what this project calls the race. By default the shortest name UCI has used, without sponsors; it can be renamed." },
      { name: "slug", meaning: "The internal name as a short, web-safe text, for example classic-brugge-de-panne." },
      { name: "category", meaning: "ME = men's elite, WE = women's elite." },
      { name: "first_year", meaning: "The first year in the data." },
      { name: "last_year", meaning: "The last year in the data." },
    ],
    links: "race_name.race_id = race.race_id; race_result.race_id = race.race_id",
    example: { title: "Races and the years they cover", sql: "SELECT name, category, first_year, last_year FROM race ORDER BY name" },
  },
  {
    name: "race_name",
    kind: "table",
    summary: "The external names of each race: how a source wrote its name, with the years it was used. A race that changed sponsor has several.",
    columns: [
      { name: "race_id", meaning: "Which race: race.race_id." },
      { name: "name", meaning: "The name as the source wrote it, for example 'MINERVA CLASSIC BRUGGE - DE PANNE'." },
      { name: "source", meaning: "Where the name comes from: uci for DataRide." },
      { name: "first_year", meaning: "The first year this name was used." },
      { name: "last_year", meaning: "The last year this name was used." },
    ],
    links: "race_id -> race.race_id",
    example: { title: "Every name each race has had", sql: "SELECT r.name AS race, n.name AS external_name, n.first_year, n.last_year FROM race_name n JOIN race r ON r.race_id = n.race_id ORDER BY r.name, n.first_year" },
  },
  {
    name: "race_link",
    kind: "table",
    summary: "Where each race lives on the web: official site, Wikipedia, social media and FirstCycling.",
    columns: [
      { name: "race_id", meaning: "Which race: race.race_id." },
      { name: "kind", meaning: "website, wikipedia, wikidata, x, instagram, facebook, youtube, tiktok, firstcycling or other." },
      { name: "label", meaning: "The name to show for the link, for example Instagram." },
      { name: "url", meaning: "The address." },
      { name: "source", meaning: "Where it came from: registry (the race registry of the Threads tab), wikidata (a match you checked) or manual (typed in)." },
    ],
    links: "race_id -> race.race_id",
    example: { title: "The links of every race that has any", sql: "SELECT r.name, l.label, l.url FROM race_link l JOIN race r ON r.race_id = l.race_id ORDER BY r.name, l.kind" },
  },
  {
    name: "country",
    kind: "table",
    summary: "Every country code UCI uses, with its continent and UCI confederation, for filtering races, riders and teams by continent.",
    columns: [
      { name: "code", meaning: "The code UCI uses (IOC style): ITA, GER, SUI ... It is the value in queue_race.country, result_row.nation and team_rank.nation." },
      { name: "name", meaning: "The country's name." },
      { name: "continent", meaning: "Europe, Asia, Africa, North America (with Central America and the Caribbean), South America or Oceania." },
      { name: "confederation", meaning: "UCI's continental confederation: Europe, Asia, Africa, Pan America or Oceania." },
    ],
    links: "country.code = queue_race.country, result_row.nation, team_rank.nation",
    example: { title: "Races captured per continent", sql: "SELECT c.continent, COUNT(*) AS races FROM queue_race q JOIN country c ON c.code = q.country GROUP BY c.continent ORDER BY races DESC" },
  },
  {
    name: "queue_race",
    kind: "table",
    summary: "The competitions to capture, taken from the DataRide competition list pages you captured.",
    columns: [
      { name: "uci_id", meaning: "DataRide's competition number for this edition." },
      { name: "year", meaning: "The year." },
      { name: "name", meaning: "The race name." },
      { name: "start", meaning: "First day, yyyy-mm-dd." },
      { name: "end", meaning: "Last day, yyyy-mm-dd (the same for a one-day race)." },
      { name: "country", meaning: "The country (UCI's three-letter code)." },
      { name: "hub", meaning: "Where the line came from (DataRide)." },
      { name: "class", meaning: "The UCI class from the list, for example 2.UWT, 1.Pro, 1.1." },
      { name: "category", meaning: "ME = men, WE = women, from the list's Category filter or the race name." },
      { name: "race_id", meaning: "Which race this edition belongs to: race.race_id." },
    ],
    links: "uci_id = race_result.uci_id once the race has been captured; queue_event.uci_id = queue_race.uci_id",
    example: { title: "Races in the queue that are not captured yet", sql: "SELECT q.year, q.name, q.start, q.hub FROM queue_race q WHERE q.uci_id NOT IN (SELECT uci_id FROM race_result) ORDER BY q.start" },
  },
  {
    name: "queue_event",
    kind: "table",
    summary: "The events of a queued competition (General Classification, each stage), read from its DataRide competition page.",
    columns: [
      { name: "uci_id", meaning: "Which competition: queue_race.uci_id." },
      { name: "event_id", meaning: "DataRide's number for the event." },
      { name: "name", meaning: "The event's name, for example 'Stage 3'." },
    ],
    links: "uci_id -> queue_race.uci_id; event_id = classification.event_id once captured",
    example: { title: "Events still to capture", sql: "SELECT q.year, q.name, e.name AS event FROM queue_event e JOIN queue_race q ON q.uci_id = e.uci_id WHERE e.event_id NOT IN (SELECT event_id FROM classification WHERE event_id IS NOT NULL) ORDER BY q.start, e.event_id" },
  },
  {
    name: "kv",
    kind: "table",
    summary: "Texts and settings you edit on the pages, stored with the data.",
    columns: [
      { name: "key", meaning: "The name: season (YAML), registry (YAML), layout (JSON), sharenote and a few more." },
      { name: "value", meaning: "The text." },
    ],
    example: { title: "What is saved", sql: "SELECT key, LENGTH(value) AS characters FROM kv ORDER BY key" },
  },
  {
    name: "meta",
    kind: "table",
    summary: "Facts about the database file itself.",
    columns: [
      { name: "key", meaning: "The name: schema_version; in a public file also public, beta, beta_note, credits, made, races, editions, results, first_year and last_year (what the file holds)." },
      { name: "value", meaning: "The value. A file whose schema version is newer than the tool's is refused." },
    ],
    example: { title: "The schema version", sql: "SELECT key, value FROM meta" },
  },
  {
    name: "v_team_points",
    kind: "view",
    summary: "team_rank with the season and date of its ranking: the easy way to ask about team points.",
    columns: [
      { name: "season", meaning: "The season." },
      { name: "date", meaning: "The ranking date." },
      { name: "team_id", meaning: "UCI's team number." },
      { name: "code", meaning: "The team's code that season." },
      { name: "name", meaning: "The team's name that season." },
      { name: "nation", meaning: "The team's nation." },
      { name: "rank", meaning: "Position on that date." },
      { name: "points", meaning: "UCI World Ranking points, season to date." },
    ],
    links: "Group by team_id to follow one team through renames.",
    example: { title: "One team over the years (UAE has UCI team number 595)", sql: "SELECT season, date, code, name, rank, points FROM v_team_points WHERE team_id = 595 ORDER BY date" },
  },
  {
    name: "v_results",
    kind: "view",
    summary: "Every point-scoring result with its race, in one table: the easy way to ask about riders and results.",
    columns: [
      { name: "uci_id", meaning: "UCI's number for the race edition." },
      { name: "year", meaning: "The year." },
      { name: "race", meaning: "The race name." },
      { name: "class", meaning: "The UCI class." },
      { name: "label", meaning: "The section of the page (for example Final Classification)." },
      { name: "title", meaning: "The result list's title." },
      { name: "rank", meaning: "The place." },
      { name: "rider", meaning: "The rider." },
      { name: "team", meaning: "The team name on the race page." },
      { name: "nation", meaning: "The rider's nation." },
      { name: "result", meaning: "Time or gap." },
      { name: "points", meaning: "UCI points." },
      { name: "race_id", meaning: "The race (the same in every year): race.race_id." },
      { name: "race_name", meaning: "The race's internal name, the same in every year. The column race is the external name UCI used that year." },
      { name: "age", meaning: "The rider's age at the time of the race, as DataRide shows it." },
    ],
    example: { title: "Points per team from the race results", sql: "SELECT team, SUM(points) AS points, COUNT(DISTINCT uci_id) AS races FROM v_results GROUP BY team ORDER BY points DESC LIMIT 20" },
  },
];

/** The overview as Markdown, to paste into a post or a document. */
export function dictionaryMarkdown(docs: TableDoc[] = DICTIONARY): string {
  const nl = String.fromCharCode(10);
  const out: string[] = [
    "# KinderkopjeDB data: tables and fields",
    "",
    "Rankings, calendars and results come from the Union Cycliste Internationale (UCI): uci.org and DataRide. Team levels come from Wikipedia (CC BY-SA 4.0).",
    "",
  ];
  for (const t of docs) {
    out.push("## " + t.name + (t.kind === "view" ? " (view)" : ""), "", t.summary, "");
    out.push("|Field|Meaning|", "|:-|:-|");
    for (const c of t.columns) out.push("|`" + c.name + "`|" + c.meaning.replace(/\|/g, "/") + "|");
    if (t.links) out.push("", "Links: " + t.links);
    out.push("", "Example, " + t.example.title.toLowerCase() + ":", "", "```sql", t.example.sql, "```", "");
  }
  return out.join(nl);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The overview as one self-contained HTML page (no scripts, light and dark, prints well), for download. */
export function dictionaryHtml(docs: TableDoc[] = DICTIONARY, version = ""): string {
  const nl = String.fromCharCode(10);
  const out: string[] = [];
  out.push(
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>KinderkopjeDB data: tables and fields</title>",
    "<style>",
    ":root{--bg:#fff;--fg:#1c1c1c;--mut:#666;--line:#ddd;--acc:#c2410c;--code:#f3f4f6}",
    "@media (prefers-color-scheme:dark){:root{--bg:#121316;--fg:#eee;--mut:#9aa;--line:#33363d;--acc:#ff8a4c;--code:#1d1f24}}",
    "body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:20px}",
    "main{max-width:880px;margin:0 auto}",
    "h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 4px;border-top:1px solid var(--line);padding-top:14px}",
    ".mut{color:var(--mut);font-size:13px}",
    "table{border-collapse:collapse;width:100%;font-size:14px;margin:8px 0}",
    "th,td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line);vertical-align:top}",
    "code,pre{background:var(--code);border-radius:4px;font:13px ui-monospace,Consolas,monospace}code{padding:1px 4px}",
    "pre{padding:8px;white-space:pre-wrap;word-break:break-word}",
    "a{color:var(--acc)}.view{font-size:12px;border:1px solid var(--line);border-radius:10px;padding:0 6px;margin-left:6px}",
    "@media print{body{padding:0}h2{break-after:avoid}table,pre{break-inside:avoid}}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    "<h1>KinderkopjeDB data: tables and fields</h1>",
    '<p class="mut">What is in the KinderkopjeDB database (SQLite)' + (version ? ", " + esc(version) : "") + ". Open the Data page of the tool to ask it questions in SQL (read only). The two views, <code>v_team_points</code> and <code>v_results</code>, are the easy way in.</p>",
    '<p class="mut">Rankings, calendars and results come from the Union Cycliste Internationale (UCI): uci.org and DataRide. Team levels come from Wikipedia (CC BY-SA 4.0).</p>',
    "<ul>",
  );
  for (const d of docs) out.push('<li><a href="#' + esc(d.name) + '">' + esc(d.name) + "</a>" + (d.kind === "view" ? " (view)" : "") + ": " + esc(d.summary) + "</li>");
  out.push("</ul>");
  for (const d of docs) {
    out.push(
      '<h2 id="' + esc(d.name) + '">' + esc(d.name) + (d.kind === "view" ? '<span class="view">view</span>' : "") + "</h2>",
      "<p>" + esc(d.summary) + "</p>",
      "<table>",
      "<tr><th>Field</th><th>Meaning</th></tr>",
    );
    for (const c of d.columns) out.push("<tr><td><code>" + esc(c.name) + "</code></td><td>" + esc(c.meaning) + "</td></tr>");
    out.push("</table>");
    if (d.links) out.push('<p class="mut">Links: ' + esc(d.links) + "</p>");
    out.push('<p class="mut">Example, ' + esc(d.example.title.toLowerCase()) + ":</p>", "<pre>" + esc(d.example.sql) + "</pre>");
  }
  out.push("</main>", "</body>", "</html>", "");
  return out.join(nl);
}

/** The overview as JSON, for people who want to use it in their own tools. */
export function dictionaryJson(docs: TableDoc[] = DICTIONARY, version = ""): string {
  return JSON.stringify({ name: "KinderkopjeDB data overview", version, tables: docs }, null, 2) + String.fromCharCode(10);
}
