import { Stage } from "./types";

/**
 * Wikipedia stage-table reader. Edition pages of stage races (for example
 * "2026 Tour de France") carry a "Stage characteristics" table with stage,
 * date, course, distance, type and the rest days. Values are DRAFTS: Wikipedia
 * is a secondary source, so the moderator checks them before posting.
 */

const NL = String.fromCharCode(10);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export interface StageDraft {
  stages: Stage[];
  restDays: string[];
}

/** Wikipedia's stage types in our short vocabulary (editable afterwards). */
const TYPE_MAP: Record<string, string> = {
  "flat stage": "flat",
  "hilly stage": "hilly",
  "medium mountain stage": "medium mountain",
  "mountain stage": "mountain",
  "high mountain stage": "mountain",
  "team time trial": "TTT",
  "individual time trial": "ITT",
  "time trial": "ITT",
  prologue: "prologue",
};

function clean(raw: string): string {
  let t = raw;
  t = t.replace(/<ref[^>]*\/>/g, "");
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
  t = t.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "");
  t = t.replace(/\{\{\s*convert\s*\|\s*([\d.,]+)[^}]*\}\}/gi, "$1");
  t = t.replace(/\{\{[^}]*\}\}/g, "");
  t = t.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1");
  t = t.replace(/\[\[([^\]]*)\]\]/g, "$1");
  t = t.replace(/'{2,}/g, "");
  t = t.replace(/<[^>]+>/g, "");
  return t.replace(/\s+/g, " ").trim();
}

function parseDate(text: string, year: number): string | undefined {
  const m = /^(\d{1,2})\s+([A-Za-z]+)/.exec(text);
  if (!m) return undefined;
  const mi = MONTHS.indexOf(m[2]!.toLowerCase());
  if (mi < 0) return undefined;
  return year + "-" + String(mi + 1).padStart(2, "0") + "-" + m[1]!.padStart(2, "0");
}

function dropParens(s: string): string {
  return s.replace(/\s*\([^)]*\)/g, "").trim();
}

function parseCourse(text: string): { from: string; to: string } {
  const c = text.trim();
  const i = c.indexOf(" to ");
  if (i < 0) {
    const place = dropParens(c);
    return { from: place, to: place };
  }
  return { from: dropParens(c.slice(0, i)), to: dropParens(c.slice(i + 4)) };
}

function roundKm(n: number): number {
  return n >= 50 ? Math.round(n) : Math.round(n * 10) / 10;
}

