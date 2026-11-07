import { parse as parseYaml } from "yaml";
import { cleanHeading, isComplete, isScoringEvent, mergeEvents } from "./dataride";
import { CATEGORY_NAMES, raceKind } from "./dataride";
import type { Category, DrCompetition, DrCompetitionEvents, DrEventResult } from "./dataride";
import { slugify } from "./ical";
import { LinkStore, RaceLink, linksFor } from "./links";
import { normRaceName } from "./uci-hub";

/**
 * Team points cube, slice 1: UCI World Ranking, team ranking snapshots by date.
 * Input: files made by tools/capture-dataride.js ("racethreads-capture/1").
 * Teams are keyed by UCI's own team id (objectId), which stays the same when a team is renamed
 * or changes its code (UAD in 2025, UEX in 2026 are the same team).
 */

export interface CaptureRow {
  rank: number;
  change?: string;
  name: string;
  code: string;
  nation: string;
  points: number;
  objectId: number | null;
  momentId: number | null;
}

export interface CaptureSnapshot {
  key: string;
  rankingTypeId: number | null;
  season: string;
  date: string; // ISO yyyy-mm-dd
  momentId: number | null;
  total: number | null;
  complete?: boolean;
  rows: CaptureRow[];
}

export interface CaptureFile {
  // The format id keeps the tool's earlier name so that files saved before the rename still open.
  format: "racethreads-capture/1";
  snapshots?: CaptureSnapshot[]; // DataRide team ranking pages
  raceResults?: RaceResult[]; // UCI race pages (older captures)
  competitions?: DrCompetition[]; // the DataRide competition list
  competitionEvents?: DrCompetitionEvents[]; // the events of competition pages
  eventResults?: DrEventResult[]; // DataRide event pages
}

/** One row of a UCI race result that scored points. */
export interface ResultRow {
  rank: number | null;
  rider: string;
  team: string;
  age: number | null;
  nation: string;
  result: string;
  points: number;
}

export interface ResultClassification {
  label: string; // the section opened on the page ("Final Classification", a stage ...)
  title: string; // "General Classification"
  eventId?: number; // DataRide's number for the event, when the rows came from a DataRide event page
  date?: string; // ISO day of the event, from the event page's heading
  totalRows: number; // rows in the table, only the point-scoring ones are kept in `rows`
  rows: ResultRow[];
}

export interface RaceResult {
  uciId: number; // DataRide's competition id for this edition (older captures: the uci.org race number)
  year: number;
  name: string;
  class?: string;
  classText?: string;
  dates?: string;
  start?: string; // ISO first and last day: DataRide's competition list, else the first and last event date (fillRaceDates)
  end?: string;
  country?: string;
  capturedAt?: string;
  contributor?: string; // who captured it, when it came from a helper moderator
  classifications: ResultClassification[];
}

/** A race that should be captured (from a UCI hub page). */
export interface QueueRace {
  uciId: number;
  year: number;
  name: string;
  start: string; // ISO
  end: string;
  country: string;
  hub: string; // "2027 UCI WorldTour"
  class?: string; // "1.Pro", "2.UWT" ... (from the DataRide list)
  category?: Category;
  events?: { id: number; name: string }[]; // from the competition page
}

export interface TeamPoint {
  teamId: number;
  code: string;
  name: string;
  nation: string;
  rank: number;
  points: number;
}

export interface TeamSnapshot {
  date: string; // ISO
  season: number;
  momentId: number | null;
  complete: boolean; // every team of the ranking was captured
  teams: TeamPoint[];
}

export interface Cube {
  teamSnapshots: TeamSnapshot[];
  /** WorldTeam and ProTeam ids per season (key = season), see team-levels.ts */
  levels?: Record<string, { WT: number[]; PT: number[] }>;
  raceResults?: RaceResult[];
  queue?: QueueRace[];
}

export function emptyCube(): Cube {
  return { teamSnapshots: [] };
}

export interface ImportReport {
  added: number;
  replaced: number;
  races: number; // race results added or updated
  competitions?: number; // competitions added to or updated in the queue
  categories?: Record<string, number>; // of those, how many per category ("Men elite" ...)
  events?: number; // event lists read from competition pages
  skipped: string[];
}

const TEAM_RANKING = 2;

/** Merge a capture file into the cube. Same date again = replaced (newer capture wins). */
export function addCapture(cube: Cube, file: CaptureFile): ImportReport {
  const report: ImportReport = { added: 0, replaced: 0, races: 0, skipped: [] };
  const hasData = (a: unknown) => Array.isArray(a);
  if (!file || file.format !== "racethreads-capture/1" || !(hasData(file.snapshots) || hasData(file.raceResults) || hasData(file.competitions) || hasData(file.competitionEvents) || hasData(file.eventResults))) {
    report.skipped.push("not a KinderkopjeDB capture file");
    return report;
  }
  for (const r of file.raceResults ?? []) {
    if (typeof r.uciId !== "number" || !Array.isArray(r.classifications)) {
      report.skipped.push("a race result without a UCI id or classifications");
      continue;
    }
    mergeRaceResult(cube, r);
    report.races++;
  }
  const index = new Map((cube.queue ?? []).map((q) => [q.uciId, q] as [number, QueueRace])); // by id, so a big file is not searched line by line
  const calendar = (cube.queue ?? []).filter((q) => q.uciId < 0); // lines from the UCI calendar, waiting for DataRide's
  for (const c of file.competitions ?? []) {
    upsertCompetition(cube, c, index, calendar);
    report.competitions = (report.competitions ?? 0) + 1;
    const name = CATEGORY_NAMES[c.category ?? "ME"];
    (report.categories ??= {})[name] = (report.categories[name] ?? 0) + 1;
  }
  if (file.competitions?.length) cube.queue!.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name)); // once, not for every competition
  for (const e of file.competitionEvents ?? []) {
    const q = queueRace(cube, e.competitionId, index);
    q.events = mergeEvents(q.events ?? [], e.events);
    report.events = (report.events ?? 0) + 1;
  }
  for (const e of file.eventResults ?? []) {
    if (!e.rows.length && !e.totalRows) {
      report.skipped.push("event " + e.eventId + ": no rows on the page (let it finish loading, then capture again)");
      continue;
    }
    mergeEventResult(cube, e);
    report.races++;
  }
  for (const s of file.snapshots ?? []) {
    if (s.rankingTypeId !== TEAM_RANKING) {
      report.skipped.push((s.season || "?") + " " + (s.date || "?") + ": not a team ranking");
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) {
      report.skipped.push((s.season || "?") + ": no date (pick the date on the page and capture again)");
      continue;
    }
    const teams: TeamPoint[] = [];
    for (const r of s.rows) {
      if (r.objectId === null || Number.isNaN(r.points)) continue;
      teams.push({ teamId: r.objectId, code: r.code, name: r.name, nation: r.nation, rank: r.rank, points: r.points });
    }
    const snap: TeamSnapshot = {
      date: s.date,
      season: Number(s.season) || Number(s.date.slice(0, 4)),
      momentId: s.momentId,
      complete: !!s.complete,
      teams,
    };
    const i = cube.teamSnapshots.findIndex((x) => x.date === snap.date);
    if (i >= 0) {
      cube.teamSnapshots[i] = snap;
      report.replaced++;
    } else {
      cube.teamSnapshots.push(snap);
      report.added++;
    }
  }
  cube.teamSnapshots.sort((a, b) => a.date.localeCompare(b.date));
  return report;
}

