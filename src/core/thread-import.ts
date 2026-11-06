import { slugify } from "./ical";
import { InfoLink, InfoValue, Profile, RegistryRace } from "./types";

/** What was read from an old thread. */
export interface ParsedThread {
  year?: number;
  name?: string;
  category?: string; // ME / WE
  tag?: string; // as written in the title ("ME", "Men Elite", "")
  klass?: string; // 1.UWT, 2.UWT, ...
  kind: "race" | "stage" | "rest" | "unknown";
  stage?: number;
  rows: Record<string, InfoValue>; // by info-row id
  labels: Record<string, string>; // the label each row had in this thread ("Overall Previews")
  tableHeader: string[]; // column headers of the first table
  tableRow: string[]; // the first row of that table (the race or the stage), as written
  unknownLabels: string[];
}

// Row labels as written in different years -> info-row ids of the profile.
const LABELS: Record<string, string> = {
  information: "information",
  info: "information",
  previews: "previews",
  preview: "previews",
  "overall previews": "previews",
  "overall preview": "previews",
  "stage previews": "stagepreviews",
  "stage preview": "stagepreviews",
  "social media": "social",
  social: "social",
  "live tracker": "tracker",
  "live trackers": "tracker",
  livetracker: "tracker",
  livetrackers: "tracker",
  trackers: "tracker",
  "live ticker": "tracker",
  "live tickers": "tracker",
  liveticker: "tracker",
  livetickers: "tracker",
  "where to watch": "watch",
  tv: "watch",
  streams: "watch",
  "tv & streams": "watch",
  "tv and streams": "watch",
  coverage: "coverage",
  "live coverage": "coverage",
  "/r/peloton content": "content",
  "r/peloton content": "content",
};

const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;

function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** A row's cell: a list of links, or raw markdown when it has other text (e.g. "on HBO Max, ..."). */
export function parseCell(cell: string): InfoValue {
  const links: InfoLink[] = [];
  for (const m of cell.matchAll(LINK)) links.push({ text: cleanText(m[1]!), url: m[2]! });
  const rest = cell.replace(LINK, "").replace(/[\s/,.;&|\])\[(]+/g, "");
  if (links.length && rest === "") return links;
  return { md: cleanText(cell).replace(/(\s*\/)+\s*$/, "") };
}

function parseTitle(line: string): Partial<ParsedThread> {
  const out: Partial<ParsedThread> = { kind: "unknown" };
  let t = line.replace(/^#+\s*/, "").trim();
  t = t.replace(/^\[Race Thread\]\s*[-–]?\s*/i, "");
  const year = /^(\d{4})\s+/.exec(t);
  if (year) {
    out.year = +year[1]!;
    t = t.slice(year[0].length);
  }
  const stage = /\s*[–-]\s*Stage\s+(\d+)\b/i.exec(t);
  if (stage) {
    out.kind = "stage";
    out.stage = +stage[1]!;
    t = t.replace(stage[0], "");
  } else if (/\bRest Day\b/i.test(t)) {
    out.kind = "rest";
    t = t.replace(/\s*Rest Day\s*\d*/i, "");
  } else {
    out.kind = "race";
  }
  const cls = /\(([^)]*\d\.[A-Za-z0-9]+|WC)\)\s*$/.exec(t) ?? /\s(\d\.[A-Za-z0-9]+)\s*$/.exec(t);
  if (cls) {
    out.klass = cls[1];
    t = t.slice(0, cls.index).trim();
  }
  const tag = /\s+(ME|WE|MX|Men Elite|Women Elite)\s*$/i.exec(t);
  if (tag) {
    out.tag = tag[1];
    t = t.slice(0, tag.index).trim();
    out.category = /^(WE|Women)/i.test(tag[1]!) ? "WE" : /^MX/i.test(tag[1]!) ? "MX" : "ME";
  } else {
    out.tag = "";
    out.category = out.klass && /WWT/.test(out.klass) ? "WE" : "ME";
  }
  out.name = t.trim();
  return out;
}