/** Split one wikitable row into its cell texts (attributes stripped, markup cleaned). */
function cells(rowLines: string[]): string[] {
  const out: string[] = [];
  for (const line of rowLines) {
    if (!(line.startsWith("|") || line.startsWith("!")) || line.startsWith("|}") || line.startsWith("|+")) continue;
    let body = line.slice(1);
    body = body.replace(/^\s*(?:[a-z-]+="[^"]*"\s*)+\|(?!\|)/i, "");
    out.push(clean(body));
  }
  return out;
}

/**
 * Find the stage table in a page's wikitext and read it.
 * Rows with the words "Rest day" become restDays; rows with a stage number become stages.
 */
export function parseStageTable(wikitext: string, year: number): StageDraft {
  const start = wikitext.search(/\{\|[^\n]*wikitable[^\n]*\n\|\+\s*Stage characteristics/i);
  const draft: StageDraft = { stages: [], restDays: [] };
  if (start < 0) return draft;
  const end = wikitext.indexOf(NL + "|}", start);
  const table = wikitext.slice(start, end < 0 ? undefined : end);
  const rows = table.split(NL + "|-").slice(1);

  for (const row of rows) {
    const cs = cells(row.split(NL));
    if (cs.length < 3) continue;
    const joined = cs.join(" ");
    const date = parseDate(cs[1] ?? "", year);
    if (!date) continue;
    if (/rest day/i.test(joined)) {
      draft.restDays.push(date);
      continue;
    }
    const n = parseInt(cs[0] ?? "", 10);
    if (Number.isNaN(n)) continue;
    const { from, to } = parseCourse(cs[2] ?? "");
    const km = parseFloat((cs[3] ?? "").replace(",", "."));
    const typeText = (cs.find((c, i) => i >= 4 && TYPE_MAP[c.toLowerCase()] !== undefined) ?? "").toLowerCase();
    const stage: Stage = { n, date, from, to };
    if (!Number.isNaN(km)) stage.length = roundKm(km);
    const type = TYPE_MAP[typeText];
    if (type) stage.type = type;
    draft.stages.push(stage);
  }
  return draft;
}

// ---- network helpers (browser or node; Wikimedia APIs allow cross-origin with origin=*) ----

export interface WikidataRace {
  id: string;
  label: string;
  description: string;
  officialSite?: string;
  wikipedia?: string;
  social: { text: string; url: string }[]; // accounts Wikidata knows about
}

// Wikidata property -> social platform. Values are account names/ids, turned into URLs below.
const SOCIAL: { prop: string; text: string; url: (v: string) => string }[] = [
  { prop: "P2003", text: "Instagram", url: (v) => "https://www.instagram.com/" + v + "/" },
  { prop: "P2013", text: "Facebook", url: (v) => "https://www.facebook.com/" + v },
  { prop: "P2002", text: "X", url: (v) => "https://x.com/" + v },
  { prop: "P2397", text: "YouTube", url: (v) => "https://www.youtube.com/channel/" + v },
  { prop: "P7085", text: "TikTok", url: (v) => "https://www.tiktok.com/@" + v },
];

const API = "https://en.wikipedia.org/w/api.php";
const WD = "https://www.wikidata.org/w/api.php";
const HEADERS = { "Api-User-Agent": "KinderkopjeDB/0.1 (r/peloton moderator tool; github.com/Erlbon/kinderkopjedb)" };

export async function fetchWikitext(title: string, f: typeof fetch = fetch): Promise<string> {
  const url = API + "?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&origin=*&page=" + encodeURIComponent(title);
  const r = await f(url, { headers: HEADERS });
  if (!r.ok) throw new Error("Wikipedia answered " + r.status);
  const j = (await r.json()) as { parse?: { wikitext?: string }; error?: { info?: string } };
  if (!j.parse?.wikitext) throw new Error(j.error?.info ?? "page not found: " + title);
  return j.parse.wikitext;
}

export interface WikiSection {
  index: string;
  line: string;
}

/** The section headings of a page (cheap: used to find the section for a given year). */
export async function fetchSectionList(title: string, f: typeof fetch = fetch): Promise<WikiSection[]> {
  const url = API + "?action=parse&prop=sections&format=json&formatversion=2&redirects=1&origin=*&page=" + encodeURIComponent(title);
  const r = await f(url, { headers: HEADERS });
  if (!r.ok) throw new Error("Wikipedia answered " + r.status);
  const j = (await r.json()) as { parse?: { sections?: WikiSection[] }; error?: { info?: string } };
  if (!j.parse?.sections) throw new Error(j.error?.info ?? "page not found: " + title);
  return j.parse.sections;
}

/** The wikitext of one section of a page. */
export async function fetchSection(title: string, index: string, f: typeof fetch = fetch): Promise<string> {
  const url =
    API + "?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&origin=*&section=" + encodeURIComponent(index) +
    "&page=" + encodeURIComponent(title);
  const r = await f(url, { headers: HEADERS });
  if (!r.ok) throw new Error("Wikipedia answered " + r.status);
  const j = (await r.json()) as { parse?: { wikitext?: string }; error?: { info?: string } };
  if (!j.parse?.wikitext) throw new Error(j.error?.info ?? "section not found: " + title + " " + index);
  return j.parse.wikitext;
}

/** Look a race up on Wikidata: official website (P856) and the English Wikipedia page. */
export async function lookupRace(name: string, f: typeof fetch = fetch): Promise<WikidataRace[]> {
  const s = await f(
    WD + "?action=wbsearchentities&language=en&type=item&limit=10&format=json&origin=*&search=" + encodeURIComponent(name),
    { headers: HEADERS },
  );
  const found = ((await s.json()) as { search?: { id: string; label?: string; description?: string }[] }).search ?? [];
  if (!found.length) return [];
  const ids = found.map((x) => x.id).join("|");
  const e = await f(
    WD + "?action=wbgetentities&props=claims|sitelinks/urls&format=json&origin=*&ids=" + ids,
    { headers: HEADERS },
  );
  type Ent = { claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>; sitelinks?: { enwiki?: { url?: string } } };
  const ents = ((await e.json()) as { entities?: Record<string, Ent> }).entities ?? {};
  return found.map((x) => {
    const ent = ents[x.id];
    const site = ent?.claims?.P856?.[0]?.mainsnak?.datavalue?.value;
    const social: WikidataRace["social"] = [];
    for (const s of SOCIAL) {
      const v = ent?.claims?.[s.prop]?.[0]?.mainsnak?.datavalue?.value;
      if (typeof v === "string" && v) social.push({ text: s.text, url: s.url(v) });
    }
    return {
      social,
      id: x.id,
      label: x.label ?? "",
      description: x.description ?? "",
      officialSite: typeof site === "string" ? site : undefined,
      wikipedia: ent?.sitelinks?.enwiki?.url,
    };
  });
}