/** The queue entry for a competition, made as a stub when only its events (or results) have been seen. */
function queueRace(cube: Cube, id: number, index?: Map<number, QueueRace>): QueueRace {
  const q = (cube.queue ??= []);
  let r = index ? index.get(id) : q.find((x) => x.uciId === id);
  if (!r) {
    r = { uciId: id, year: 0, name: "Competition " + id, start: "", end: "", country: "", hub: "DataRide" };
    q.push(r);
    index?.set(id, r);
  }
  return r;
}

/** One line of the DataRide competition list into the queue (what a later capture knows better replaces what is there). */
/**
 * A line from the UCI calendar (a stand-in id below zero, see uci-calendar.ts) and a DataRide competition are the same
 * race: same season and category, the DataRide start within the calendar's dates (a day either side), and names alike.
 */
function sameCalendarRace(cal: QueueRace, c: DrCompetition): boolean {
  if (cal.year !== c.year || (cal.category ?? "ME") !== (c.category ?? "ME") || !cal.start || !c.start) return false;
  const day = (iso: string) => Date.parse(iso) / 86400000;
  if (day(c.start) < day(cal.start) - 1 || day(c.start) > day(cal.end || cal.start) + 1) return false;
  const [a, b] = [normRaceName(cal.name), normRaceName(c.name)];
  if (a === b || (a.length >= MIN_PREFIX && b.includes(a)) || (b.length >= MIN_PREFIX && a.includes(b))) return true;
  const words = telltaleWords(c.name);
  return [...telltaleWords(cal.name)].some((w) => words.has(w));
}

/**
 * Add or update a competition in the queue. A competition from DataRide takes the place of the calendar lines for the
 * same race (they have no DataRide id); a calendar line is not added when its DataRide competition is already there.
 */
function upsertCompetition(cube: Cube, c: DrCompetition, index: Map<number, QueueRace>, calendar: QueueRace[]): void {
  const queue = (cube.queue ??= []);
  if (c.id < 0 && !index.has(c.id)) {
    const asLine: QueueRace = { uciId: c.id, year: c.year, name: c.name, start: c.start, end: c.end, country: c.country, hub: "UCI calendar", ...(c.category ? { category: c.category } : {}) };
    const captured = queue.some((q) => q.uciId > 0 && q.year === c.year && sameCalendarRace(asLine, { id: q.uciId, name: q.name, start: q.start, end: q.end, year: q.year, country: q.country, class: q.class ?? "", inProgress: false, ...(q.category ? { category: q.category } : {}) }));
    if (captured) return;
  }
  if (c.id > 0 && calendar.length) {
    const gone = calendar.filter((cal) => sameCalendarRace(cal, c));
    for (const cal of gone) {
      queue.splice(queue.indexOf(cal), 1);
      calendar.splice(calendar.indexOf(cal), 1);
      index.delete(cal.uciId);
    }
  }
  const r = queueRace(cube, c.id, index);
  Object.assign(r, { year: c.year, name: c.name, start: c.start, end: c.end, country: c.country, class: c.class || undefined, category: c.category, hub: c.id < 0 ? "UCI calendar" : "DataRide" });
  if (c.id < 0) calendar.push(r);
}

/**
 * Rows from one DataRide event page. The page shows 40 rows at a time, so a second capture of the same event
 * (the next page of the table) adds to the rows already kept.
 */
export function mergeEventResult(cube: Cube, e: DrEventResult): void {
  const q = (cube.queue ?? []).find((x) => x.uciId === e.competitionId);
  const heading = cleanHeading(e.heading);
  const list = (cube.raceResults ??= []);
  let race = list.find((x) => x.uciId === e.competitionId);
  if (!race) {
    const year = q?.year || Number((e.date ?? "").slice(0, 4)) || new Date().getFullYear();
    race = { uciId: e.competitionId, year, name: q?.name ?? (heading || "Competition " + e.competitionId), classifications: [] };
    if (q?.class) race.class = q.class;
    if (q?.country) race.country = q.country;
    list.push(race);
  }
  race.capturedAt = new Date().toISOString();
  const label = q?.events?.find((x) => x.id === e.eventId)?.name || "Event " + e.eventId;
  const have = race.classifications.find((c) => c.eventId === e.eventId);
  if (!have) {
    race.classifications.push({ label, title: heading || label, eventId: e.eventId, ...(e.date ? { date: e.date } : {}), totalRows: e.totalRows, rows: e.rows });
    return;
  }
  // a capture imported again brings the date to a classification stored before dates were kept
  if (e.date) have.date = e.date;
  const key = (r: { rank: number | null; rider: string }) => r.rank + "|" + r.rider;
  const rows = new Map(have.rows.map((r) => [key(r), r]));
  for (const r of e.rows) rows.set(key(r), r);
  have.rows = [...rows.values()].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  have.totalRows = Math.max(have.totalRows, e.totalRows);
  have.label = label;
}

/**
 * The first and last day of each captured race: from DataRide's competition list when it was captured, else from the
 * first and last event date. An event of a one-day race without its own date gets the race's day.
 */
