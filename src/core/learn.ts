import { toPattern } from "./patterns";
import { ParsedThread, parseCell } from "./thread-import";
import { InfoLink, RegistryRace } from "./types";

/**
 * Learning a race's lasting links from its threads of two or more years (thread analysis
 * 2026-11-06, card 3). A link that is the same in two years goes to the registry as it is; one
 * that differs only by year or stage number goes in as a pattern ({year}, {stage}, ...). Links
 * seen in one year only stay out: they may belong to that edition alone.
 */

export interface Learned {
  links: { row: string; text: string; url: string; years: number[]; kind: "stable" | "pattern" }[];
  cells: { field: "stage" | "route" | "type" | "finish"; url: string; years: number[] }[];
}

const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;

// Links the importer already files elsewhere (homepage, Wikipedia, FirstCycling and PCS ids, socials).
function handledElsewhere(row: string, l: InfoLink): boolean {
  const u = l.url ?? "";
  if (row === "social" || row === "content") return true; // socials have their own list; r/peloton posts are new each year
  return (
    /timebie\.com|timeanddate\.com\/worldclock/.test(u) || // time links: the builder makes them from the start time
    /firstcycling\.com\/race\.php\?/.test(u) ||
    /wikipedia\.org/.test(u) ||
    /procyclingstats\.com\/race\/[^/]+\/\d{4}\/result\/(live|today)/.test(u) ||
    (row === "information" && /^official( site| website)?$/i.test(l.text.trim()))
  );
}

function linksOf(v: ReturnType<typeof parseCell>): InfoLink[] {
  if (Array.isArray(v)) return v;
  return [...v.md.matchAll(LINK)].map((m) => ({ text: m[1]!.trim(), url: m[2]! }));
}

/** Which table column a header means, for the cells that carry a link. */
function cellField(header: string): Learned["cells"][number]["field"] | undefined {
  const h = header.trim().toLowerCase();
  if (h === "stage") return "stage";
  if (h === "route" || h.startsWith("from")) return "route";
  if (h === "type" || h === "profile") return "type";
  if (h === "finish") return "finish";
  return undefined;
}

const norm = (u: string) => u.trim().replace(/^http:/, "https:").replace("://www.", "://").replace(/\/+$/, "").toLowerCase();

interface Group {
  row: string;
  url: string; // the pattern (or the address) as first seen
  raws: Set<string>;
  years: Set<number>;
  texts: Map<string, number>;
}

/** What the threads (of one race, several years) have in common. Threads without a year are skipped. */
export function learnFromYears(threads: ParsedThread[]): Learned {
  const groups = new Map<string, Group>();
  const cells = new Map<string, Group>();
  const add = (map: Map<string, Group>, row: string, text: string, url: string, year: number, stage: number | undefined) => {
    const pattern = toPattern(url, { year, stage });
    const key = row + " " + norm(pattern);
    let g = map.get(key);
    if (!g) map.set(key, (g = { row, url: pattern, raws: new Set(), years: new Set(), texts: new Map() }));
    g.raws.add(norm(url));
    g.years.add(year);
    g.texts.set(text, (g.texts.get(text) ?? 0) + 1);
  };

  for (const t of threads) {
    if (t.year === undefined) continue;
    // The info rows are the same in every stage thread of an edition, so a number in their links is
    // never the stage ("inrng.com/2023/06/..." in the stage-6 thread is June): no {stage} there.
    for (const [row, v] of Object.entries(t.rows)) {
      for (const l of linksOf(v)) if (l.url && !handledElsewhere(row, l)) add(groups, row, l.text, l.url, t.year, undefined);
    }
    t.tableHeader.forEach((h, i) => {
      const field = cellField(h);
      const cell = t.tableRow[i];
      if (!field || !cell) return;
      for (const m of cell.matchAll(LINK)) add(cells, field, "", m[2]!, t.year!, t.stage);
    });
  }

  const commonText = (g: Group) => [...g.texts].sort((a, b) => b[1] - a[1])[0]![0];
  const out: Learned = { links: [], cells: [] };
  for (const g of groups.values()) {
    if (g.years.size < 2) continue;
    const kind = g.raws.size === 1 ? "stable" : "pattern";
    if (kind === "pattern" && !g.url.includes("{")) continue;
    out.links.push({ row: g.row, text: commonText(g), url: g.url, years: [...g.years].sort(), kind });
  }
  for (const g of cells.values()) {
    // a cell link is only worth a pattern when it follows the stage or year
    if (g.years.size < 2 || !g.url.includes("{")) continue;
    const field = g.row as Learned["cells"][number]["field"];
    if (out.cells.some((c) => c.field === field)) continue;
    out.cells.push({ field, url: g.url, years: [...g.years].sort() });
  }
  return out;
}

