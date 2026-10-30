import type { ResultRow } from "./cube";
import { parseUciDates } from "./uci-hub";

/**
 * Readers for the three kinds of DataRide road pages a moderator opens in their own browser:
 *  - the list of competitions (dataride.uci.ch/iframe/Results/10/): date, competition link, country, class
 *  - one competition (.../iframe/CompetitionResults/<id>): links to its events (General Classification, stages)
 *  - one event (.../iframe/EventResults/<eventId>?competitionId=<id>&disciplineId=10): the result table
 * They read what is already on screen. The competition id is DataRide's own number for a race edition.
 */

export type PageKind = "list" | "competition" | "event";

/** ME = men's elite, WE = women's elite: the only two categories this project collects. */
export type Category = "ME" | "WE";

export const CATEGORY_NAMES: Record<Category, string> = { ME: "Men elite", WE: "Women elite" };

/** The category named by the list page's Category filter, when it is "Men Elite" or "Women Elite". */
export function categoryFromFilter(text: string): Category | undefined {
  const t = text.trim().toLowerCase();
  if (!t.includes("elite") || t.includes("under 23") || t.includes("u23") || t.includes("junior")) return undefined;
  if (t.startsWith("women")) return "WE";
  if (t.startsWith("men")) return "ME";
  return undefined;
}

/** What kind of race a name says it is. A road race (IRR) and an unmarked name are both "road"; time trials are their own races. */
export type RaceKind = "road" | "tt" | "ttt" | "relay";

export function raceKind(name: string): RaceKind {
  const words = name.toLowerCase().split(/[^a-z]+/).filter((w) => w !== "");
  const has = (w: string) => words.includes(w);
  if (has("relay")) return "relay";
  if (has("ttt") || (has("team") && (has("tt") || (has("time") && has("trial"))))) return "ttt";
  if (has("itt") || has("tt") || (has("time") && has("trial")) || (has("contre") && has("montre")) || has("cronometro") || has("crono") || has("chrono")) return "tt";
  return "road";
}

/** A Category filter that names some other category (Men Under 23, Women Junior ...), which is not collected. */
export function isOtherCategory(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (t.startsWith("men") || t.startsWith("women")) && categoryFromFilter(text) === undefined;
}

export interface DrCompetition {
  id: number;
  name: string;
  start: string; // ISO
  end: string;
  year: number;
  country: string;
  class: string; // "1.Pro", "2.UWT" ...
  inProgress: boolean;
  category?: Category;
}

export interface DrEvent {
  id: number;
  name: string;
}

export interface DrCompetitionEvents {
  competitionId: number;
  events: DrEvent[];
}