export function fillRaceDates(cube: Cube): void {
  const queue = new Map((cube.queue ?? []).map((q) => [q.uciId, q] as [number, QueueRace]));
  for (const r of cube.raceResults ?? []) {
    const q = queue.get(r.uciId);
    if (q?.start && q.end) {
      r.start = q.start;
      r.end = q.end;
    } else {
      const days = r.classifications.map((c) => c.date).filter((d): d is string => !!d).sort();
      if (days.length) {
        r.start = days[0];
        r.end = days[days.length - 1];
      }
    }
    if (r.start && r.start === r.end) for (const c of r.classifications) c.date ??= r.start;
  }
}

/** Add or update one race's results; classifications with the same label and title are replaced. */
export function mergeRaceResult(cube: Cube, r: RaceResult): void {
  const list = (cube.raceResults ??= []);
  const have = list.find((x) => x.uciId === r.uciId);
  if (!have) {
    list.push({ ...r, classifications: [...r.classifications] });
    return;
  }
  Object.assign(have, { ...r, classifications: have.classifications });
  for (const c of r.classifications) {
    const i = have.classifications.findIndex((x) => (c.eventId !== undefined ? x.eventId === c.eventId : x.label === c.label && x.title === c.title));
    if (i >= 0) have.classifications[i] = c;
    else have.classifications.push(c);
  }
}

/** Put a hub page's races into the capture queue (races already there are kept as they are). */
export function addQueue(cube: Cube, hubTitle: string, year: number, races: { uciId: number; name: string; start: string; end: string; country: string }[]): number {
  const q = (cube.queue ??= []);
  let added = 0;
  for (const r of races) {
    if (q.some((x) => x.uciId === r.uciId)) continue;
    q.push({ uciId: r.uciId, year, name: r.name, start: r.start, end: r.end, country: r.country, hub: hubTitle });
    added++;
  }
  q.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  return added;
}

export interface QueueLine extends QueueRace {
  captured: boolean;
  rows: number; // point-scoring rows captured so far
  classifications: number;
  eventsKnown: number; // events listed on the competition page that give points (general classification, stages)
  eventsCaptured: number; // of those, events with a result captured
  eventsComplete: number; // of those, events whose table was read to the end (not waiting for the next page)
  missingEvents: { id: number; name: string }[]; // events that give points and have no result captured yet
  waitingEvents: { id: number; name: string }[]; // captured, but the next page of the table is still to be read
}

/** The queue with what has been captured for each race. */
export function queueStatus(cube: Cube): QueueLine[] {
  const byId = new Map((cube.raceResults ?? []).map((r) => [r.uciId, r]));
  // a race whose results were captured without its line in the queue still belongs in it: results are never left without a race
  const inQueue = new Set((cube.queue ?? []).map((q) => q.uciId));
  const orphans: QueueRace[] = (cube.raceResults ?? [])
    .filter((r) => !inQueue.has(r.uciId))
    .map((r) => ({ uciId: r.uciId, year: r.year, name: r.name, start: "", end: "", country: r.country ?? "", hub: "captured results", ...(r.class ? { class: r.class } : {}) }));
  return [...(cube.queue ?? []), ...orphans].map((q) => {
    const r = byId.get(q.uciId);
    const rows = r ? r.classifications.reduce((n, c) => n + c.rows.length, 0) : 0;
    const byEvent = new Map((r?.classifications ?? []).map((c) => [c.eventId, c]));
    // the events the competition page listed, plus any result captured for the competition that the list did not mention
    const listed = (q.events ?? []).filter((e) => isScoringEvent(e.name));
    const extra = (q.events?.length ? r?.classifications ?? [] : []).filter((c) => c.eventId !== undefined && !listed.some((e) => e.id === c.eventId) && isScoringEvent(c.label)).map((c) => ({ id: c.eventId!, name: c.label }));
    const scoring = [...listed, ...extra];
    const have = scoring.filter((e) => byEvent.has(e.id));
    const eventsComplete = have.filter((e) => isComplete(byEvent.get(e.id)!)).length;
    const missingEvents = scoring.filter((e) => !byEvent.has(e.id));
    const waitingEvents = have.filter((e) => !isComplete(byEvent.get(e.id)!));
    const line = { ...q, captured: !!r && rows > 0, rows, classifications: r ? r.classifications.length : 0, eventsKnown: scoring.length, eventsCaptured: have.length, eventsComplete, missingEvents, waitingEvents };
    // a one-day race has one event: no competition page is needed to know that
    if (!scoring.length && q.start && q.start === q.end && r?.classifications.length) {
      line.eventsKnown = 1;
      line.eventsCaptured = 1;
      line.eventsComplete = r.classifications.every(isComplete) ? 1 : 0;
      line.waitingEvents = r.classifications.filter((c) => !isComplete(c)).map((c) => ({ id: c.eventId ?? 0, name: c.label }));
    }
    return line;
  });
}

/** Seasons that are still being raced (data/cube/seasons.yaml). */
export function parseOpenSeasons(text: string): number[] {
  const v = parseYaml(text) as { open?: unknown } | null;
  return Array.isArray(v?.open) ? (v!.open as unknown[]).filter((x): x is number => typeof x === "number") : [];
}

/** A copy of the cube without the given seasons (the unfinished ones, by default in the page). */
export function withoutSeasons(cube: Cube, seasons: number[]): Cube {
  return { levels: cube.levels, teamSnapshots: cube.teamSnapshots.filter((s) => !seasons.includes(s.season)) };
}

export interface Merge {
  into: number; // UCI team id that continues
  from: number; // UCI team id that stops at `effective`
  effective: number; // first season of the merged team
  note?: string;
}

export interface Lineage {
  merges: Merge[];
}

export function parseLineage(text: string): Lineage {
  const v = parseYaml(text) as { merges?: unknown } | null;
  const merges = Array.isArray(v?.merges) ? (v!.merges as Merge[]) : [];
  for (const m of merges) {
    if (typeof m.into !== "number" || typeof m.from !== "number" || typeof m.effective !== "number") {
      throw new Error("team lineage: each merge needs numeric into, from and effective");
    }
  }
  return { merges };
}

/**
 * Seasons before a merge: add the stopping team's points to the continuing team, so the merged team's
 * history compares like with like (Lotto + Intermarché-Wanty before 2026). Returns a new cube.
 * Ranks are recomputed among the captured teams; they are left out (0) where the combined total
 * is lower than the lowest captured team, because then the true rank is unknown.
 */