/** Read an old r/peloton thread (markdown). Title line first, then the tables. */
export function parseOldThread(markdown: string): ParsedThread {
  const lines = markdown.split(/\r?\n/);
  const titleIdx = lines.findIndex((l) => /^\s*(#+\s*)?\[Race Thread\]/i.test(l) || /^\s*#+\s*\d{4}\s/.test(l));
  const head = titleIdx >= 0 ? parseTitle(lines[titleIdx]!) : { kind: "unknown" as const };
  const result: ParsedThread = {
    kind: head.kind ?? "unknown",
    rows: {},
    labels: {},
    tableHeader: [],
    tableRow: [],
    unknownLabels: [],
    ...head,
  };

  for (const raw of lines) {
    const l = raw.trim();
    if (!l.includes("|")) continue;
    // "|label|content|", with or without outer pipes; skip header and alignment rows
    const parts = l.replace(/^\|/, "").replace(/\|$/, "").split("|");
    if (parts.length < 2) continue;
    // "Information:" in some threads; "Outlet type | Links" is a header row (Paris-Nice 2024)
    const label = cleanText(parts[0]!).replace(/\s*:$/, "");
    if (!label || /^[:\-\s_]+$/.test(label) || /^outlet type$/i.test(label)) continue;
    // The first wide row is the header of the route/stage table.
    if (result.tableHeader.length === 0 && parts.length >= 4) {
      result.tableHeader = parts.map((c) => cleanText(c));
      continue;
    }
    // ... and the first wide row after it is the race or stage itself
    if (result.tableRow.length === 0 && parts.length >= 4) {
      result.tableRow = parts.map((c) => c.trim());
      continue;
    }
    const key = LABELS[label.toLowerCase()];
    if (key) result.labels[key] = label;
    if (!key) {
      if (!/^(date|from|stage|route)/i.test(label) && !/^\d/.test(label) && !/^(mon|tue|wed|thu|fri|sat|sun)/i.test(label)) {
        result.unknownLabels.push(label);
      }
      continue;
    }
    const cell = parts.slice(1).join("|").trim();
    if (!cell) continue;
    // two rows that mean the same ("Live ticker" and "Live Trackers") add up instead of replacing each other
    const v = parseCell(cell);
    const had = result.rows[key];
    result.rows[key] = Array.isArray(had) && Array.isArray(v) ? [...had, ...v] : v;
  }
  return result;
}

export interface ImportResult {
  id: string;
  entry: RegistryRace;
  /** Rows that belong to this year only (roadbook, previews, where to watch ...): not copied into the registry. */
  yearOnly: Record<string, InfoValue>;
  notes: string[];
}

const isLinks = (v: InfoValue | undefined): v is InfoLink[] => Array.isArray(v);

// Column headers written differently for the same thing (Tour 2024 "Elevation", Paris-Nice "Arrival time").
const HEADER_SAME: Record<string, string> = {
  elevation: "altitude",
  timing: "time",
  "arrival time": "time",
};

function sameHeader(a: string, b: string): boolean {
  const n = (s: string) => {
    const k = s.trim().toLowerCase();
    return HEADER_SAME[k] ?? k;
  };
  return n(a) === n(b);
}

/**
 * Turn a parsed thread into a race-registry entry: the homepage, Wikipedia page,
 * social accounts, FirstCycling id and PCS slug carry over every year; everything
 * that changes each year is returned separately.
 */
export function toRegistryEntry(p: ParsedThread, existing?: RegistryRace, profile?: Profile): ImportResult {
  const notes: string[] = [];
  const name = p.name ?? existing?.name ?? "";
  const category = p.category ?? existing?.category ?? "ME";
  const entry: RegistryRace = { ...(existing ?? {}), name, category };
  // Only a tag actually present in the old title is recorded; older titles often had none.
  if (p.tag) entry.titleTag = category;
  const yearOnly: Record<string, InfoValue> = {};

  if (profile) {
    // Row labels this race uses when they differ from the profile's ("Overall Previews").
    const defaults = new Map(profile.infoRows.map((r) => [r.id, r.label.toLowerCase()]));
    for (const [id, label] of Object.entries(p.labels)) {
      if (defaults.has(id) && defaults.get(id) !== label.toLowerCase()) {
        entry.labels = { ...(entry.labels ?? {}), [id]: label };
      }
    }
    // The table layout this race used, if it matches one of the profile's named variants.
    const kind = p.kind === "stage" ? "stage" : "oneday";
    const same = (cols: { header: string }[] | undefined) =>
      !!cols &&
      cols.length === p.tableHeader.length &&
      cols.every((c, i) => sameHeader(c.header, p.tableHeader[i] ?? ""));
    const variants = profile.tables.variants ?? {};
    const hit = Object.entries(variants).find(([, v]) => same(v[kind]));
    if (hit && !same(profile.tables[kind])) entry.table = hit[0];
    else if (!hit && p.tableHeader.length && !same(profile.tables[kind])) {
      notes.push("Table layout (" + p.tableHeader.join(" | ") + ") matches no known layout; set one up in the layout editor");
    }
  }

  const info = p.rows.information;
  const yearInfo: InfoLink[] = [];
  if (isLinks(info)) {
    for (const l of info) {
      const t = l.text.toLowerCase();
      const u = l.url ?? "";
      const fc = /firstcycling\.com\/race\.php\?([^#]*)/.exec(u);
      if (fc) {
        const q = new URLSearchParams(fc[1]);
        if (q.get("r")) entry.firstcycling = Number(q.get("r"));
        if (q.get("k") && q.get("k") !== "8") entry.firstcyclingClass = Number(q.get("k"));
      } else if (/wikipedia\.org/.test(u)) {
        entry.wikipedia = u;
      } else if (/^official( site)?$/.test(t)) {
        entry.officialSite = u;
      } else {
        // Roadbook, start list, stage info, route pages ...: some are tied to one edition, and a
        // link cannot tell us which. Keep them out of the registry and show them to the moderator.
        yearInfo.push(l);
      }
    }
  } else if (info) {
    notes.push("Information row has free text; kept as-is for this year only");
    yearOnly.information = info;
  }
  if (yearInfo.length) yearOnly.information = yearInfo;

  if (isLinks(p.rows.social)) entry.social = p.rows.social;
  else if (p.rows.social) notes.push("Social Media row has free text; not imported");

  const trackers = p.rows.tracker;
  if (isLinks(trackers)) {
    const rest: InfoLink[] = [];
    for (const l of trackers) {
      const m = /procyclingstats\.com\/race\/([^/]+)\/\d{4}\/result\/(?:live|today)/.exec(l.url ?? "");
      if (m) entry.pcs = m[1];
      else rest.push(l);
    }
    if (rest.length) yearOnly.tracker = rest;
  } else if (trackers) yearOnly.tracker = trackers;

  for (const k of ["previews", "stagepreviews", "content", "coverage", "watch"]) {
    if (p.rows[k]) yearOnly[k] = p.rows[k]!;
  }
  const id = slugify(name) + "-" + category.toLowerCase();
  if (p.unknownLabels.length) notes.push("Unknown rows ignored: " + p.unknownLabels.join(", "));
  return { id, entry, yearOnly, notes };
}