/** Last year's links that belong to that edition only: to be replaced (or dropped) for the new one. */
export interface LastYearHints {
  year: number;
  rows: { row: string; links: InfoLink[]; md?: string }[];
}

/**
 * The year-specific part of the newest edition among these threads (roadbook, previews, TV ...),
 * as hints for drafting the next one (card 1). In a stage race only what most of that year's
 * stage threads share counts; a link in one stage thread belongs to that stage.
 */
export function lastYearHints(threads: ParsedThread[], learned?: Learned): LastYearHints | undefined {
  const years = threads.map((t) => t.year).filter((y): y is number => y !== undefined);
  if (!years.length) return undefined;
  const year = Math.max(...years);
  const last = threads.filter((t) => t.year === year);
  const lasting = new Set((learned?.links ?? []).map((l) => l.row + " " + norm(toPattern(l.url, { year }))));
  const rows = new Map<string, { counts: Map<string, { link: InfoLink; n: number }>; md: Map<string, number> }>();
  for (const t of last) {
    for (const [row, v] of Object.entries(t.rows)) {
      if (row === "social") continue;
      let r = rows.get(row);
      if (!r) rows.set(row, (r = { counts: new Map(), md: new Map() }));
      if (!Array.isArray(v)) r.md.set(v.md, (r.md.get(v.md) ?? 0) + 1);
      for (const l of linksOf(v)) {
        // the r/peloton posts (pre-race thread, cheat notes ...) are new each year: exactly what to replace
        if (!l.url || (row !== "content" && handledElsewhere(row, l)) || lasting.has(row + " " + norm(toPattern(l.url, { year })))) continue;
        const k = norm(l.url);
        const c = r.counts.get(k);
        if (c) c.n++;
        else r.counts.set(k, { link: l, n: 1 });
      }
    }
  }
  const half = last.length / 2;
  const out: LastYearHints = { year, rows: [] };
  for (const [row, r] of rows) {
    const links = [...r.counts.values()].filter((c) => c.n > half || last.length === 1).map((c) => c.link);
    const md = [...r.md].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (links.length || md) out.rows.push({ row, links, ...(md && !links.length ? { md } : {}) });
  }
  return out;
}

/** Put what was learned into a registry entry; returns lines saying what was added. */
export function applyLearned(entry: RegistryRace, learned: Learned): string[] {
  const said: string[] = [];
  const links = [...(entry.links ?? [])];
  for (const l of learned.links) {
    if (links.some((x) => x.row === l.row && norm(x.url) === norm(l.url))) continue;
    links.push({ row: l.row, text: l.text, url: l.url });
    said.push(l.row + ": " + l.text + " " + l.url + " (" + l.kind + ", seen in " + l.years.join(", ") + ")");
  }
  if (links.length) entry.links = links;
  for (const c of learned.cells) {
    if (entry.cells?.[c.field]) continue;
    entry.cells = { ...(entry.cells ?? {}), [c.field]: c.url };
    said.push("stage table " + c.field + ": " + c.url + " (seen in " + c.years.join(", ") + ")");
  }
  return said;
}