export function combineMerged(cube: Cube, lineage: Lineage): Cube {
  const out: Cube = { levels: cube.levels, teamSnapshots: [] };
  for (const s of cube.teamSnapshots) {
    let teams = s.teams.map((t) => ({ ...t }));
    let changed = false;
    for (const m of lineage.merges) {
      if (s.season >= m.effective) continue;
      const from = teams.find((t) => t.teamId === m.from);
      if (!from) continue;
      const into = teams.find((t) => t.teamId === m.into);
      if (into) {
        into.points = round(into.points + from.points);
      } else {
        teams.push({ ...from, teamId: m.into }); // the continuing team was outside the captured part
      }
      teams = teams.filter((t) => t !== from);
      changed = true;
    }
    if (changed) {
      const lowest = Math.min(...s.teams.map((t) => t.points));
      teams.sort((a, b) => b.points - a.points);
      teams = teams.map((t, i) => ({ ...t, rank: t.points >= lowest ? i + 1 : 0 }));
    }
    out.teamSnapshots.push({ ...s, teams });
  }
  return out;
}

/** The latest snapshot of `season` that is on or before `cutoff` (ISO date). */
export function snapshotAsOf(cube: Cube, season: number, cutoff: string): TeamSnapshot | undefined {
  let best: TeamSnapshot | undefined;
  for (const s of cube.teamSnapshots) {
    if (s.season === season && s.date <= cutoff && (!best || s.date > best.date)) best = s;
  }
  return best;
}

/** The same calendar day in another year (29 Feb falls back to 28 Feb). */
export function sameDayInYear(iso: string, year: number): string {
  const md = iso.slice(5);
  if (md === "02-29") return year + "-02-28";
  return year + "-" + md;
}

export interface TeamLine {
  teamId: number;
  name: string;
  code: string;
  nation: string;
  now?: number;
  before?: number;
  diff?: number;
  rankNow?: number;
  rankBefore?: number;
}

/**
 * Season to date against the same date last year (the fair comparison while the season is running).
 * Teams are matched by UCI team id, so renamed teams stay one line.
 */
export function compareToLastYear(
  cube: Cube,
  year: number,
  cutoff: string,
  options: { top?: number } = {},
): { now?: TeamSnapshot; before?: TeamSnapshot; lines: TeamLine[] } {
  const now = snapshotAsOf(cube, year, cutoff);
  const before = snapshotAsOf(cube, year - 1, sameDayInYear(cutoff, year - 1));
  const lines = new Map<number, TeamLine>();
  const get = (t: TeamPoint): TeamLine => {
    let l = lines.get(t.teamId);
    if (!l) {
      l = { teamId: t.teamId, name: t.name, code: t.code, nation: t.nation };
      lines.set(t.teamId, l);
    }
    return l;
  };
  for (const t of before?.teams ?? []) {
    const l = get(t);
    l.before = t.points;
    l.rankBefore = t.rank;
  }
  for (const t of now?.teams ?? []) {
    const l = get(t);
    l.name = t.name; // the current name wins
    l.code = t.code;
    l.now = t.points;
    l.rankNow = t.rank;
  }
  for (const l of lines.values()) {
    if (l.now !== undefined && l.before !== undefined) l.diff = round(l.now - l.before);
  }
  const sorted = [...lines.values()].sort((a, b) => (b.now ?? -1) - (a.now ?? -1) || (b.before ?? -1) - (a.before ?? -1));
  return { now, before, lines: options.top ? sorted.slice(0, options.top) : sorted };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mapei Cadel Evans Great Ocean Road Race - Men" -> without the men/women suffix UCI adds. */
export function cleanRaceName(name: string): string {
  return name.replace(/\s*-\s*(Men|Women)\s*$/i, "").trim();
}

export interface RaceEditions {
  key: string;
  keyName: string; // a name as UCI wrote it that makes this key: the start of an alias line
  name: string;
  category: Category;
  editions: Record<number, QueueLine>; // by year
  others: number[]; // competition ids listed for the same year under the same name (one edition is shown per year)
}

/**
 * Alias lines, one per line: "Old name = Name it continues as". A line can list more names, "A = B = C = D": every name
 * before the last is joined into the last one. Blank lines and lines starting with # are ignored.
 */
export function parseRaceAliases(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of text.split(String.fromCharCode(10))) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const names = t.split("=").map((n) => n.trim()).filter((n) => n !== "");
    for (let k = 0; k < names.length - 1; k++) out.push([names[k]!, names[names.length - 1]!]);
  }
  return out;
}

/**
 * Accepted pairs (from, into) written as alias lines, one line per race: every name that ends up in the same race is on
 * the line, the name it continues as last. "B into A" and "C into A" become "B = C = A"; "A into B" and "B into C"
 * become "A = B = C". The order of the pairs does not matter.
 */
export function chainLines(pairs: [string, string][]): string[] {
  const next = new Map(pairs);
  const rootOf = (name: string) => {
    const seen = new Set<string>();
    let cur = name;
    while (next.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = next.get(cur)!;
    }
    return cur;
  };
  const groups = new Map<string, string[]>();
  for (const [from] of pairs) {
    const root = rootOf(from);
    if (root === from) continue; // a loop: written as it is below
    const names = groups.get(root) ?? [];
    if (!names.includes(from)) names.push(from);
    groups.set(root, names);
  }
  const lines = [...groups].map(([root, names]) => [...names, root].join(" = "));
  for (const [from, into] of pairs) if (rootOf(from) === from) lines.push(from + " = " + into);
  return lines;
}

const KIND_NAMES: Record<string, string> = { road: "road race", tt: "time trial", ttt: "team time trial", relay: "relay" };

/** Fold one race's editions into another's, unless both have an edition in the same year (then they are different races). */
function mergeEditions(from: RaceEditions, into: RaceEditions): boolean {
  if (Object.keys(from.editions).some((y) => y in into.editions)) return false;
  Object.assign(into.editions, from.editions);
  into.others.push(...from.others);
  const newest = Math.max(...Object.keys(into.editions).map(Number));
  into.name = cleanRaceName(into.editions[newest]!.name); // the newest name wins
  return true;
}

/** Shorter names must be at least this long (after cleaning) to be taken for the start of a longer one. */
const MIN_PREFIX = 8;