export interface DrEventResult {
  competitionId: number;
  eventId: number;
  heading: string; // "Giro del Veneto Individual Road Race"
  date?: string; // ISO start date of the event, when the page says
  totalRows: number; // how far the table reached: the highest rank on screen (one page of the table is 40 rows)
  rows: ResultRow[]; // only the rows that score points
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export function pageKind(pathname: string): PageKind | undefined {
  if (/\/iframe\/Results\/\d*\/?$/i.test(pathname)) return "list";
  if (/\/iframe\/CompetitionResults\/\d+/i.test(pathname)) return "competition";
  if (/\/iframe\/EventResults\/\d+/i.test(pathname)) return "event";
  return undefined;
}

/** The women's races of the list are told from the men's by the page's Category filter, or by the name. */
export function categoryOf(name: string, filterText = ""): Category {
  const named = categoryFromFilter(filterText);
  if (named) return named;
  return /women|donne|dames|femmes|f[eé]minin|femenina|femminile|vrouwen|damen/i.test(name) ? "WE" : "ME";
}

/** Rows of the competition list. `filterText` is the text of the Category filter ("Men Elite"), if the page shows it. */
export function readCompetitionList(doc: Document, filterText = ""): DrCompetition[] {
  const out: DrCompetition[] = [];
  for (const tr of Array.from(doc.querySelectorAll("tr"))) {
    const a = tr.querySelector("a.uci-competition-link, a[href*='/CompetitionResults/']");
    const id = /CompetitionResults\/(\d+)/i.exec(a?.getAttribute("href") ?? "")?.[1];
    if (!a || !id) continue;
    const tds = Array.from(tr.querySelectorAll("td"));
    const dates = parseUciDates(clean(tds[0]?.textContent));
    if (!dates) continue;
    const name = clean(a.textContent);
    out.push({
      id: Number(id),
      name,
      start: dates.start,
      end: dates.end,
      year: Number(dates.end.slice(0, 4)),
      country: clean(tds[2]?.textContent),
      class: clean(tds[3]?.textContent),
      inProgress: clean(tr.querySelector(".uci-small-label")?.textContent) !== "",
      category: categoryOf(name, filterText),
    });
  }
  return out;
}

/**
 * The events a competition page links to. A stage race lists its stages as rows that open to show their classifications,
 * and only the rows that are open have links in the page, so each event is named after the row it sits under
 * ("Stage 5: Stage Classification", "Final Classification: General Classification"). A one-day race links directly.
 */
export function readCompetitionEvents(doc: Document, pathname: string): DrCompetitionEvents | undefined {
  const competitionId = Number(/CompetitionResults\/(\d+)/i.exec(pathname)?.[1]);
  if (!competitionId) return undefined;
  const events: DrEvent[] = [];
  for (const a of Array.from(doc.querySelectorAll("a[href*='/EventResults/']"))) {
    const id = Number(/EventResults\/(\d+)/i.exec(a.getAttribute("href") ?? "")?.[1]);
    if (!id || events.some((e) => e.id === id)) continue;
    const text = clean(a.textContent);
    // the row this link's detail row belongs to: the stage, or the final classification
    const master = a.closest("tr.k-detail-row")?.previousElementSibling;
    const cells = master ? Array.from(master.querySelectorAll("td")).map((c) => clean(c.textContent)) : [];
    const parent = cells.find((c) => c !== "");
    events.push({ id, name: parent && parent !== text ? parent + ": " + text : text });
  }
  return { competitionId, events };
}

/** Add events to a list, keeping the ones already there (a competition page is captured a few open rows at a time). */
export function mergeEvents(have: DrEvent[], more: DrEvent[]): DrEvent[] {
  const byId = new Map(have.map((e) => [e.id, e]));
  for (const e of more) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** The result table of an event, restricted to the rows that score points. */
export function readEventResults(doc: Document, pathname: string, search: string): DrEventResult | undefined {
  const eventId = Number(/EventResults\/(\d+)/i.exec(pathname)?.[1]);
  const competitionId = Number(/competitionId=(\d+)/i.exec(search)?.[1]);
  if (!eventId || !competitionId) return undefined;

  const table = Array.from(doc.querySelectorAll("table")).find((t) => {
    const heads = Array.from(t.querySelectorAll("th")).map((h) => clean(h.textContent).toLowerCase());
    return heads.includes("rider") && heads.includes("points");
  });
  if (!table) return undefined;
  const heads = Array.from(table.querySelectorAll("th")).map((h) => clean(h.textContent).toLowerCase());
  const col = (name: string) => heads.indexOf(name);

  const rows: ResultRow[] = [];
  let totalRows = 0;
  let lastRank = 0;
  for (const tr of Array.from(table.querySelectorAll("tbody tr"))) {
    const tds = Array.from(tr.querySelectorAll("td"));
    if (tds.length < heads.length) continue;
    totalRows++;
    const cell = (name: string) => clean(tds[col(name)]?.textContent);
    const pointsCell = tds[col("points")];
    const points = parseFloat(clean(pointsCell?.querySelector(".uci-points-left")?.textContent ?? pointsCell?.textContent).replace(",", "."));
    const rank = parseInt(cell("rank"), 10);
    if (rank > lastRank) lastRank = rank;
    if (!(points > 0)) continue;
    rows.push({
      rank: rank > 0 ? rank : null,
      rider: cell("rider"),
      team: cell("team"),
      age: parseInt(cell("age"), 10) || null,
      nation: cell("nation"),
      result: cell("result"),
      points,
    });
  }

  // "Giro del Veneto Individual Road Race - 14 Oct 2026 Results": the page's heading (read without the page's scripts)
  const body = doc.body?.cloneNode(true) as HTMLElement | undefined;
  for (const x of Array.from(body?.querySelectorAll("script, style") ?? [])) x.remove();
  const text = clean(body?.textContent);
  const m = /(?:IFrame\s+)?(.{3,160}?)\s+-\s+(\d{1,2}\s+[A-Za-z]{3}(?:\s*-\s*\d{1,2}\s+[A-Za-z]{3})?\s+\d{4})\s+Results/.exec(text);
  const out: DrEventResult = { competitionId, eventId, heading: m ? clean(m[1]!.replace(/^IFrame\s+/, "")) : "", totalRows: Math.max(totalRows, lastRank), rows };
  const when = m ? parseUciDates(m[2]!) : undefined;
  if (when) out.date = when.start;
  return out;
}

/** A heading with page script in front of it (an older capture): keep what comes after the script. */
export function cleanHeading(h: string): string {
  const i = h.lastIndexOf("});");
  return clean(i >= 0 ? h.slice(i + 3) : h);
}

/**
 * The events a race is counted by: the result of each stage and the final general classification. Not the jersey
 * classifications (points, mountains, youth, teams ...), and not the standings after each stage ("Stage 5: Stage General
 * Classification", "Stage 5: Overall Points Classification"): those are cumulative, and give a point or two to the leader
 * at most. A stage race of 21 stages is 22 events, whatever DataRide lists besides.
 */
export function isScoringEvent(name: string): boolean {
  return !/points|youth|young|mountain|climber|sprint classif|combativ|teams? classif|best |kom|overall|stage general/i.test(name);
}

/**
 * The extra events that pay points on top of the stages and the general classification:
 *   leader: "Stage 5: Stage General Classification", the standings after a stage, one rider (the leader) scores
 *   final:  "Final Classification: Points Classification" / "Mountain Classification", a few riders score
 * Nothing else is asked for: the other jersey classifications (daily points and mountains, youth, teams) paid nothing where
 * we looked. `final` is separate because it is not known to pay in every race.
 */
export type JerseyKind = "leader" | "final";

export function jerseyKind(name: string): JerseyKind | undefined {
  if (/^Stage \d+: Stage General Classification$/i.test(name.trim())) return "leader";
  if (/^Final Classification: (Points|Mountains?) Classification$/i.test(name.trim())) return "final";
  return undefined;
}

/**
 * A competition's events that have not been captured yet: the stage results and the general classification (`results`),
 * and the jersey pages (`leader` in stage order, `final`).
 */
export function missingJerseyEvents(events: DrEvent[], capturedIds: Iterable<number>): { results: DrEvent[]; leader: DrEvent[]; final: DrEvent[] } {
  const have = new Set(capturedIds);
  const stage = (e: DrEvent) => Number(/^Stage (\d+)/i.exec(e.name)?.[1] ?? 0);
  const todo = events.filter((e) => !have.has(e.id));
  return {
    results: todo.filter((e) => isScoringEvent(e.name)).sort((a, b) => stage(a) - stage(b) || a.name.localeCompare(b.name)),
    leader: todo.filter((e) => jerseyKind(e.name) === "leader").sort((a, b) => stage(a) - stage(b)),
    final: todo.filter((e) => jerseyKind(e.name) === "final").sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The address of an event page, as the competition page links to it. */
export function eventPagePath(competitionId: number, eventId: number): string {
  return "/iframe/EventResults/" + eventId + "?competitionId=" + competitionId + "&disciplineId=10";
}

/** The address of a competition page, as the competition list links to it. */
export function competitionPagePath(competitionId: number): string {
  return "/iframe/CompetitionResults/" + competitionId + "?disciplineId=10";
}

/** True when a saved event list holds the opened rows (stages, final classifications), not just the closed page. */
export function hasEventList(ce: DrCompetitionEvents | undefined): boolean {
  return !!ce && ce.events.some((e) => /^(Stage|Prologue|Final)/i.test(e.name));
}

export interface CaptureSkips {
  competitions: number[];
  events: number[];
}

/** One competition's pages still to open, in the order to open them: results, leader pages, final jersey pages. */
export function missingEventsInOrder(c: { competitionEvents: DrCompetitionEvents[]; eventResults: { competitionId: number; eventId: number }[] }, competitionId: number, skipEvents: Iterable<number> = []): DrEvent[] {
  const ce = c.competitionEvents.find((x) => x.competitionId === competitionId);
  if (!ce) return [];
  const have = c.eventResults.filter((r) => r.competitionId === competitionId).map((r) => r.eventId);
  const m = missingJerseyEvents(ce.events, [...have, ...skipEvents]);
  return [...m.results, ...m.leader, ...m.final];
}

/**
 * The next page to open after a capture: the missing pages of the race it came from first, then each race of the list in
 * order (its competition page when its events are not known yet, else its first missing page). Races still in progress
 * and anything skipped are left out. Undefined when nothing is left.
 */
export function nextPageToOpen(
  c: { competitions: DrCompetition[]; competitionEvents: DrCompetitionEvents[]; eventResults: { competitionId: number; eventId: number }[] },
  from?: number,
  skip: CaptureSkips = { competitions: [], events: [] },
): { path: string; label: string } | undefined {
  const names = new Map(c.competitions.map((x) => [x.id, x.name]));
  const order = [...(from !== undefined ? [from] : []), ...c.competitions.filter((x) => !x.inProgress).map((x) => x.id), ...c.competitionEvents.map((x) => x.competitionId)];
  const seen = new Set<number>();
  for (const id of order) {
    if (seen.has(id) || skip.competitions.includes(id)) continue;
    seen.add(id);
    const name = names.get(id) ?? "Competition " + id;
    if (!hasEventList(c.competitionEvents.find((x) => x.competitionId === id))) return { path: competitionPagePath(id), label: name };
    const next = missingEventsInOrder(c, id, skip.events)[0];
    if (next) return { path: eventPagePath(id, next.id), label: name + ": " + next.name };
  }
  return undefined;
}

/** Rows in one page of a DataRide table. */
export const PAGE_SIZE = 40;

/**
 * A result list is complete when the table went on past the last scoring row (a non-scoring row was seen), or when the
 * last page was short (the table ended there). Otherwise the next page may hold more points.
 */
export function isComplete(c: { rows: unknown[]; totalRows: number }): boolean {
  return c.rows.length < c.totalRows || c.rows.length % PAGE_SIZE !== 0;
}