/** The queue grouped by race, before any joining. */
function groupQueue(cube: Cube): Map<string, RaceEditions> {
  const map = new Map<string, RaceEditions>();
  for (const l of queueStatus(cube)) {
    const category: Category = l.category ?? (/women/i.test(l.hub) ? "WE" : "ME");
    const key = normRaceName(l.name) + "|" + category;
    let r = map.get(key);
    if (!r) {
      r = { key, keyName: l.name, name: cleanRaceName(l.name), category, editions: {}, others: [] };
      map.set(key, r);
    }
    const newest = Math.max(l.year, ...Object.keys(r.editions).map(Number));
    if (l.year >= newest) r.name = cleanRaceName(l.name); // the newest name wins
    if (r.editions[l.year] && r.editions[l.year]!.uciId !== l.uciId) r.others.push(r.editions[l.year]!.uciId);
    r.editions[l.year] = l;
  }
  return map;
}

/** Apply the alias lines the user wrote down (or accepted), each with an account of what it did. */
function applyAliases(map: Map<string, RaceEditions>, aliases: string): { merged: string[]; aliasReport: string[] } {
  const merged: string[] = [];
  const aliasReport: string[] = [];
  const absorbed = new Set<string>(); // keys of races already folded into another by an earlier line
  for (const [from, to] of parseRaceAliases(aliases)) {
    let said = "";
    for (const category of ["ME", "WE"] as const) {
      const a = map.get(normRaceName(from) + "|" + category);
      const b = map.get(normRaceName(to) + "|" + category);
      if (!a || !b) continue;
      if (a === b) said = "already the same race";
      else if (raceKind(from) !== raceKind(to)) said = "not joined: one is a " + KIND_NAMES[raceKind(from)] + " and the other a " + KIND_NAMES[raceKind(to)];
      else if (mergeEditions(a, b)) {
        map.delete(a.key);
        absorbed.add(a.key);
        merged.push(a.name + " -> " + b.name);
        said = "joined";
      } else said = "not joined: both have an edition in the same year";
    }
    if (!said) {
      const known = (n: string) => ["ME", "WE"].some((c) => map.has(normRaceName(n) + "|" + c));
      const before = (n: string) => ["ME", "WE"].some((c) => absorbed.has(normRaceName(n) + "|" + c));
      said = before(from) ? "already joined by an earlier line" : !known(from) ? 'not joined: no race named "' + from + '" in the queue' : !known(to) ? 'not joined: no race named "' + to + '" in the queue' : "not joined: the two races are in different categories";
    }
    aliasReport.push(from + " = " + to + ": " + said);
  }
  return { merged, aliasReport };
}

/**
 * The queue grouped by race: one row per race, one edition per year. The ids differ from year to year, so
 * the editions are matched by race name, and men's and women's races stay apart. Races whose names changed are
 * joined only where an alias line says so (see suggestJoins for finding them).
 */
export function queueByRace(cube: Cube, aliases = ""): { years: number[]; races: RaceEditions[]; merged: string[]; aliasReport: string[] } {
  const map = groupQueue(cube);
  const { merged, aliasReport } = applyAliases(map, aliases);
  const years = [...new Set([...map.values()].flatMap((r) => Object.keys(r.editions).map(Number)))].sort((a, b) => b - a);
  return { years, races: [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || a.category.localeCompare(b.category)), merged, aliasReport };
}

/** One name a race has been called, by one source, with the years it was used. */
export interface ExternalName {
  name: string;
  years: number[];
}

/**
 * A race as the database knows it. `name` is the internal name (what we call it, and what the database shows first);
 * `names` are the external names: how UCI wrote it in each year. Internal names are unique within a category.
 */
export interface RaceRecord {
  key: string; // stays with the race when it is joined with others; what the database id follows
  name: string;
  slug: string;
  category: Category;
  names: ExternalName[];
  years: number[];
  uciIds: number[]; // DataRide competition ids of its editions
  class?: string; // the newest edition's UCI class
  country?: string; // the newest edition's country code
  links: RaceLink[]; // official site, Wikipedia, social media, FirstCycling (see links.ts)
}

/** The core of a race's names: the shortest once sponsors and the like are stripped; the newest edition's wins a tie. */
function coreName(names: ExternalName[]): string {
  return [...names].sort((a, b) => normRaceName(a.name).length - normRaceName(b.name).length || Math.max(...b.years) - Math.max(...a.years))[0]!.name;
}

/**
 * The races of the queue, each with its internal name and its external names. The internal name is the one written in
 * `renames` (lines "any external name = Internal name"), otherwise the core name. `grouped` can be passed when the
 * caller has already grouped the queue (queueByRace) so that it is not done twice.
 */
export function buildRaces(cube: Cube, aliases = "", renames = "", grouped?: RaceEditions[], linkStores: LinkStore[] = []): RaceRecord[] {
  const races = grouped ?? queueByRace(cube, aliases).races;
  const overrides = parseRaceAliases(renames).map(([external, internal]) => [normRaceName(external), internal] as [string, string]);
  const taken = new Set<string>();
  const slugs = new Set<string>();
  const out: RaceRecord[] = [];
  for (const r of races) {
    const eds = Object.values(r.editions);
    const newestEdition = eds.reduce<QueueLine | undefined>((a, b) => (!a || b.year > a.year ? b : a), undefined);
    const byName = new Map<string, number[]>();
    for (const e of eds) byName.set(e.name, [...(byName.get(e.name) ?? []), e.year]);
    const names: ExternalName[] = [...byName].map(([name, years]) => ({ name, years: years.sort((a, b) => a - b) })).sort((a, b) => a.years[0]! - b.years[0]!);
    const override = overrides.find(([k]) => names.some((n) => normRaceName(n.name) === k))?.[1];
    let name = override ?? cleanRaceName(coreName(names));
    for (let n = 2; taken.has(r.category + "|" + name.toLowerCase()); n++) name = name.replace(/ \([0-9]+\)$/, "") + " (" + n + ")";
    taken.add(r.category + "|" + name.toLowerCase());
    let slug = slugify(name) + (r.category === "WE" ? "-women" : "");
    for (let n = 2; slugs.has(slug); n++) slug = slug.replace(/-[0-9]+$/, "") + "-" + n;
    slugs.add(slug);
    out.push({ key: r.key, name, slug, category: r.category, names, years: eds.map((e) => e.year).sort((a, b) => a - b), uciIds: [...eds.map((e) => e.uciId), ...r.others], ...(newestEdition?.class ? { class: newestEdition.class } : {}), ...(newestEdition?.country ? { country: newestEdition.country } : {}), links: linksFor({ name, category: r.category, names }, ...linkStores) });
  }
  return out;
}

export interface JoinSuggestion {
  from: string; // a name of the race that would be joined (an alias line starts with it)
  into: string; // the race it would be joined into
  fromName: string; // as shown
  intoName: string;
  fromYears: number[];
  intoYears: number[];
  category: Category;
  class?: string;
  why: string[]; // what the two have in common, shown with the pair
}

/** Words that say nothing about which race it is: categories, languages' little words, and sponsors' joining words. */
const STOP_WORDS = new Set(
  ("men mens women womens woman ladies dames femmes feminin feminine femenina femminile donne vrouwen voor elite we me " +
    "the of de la le les il del della dell di du des van der den het and et y a avec by powered presented in to from op en d l da do " +
    "itt irr ttt") // the kind of race is checked on its own
    .split(" "),
);
/** Words many different races share: one of them alone does not make two names the same race. */
const COMMON_WORDS = new Set(
  ("tour grand prix gp classic classica classique trofeo trophy trophee coppa cup race course ronde circuit criterium memorial " +
    "omloop giro vuelta volta championships championship national road internazionale international internationale ciclistica " +
    "cycling cyclisme uci worldtour open festival championnats nationaux route campeonato campeonatos nacional nacionales ruta " +
    "juegos games ciclismo para")
    .split(" "),
);

/** The words of a race name that tell it apart: accents, case, little words and common words dropped. */
export function telltaleWords(name: string): Set<string> {
  const plain = cleanRaceName(name)
    .normalize("NFD")
    .replace(new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g"), "")
    .toLowerCase();
  // years and edition numbers (2023, XIX) change from edition to edition
  return new Set(plain.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^[0-9]+$/.test(w) && !/^[ivxlc]+$/.test(w) && !STOP_WORDS.has(w) && !COMMON_WORDS.has(w)));
}

/** The day of the season a race is usually held on (the middle of its editions' start days), when the dates are known. */
function usualDay(r: RaceEditions): number | undefined {
  const days = Object.values(r.editions)
    .map((e) => /^\d{4}-(\d\d)-(\d\d)/.exec(e.start))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => (+m[1]! - 1) * 30.5 + +m[2]!)
    .sort((a, b) => a - b);
  return days.length ? days[Math.floor(days.length / 2)] : undefined;
}

function newestEdition(r: RaceEditions): QueueLine {
  return Object.values(r.editions).reduce((a, b) => (b.year > a.year ? b : a));
}

/** What two races have in common besides their names, as shown with a suggested join. */
function alike(a: RaceEditions, b: RaceEditions): { sameWeek: boolean; sameClass: boolean; why: string[] } {
  const da = usualDay(a);
  const db = usualDay(b);
  const sameWeek = da !== undefined && db !== undefined && Math.abs(da - db) <= 7;
  const ca = newestEdition(a).class;
  const sameClass = !!ca && ca === newestEdition(b).class;
  const country = newestEdition(a).country;
  const why: string[] = [];
  if (sameWeek) why.push("same week of the season");
  if (sameClass) why.push("same class");
  if (country && country === newestEdition(b).country) why.push("same country");
  return { sameWeek, sameClass, why };
}

/**
 * Pairs that look like the same race under two names, in two passes, each pair with the years never overlapping:
 * 1. one cleaned name holds the other (a sponsor added or dropped), the shorter long enough to mean something;
 * 2. the names share their telltale words (see telltaleWords): one's words all in the other's, or two words in common,
 *    or one word in common for two races of the same class held in the same week.
 * Joins already made by `aliases` and pairs the user rejected (`nojoin`, in the alias line format) are left out.
 * Nothing is joined here: the user decides.
 */
export function suggestJoins(cube: Cube, aliases = "", nojoin = ""): JoinSuggestion[] {
  const map = groupQueue(cube);
  applyAliases(map, aliases);
  const rejected = new Set(parseRaceAliases(nojoin).map(([a, b]) => normRaceName(a) + ">" + normRaceName(b)));
  const out: JoinSuggestion[] = [];
  // one pass, shortest name first: a merge only adds years to the core race, and a pair blocked by a shared year stays
  // blocked, so nothing found later could have been found earlier. (Starting over after every merge took seconds.)
  const parts = [...map.keys()]
    .map((key) => {
      const i = key.lastIndexOf("|");
      return { key, base: key.slice(0, i), cat: key.slice(i + 1) };
    })
    .sort((x, y) => x.base.length - y.base.length);
  const gone = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    const A = parts[i]!;
    if (gone.has(A.key) || A.base.length < MIN_PREFIX) continue;
    for (let j = i + 1; j < parts.length; j++) {
      const B = parts[j]!;
      if (gone.has(B.key) || B.cat !== A.cat || B.base.length <= A.base.length || !B.base.includes(A.base)) continue;
      if (rejected.has(B.base + ">" + A.base) || rejected.has(A.base + ">" + B.base)) continue; // rejected lines read "sponsored name = core name" (or the other way, from an unjoin)
      if (raceKind(map.get(A.key)!.keyName) !== raceKind(map.get(B.key)!.keyName)) continue; // a time trial is not the road race of the same name
      const a = map.get(A.key)!;
      const b = map.get(B.key)!;
      const fromYears = Object.keys(b.editions).map(Number).sort((x, y) => x - y);
      const intoYears = Object.keys(a.editions).map(Number).sort((x, y) => x - y);
      const cls = a.editions[Math.max(...intoYears)]?.class; // the core race's newest class
      const fromName = b.name; // as shown before the join: after it the joined race carries one name
      const intoName = a.name;
      const { why } = alike(a, b);
      if (mergeEditions(b, a)) {
        gone.add(B.key);
        out.push({ from: b.keyName, into: a.keyName, fromName, intoName, fromYears, intoYears, category: a.category, ...(cls ? { class: cls } : {}), why: ["one name holds the other", ...why] });
      }
    }
  }

  // pass 2: shared telltale words. Only pairs that share a word are looked at, through an index of words.
  const left = [...map.values()].filter((r) => !gone.has(r.key));
  const words = new Map(left.map((r) => [r.key, telltaleWords(r.keyName)]));
  const byWord = new Map<string, RaceEditions[]>();
  for (const r of left) for (const w of words.get(r.key)!) byWord.set(w + "|" + r.category, [...(byWord.get(w + "|" + r.category) ?? []), r]);
  const seen = new Set<string>();
  const pairs: { a: RaceEditions; b: RaceEditions; strength: number; why: string[] }[] = [];
  for (const group of byWord.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i]!, group[j]!];
        const id = a.key < b.key ? a.key + ">" + b.key : b.key + ">" + a.key;
        if (seen.has(id)) continue;
        seen.add(id);
        if (Object.keys(a.editions).some((y) => y in b.editions)) continue;
        if (raceKind(a.keyName) !== raceKind(b.keyName)) continue;
        const wa = words.get(a.key)!;
        const wb = words.get(b.key)!;
        const shared = [...wa].filter((w) => wb.has(w)).length;
        const holds = shared === Math.min(wa.size, wb.size);
        const { sameWeek, sameClass, why } = alike(a, b);
        const strength = holds ? 3 : shared >= 2 ? 2 : sameWeek && sameClass ? 1 : 0;
        if (!strength) continue;
        pairs.push({ a, b, strength: strength + (sameWeek ? 1 : 0), why: [holds ? "one name has all the other's words" : "names share words", ...why] });
      }
    }
  }
  pairs.sort((x, y) => y.strength - x.strength);
  for (const { a, b, why } of pairs) {
    if (gone.has(a.key) || gone.has(b.key)) continue;
    // the race with the newest edition is the one the other continues as
    const newer = (r: RaceEditions) => Math.max(...Object.keys(r.editions).map(Number));
    const [from, into] = newer(a) >= newer(b) ? [b, a] : [a, b];
    const [nf, ni] = [normRaceName(from.keyName), normRaceName(into.keyName)];
    if (rejected.has(nf + ">" + ni) || rejected.has(ni + ">" + nf)) continue;
    const fromYears = Object.keys(from.editions).map(Number).sort((x, y) => x - y);
    const intoYears = Object.keys(into.editions).map(Number).sort((x, y) => x - y);
    const cls = into.editions[Math.max(...intoYears)]?.class;
    const fromName = from.name;
    const intoName = into.name;
    if (mergeEditions(from, into)) {
      gone.add(from.key);
      out.push({ from: from.keyName, into: into.keyName, fromName, intoName, fromYears, intoYears, category: into.category, ...(cls ? { class: cls } : {}), why });
    }
  }
  return out;
}

/**
 * Races the user ticked to be one race, as alias lines: each joins the race with the newest edition. Refused, with the
 * reason, when they are of different categories or kinds (a time trial and a road race), or two have the same year.
 */
export function joinByHand(races: RaceEditions[]): { lines: string[] } | { error: string } {
  if (races.length < 2) return { error: "Tick two or more races to join." };
  if (new Set(races.map((r) => r.category)).size > 1) return { error: "Not joined: men's and women's races stay apart." };
  if (new Set(races.map((r) => raceKind(r.keyName))).size > 1) return { error: "Not joined: a time trial and a road race are different races." };
  const seen = new Map<string, string>();
  for (const r of races) {
    for (const y of Object.keys(r.editions)) {
      if (seen.has(y)) return { error: "Not joined: " + seen.get(y) + " and " + r.name + " both have a " + y + " edition, so they are two races." };
      seen.set(y, r.name);
    }
  }
  const newest = (r: RaceEditions) => Math.max(...Object.keys(r.editions).map(Number));
  const into = races.reduce((a, b) => (newest(b) > newest(a) ? b : a));
  return { lines: chainLines(races.filter((r) => r !== into).map((r): [string, string] => [r.keyName, into.keyName])) };
}

/** The saved alias lines that name any of a race's names: the lines that joined it. */
export function joinLinesOf(aliases: string, names: string[]): string[] {
  const mine = new Set(names.map(normRaceName));
  return aliases.split(String.fromCharCode(10)).filter((line) => parseRaceAliases(line).some(([a, b]) => mine.has(normRaceName(a)) || mine.has(normRaceName(b))));
}

/**
 * Undo a race's joins: its alias lines go, and the pairs they joined are written to the rejected lines (`nojoin`) so the
 * review does not offer them again. Alias lines hold for men's and women's races alike.
 */
export function unjoinByHand(aliases: string, nojoin: string, names: string[]): { aliases: string; nojoin: string; removed: number } {
  const NL = String.fromCharCode(10);
  const lines = joinLinesOf(aliases, names);
  const rejected = lines.flatMap((l) => parseRaceAliases(l).map(([a, b]) => a + " = " + b));
  return {
    aliases: aliases.split(NL).filter((l) => !lines.includes(l)).join(NL),
    nojoin: [nojoin, ...rejected].filter((x) => x.trim() !== "").join(NL),
    removed: lines.length,
  };
}

export interface SeasonColumn {
  season: number;
  date: string; // the ranking used for this season (its latest one)
}

export interface SeasonLine {
  teamId: number;
  name: string;
  code: string;
  nation: string;
  points: (number | undefined)[]; // by column
  ranks: (number | undefined)[];
}

/**
 * Seasons side by side: for each season the latest ranking in the cube. Teams are matched by UCI team id,
 * so a team keeps its line through renames. A team missing from a captured ranking shows no number
 * (not zero): it was outside the captured part of that ranking, or it did not exist yet.
 */
export function seasonTable(
  cube: Cube,
  options: { seasons?: number[]; top?: number } = {},
): { columns: SeasonColumn[]; lines: SeasonLine[] } {
  const seasons = (options.seasons ?? [...new Set(cube.teamSnapshots.map((s) => s.season))]).sort((a, b) => a - b);
  const snaps = seasons
    .map((y) => cube.teamSnapshots.filter((s) => s.season === y).sort((a, b) => b.date.localeCompare(a.date))[0])
    .filter((s): s is TeamSnapshot => !!s);
  const columns = snaps.map((s) => ({ season: s.season, date: s.date }));
  const byId = new Map<number, SeasonLine>();
  snaps.forEach((s, i) => {
    for (const t of s.teams) {
      let l = byId.get(t.teamId);
      if (!l) {
        l = { teamId: t.teamId, name: t.name, code: t.code, nation: t.nation, points: snaps.map(() => undefined), ranks: snaps.map(() => undefined) };
        byId.set(t.teamId, l);
      }
      l.name = t.name; // later seasons come later in the loop: the newest name wins
      l.code = t.code;
      l.nation = t.nation;
      l.points[i] = t.points;
      l.ranks[i] = t.rank;
    }
  });
  const last = (l: SeasonLine) => {
    for (let i = l.points.length - 1; i >= 0; i--) if (l.points[i] !== undefined) return [i, l.points[i]!] as const;
    return [-1, -1] as const;
  };
  const lines = [...byId.values()].sort((a, b) => {
    const [ia, pa] = last(a);
    const [ib, pb] = last(b);
    return ib - ia || pb - pa; // teams in the newest season first, by points
  });
  return { columns, lines: options.top ? lines.slice(0, options.top) : lines };
}

export function seasonTableMarkdown(t: ReturnType<typeof seasonTable>): string {
  const nl = String.fromCharCode(10);
  const dm = (iso: string) => Number(iso.slice(8, 10)) + " " + MONTHS[Number(iso.slice(5, 7)) - 1];
  const head = "|Team|" + t.columns.map((c) => c.season + " (" + dm(c.date) + ")").join("|") + "|";
  const sep = "|:-|" + t.columns.map(() => "-:").join("|") + "|";
  const rows = t.lines.map(
    (l) =>
      "|" + l.name + " (" + l.code + ")|" +
      l.points.map((p, i) => (p === undefined ? "-" : num(p) + (l.ranks[i] ? " (#" + l.ranks[i] + ")" : ""))).join("|") + "|",
  );
  const note = "UCI World Ranking points of each season's latest ranking (date in brackets); rank in brackets after the points. A dash means the team is not in the captured part of that ranking.";
  return [head, sep, ...rows].join(nl) + nl + nl + note;
}

export interface MonthLine {
  teamId: number;
  name: string;
  code: string;
  /** points the team stood on at the end of each month of `year` (index 0 = January), undefined = no snapshot */
  total: (number | undefined)[];
  /** same for the year before */
  totalBefore: (number | undefined)[];
  /** points earned in each month (this month's total minus last month's); empty when last month's ranking is missing */
  gained: (number | undefined)[];
  gainedBefore: (number | undefined)[];
}

/** Month-end totals per team for two seasons, and what was gained during each month. */
export function monthlyOverview(cube: Cube, year: number, options: { top?: number } = {}): MonthLine[] {
  const monthEnd = (season: number): (TeamSnapshot | undefined)[] => {
    const out: (TeamSnapshot | undefined)[] = [];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      const last = new Date(Date.UTC(season, m, 0)).getUTCDate();
      out.push(snapshotAsOf(cube, season, season + "-" + mm + "-" + String(last).padStart(2, "0")));
    }
    // a month with no newer snapshot than the previous month's has no data of its own
    return out.map((s, i) => (s && i > 0 && out[i - 1] && s.date === out[i - 1]!.date ? undefined : s));
  };
  const cur = monthEnd(year);
  const prev = monthEnd(year - 1);
  const ids = new Map<number, { name: string; code: string }>();
  for (const s of [...prev, ...cur]) for (const t of s?.teams ?? []) ids.set(t.teamId, { name: t.name, code: t.code });
  const pointsOf = (s: TeamSnapshot | undefined, id: number): number | undefined =>
    s?.teams.find((t) => t.teamId === id)?.points;
  // Points earned in a month need the ranking at the end of the month before. If that one is
  // missing, the month stays empty rather than showing several months' points as one month.
  const gains = (totals: (number | undefined)[]): (number | undefined)[] =>
    totals.map((v, i) => {
      if (v === undefined) return undefined;
      if (i === 0) return v; // the season starts at zero
      const before = totals[i - 1];
      return before === undefined ? undefined : round(v - before);
    });
  const lines: MonthLine[] = [];
  for (const [id, info] of ids) {
    const total = cur.map((s) => pointsOf(s, id));
    const totalBefore = prev.map((s) => pointsOf(s, id));
    lines.push({ teamId: id, name: info.name, code: info.code, total, totalBefore, gained: gains(total), gainedBefore: gains(totalBefore) });
  }
  const latest = (l: MonthLine) => [...l.total].reverse().find((v) => v !== undefined) ?? -1;
  lines.sort((a, b) => latest(b) - latest(a));
  return options.top ? lines.slice(0, options.top) : lines;
}

// ---- markdown for the threads ----

function num(n: number | undefined): string {
  if (n === undefined) return "-";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function signed(n: number | undefined): string {
  if (n === undefined) return "-";
  return (n > 0 ? "+" : "") + num(n);
}

export function comparisonMarkdown(
  c: ReturnType<typeof compareToLastYear>,
  year: number,
  cutoff: string,
): string {
  const nl = String.fromCharCode(10);
  const head = "|Rank|Team|Nation|" + year + " (" + cutoff + ")|" + (year - 1) + " (same date)|Difference|";
  const sep = "|-:|:-|:-|-:|-:|-:|";
  const rows = c.lines.map(
    (l) => "|" + (l.rankNow ?? "-") + "|" + l.name + " (" + l.code + ")|" + l.nation + "|" + num(l.now) + "|" + num(l.before) + "|" + signed(l.diff) + "|",
  );
  const note =
    (c.now ? "Ranking of " + c.now.date : "No " + year + " ranking on or before " + cutoff) +
    ", compared with " + (c.before ? c.before.date : "no ranking") + ". UCI World Ranking points.";
  return [head, sep, ...rows].join(nl) + nl + nl + note;
}

export function monthlyMarkdown(lines: MonthLine[], year: number): string {
  const nl = String.fromCharCode(10);
  const monthsWithData = MONTHS.map((_, i) => lines.some((l) => l.total[i] !== undefined || l.totalBefore[i] !== undefined));
  const cols = MONTHS.map((m, i) => ({ m, i })).filter((c) => monthsWithData[c.i]);
  const head = "|Team|" + cols.map((c) => c.m).join("|") + "|";
  const sep = "|:-|" + cols.map(() => "-:").join("|") + "|";
  const rows: string[] = [];
  for (const l of lines) {
    const cell = (cur: number | undefined, prev: number | undefined) =>
      cur === undefined ? "-" : num(cur) + (prev === undefined ? "" : " (" + signed(round(cur - prev)) + ")");
    rows.push(
      "|" + l.name + " (" + l.code + ")|" +
        cols.map((c) => cell(l.gained[c.i], l.gainedBefore[c.i])).join("|") + "|",
    );
  }
  const note =
    "Points earned in each month of " + year + ", with the difference to the same month in " + (year - 1) +
    " in brackets. UCI World Ranking points, from the month-end rankings.";
  return [head, sep, ...rows].join(nl) + nl + nl + note;
}
