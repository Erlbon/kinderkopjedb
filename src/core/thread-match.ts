import { addDays } from "./dates";
import { parseOldThread } from "./thread-import";

/**
 * Finding the old race threads of a subreddit: one race edition (dates from the
 * KinderkopjeDB file) against the posts a Reddit search returned.
 */

/** One race in one year, as the database knows it. */
export interface Edition {
  name: string; // the internal name
  /** Other names the race goes by, r/peloton's own first ("Tour of Flanders" for Ronde van Vlaanderen). */
  aliases?: string[];
  year: number;
  class: string; // 1.UWT, 2.UWT ...
  category?: string; // ME (default) or WE
  start: string; // ISO date
  end: string;
  stages?: { n: number; date: string }[]; // empty or missing = one-day race; a prologue is stage 0
}

/** A post as the search returned it (only what matching needs). */
export interface FoundPost {
  id: string;
  title: string;
  createdAt: string; // ISO date-time, UTC
  permalink: string;
  author?: string;
  body?: string;
}

export interface MatchedThread {
  kind: ThreadTitleKind;
  stage?: number;
  post: FoundPost;
}

export interface EditionMatch {
  threads: MatchedThread[];
  /** Stage numbers with no thread found (stage races only). */
  missingStages: number[];
  /** One-day race with no thread found. */
  missingRace: boolean;
  /** Race threads with this race's name and year that fell outside the dates; shown, not used. */
  outsideDates: FoundPost[];
  /** Every other race-thread title the search returned (no body): shows why a race was missed. */
  otherTitles: { title: string; createdAt: string; permalink: string }[];
}

/** "race" = a one-day race or the overall thread of a stage race; "presentation" = the team presentation. */
export type ThreadTitleKind = "race" | "stage" | "rest" | "presentation";

const DAYS_BEFORE = 2; // threads go up the day before, sometimes earlier
const DAYS_AFTER = 1; // time zones: a US evening post is the next day in UTC

// Combining accents U+0300-U+036F, built from char codes so no escape can get lost in an edit.
const ACCENTS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");

/** Lower case, no accents, words only: "Liège–Bastogne–Liège" -> "liege bastogne liege". */
export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(ACCENTS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function names(e: Edition): string[] {
  return [...(e.aliases ?? []), e.name].map(normName).filter((n) => n !== "");
}

/** The searches to run for one edition: one per name, most likely first. */
export function editionQueries(e: Edition): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of [...(e.aliases ?? []), e.name]) {
    const q = '"' + n.replace(/"/g, "") + '" ' + e.year;
    if (!seen.has(q.toLowerCase())) {
      seen.add(q.toLowerCase());
      out.push(q);
    }
  }
  return out;
}

/** Does a title's race name mean this edition? Either name may be the longer one ("Tour de France" / "Le Tour de France"). */
function sameRace(titleName: string, e: Edition): boolean {
  const t = normName(titleName);
  if (!t) return false;
  // a very short title name ("Tour") must not match every race that contains it
  return names(e).some((n) => t === n || t.includes(n) || (t.length >= 6 && n.includes(t)));
}

/**
 * Kind, year, race name and stage of a race-thread title. Builds on the old-thread reader and
 * also takes titles it does not expect: the year after the name, "Stage 6" without a dash.
 */
export function readTitle(
  title: string,
): { kind: ThreadTitleKind; year?: number; name: string; stage?: number; category: string } | undefined {
  if (!/\[race thread\]/i.test(title)) return undefined;
  const t = parseOldThread(title);
  if (t.kind === "unknown") return undefined;
  // "Tour de France Femmes" is a race of its own, not the men's Tour with a longer name
  const women = t.category === "WE" || /\b(women|womens|femmes|feminin|feminina|donne|dames|ladies|vrouwen)\b/i.test(normName(title));
  const category = women ? "WE" : "ME";
  let name = t.name ?? "";
  let year = t.year;
  let kind: ThreadTitleKind = t.kind;
  let stage = t.stage;
  if (year === undefined) {
    const y = /\b(20\d\d)\b/.exec(name);
    if (y) {
      year = +y[1]!;
      name = name.replace(y[0], " ");
    }
  }
  if (kind === "race") {
    // "Stage 6" without a dash, or a prologue (stage 0, as the database numbers it)
    const s = /[\s,:–-]*\b(?:Stage\s+(\d+)|Prologue)\b/i.exec(name);
    const tp = /[\s,:–-]*\bTeam Presentation\b/i.exec(name);
    if (tp) {
      kind = "presentation";
      name = name.replace(tp[0], " ");
    } else if (s) {
      kind = "stage";
      stage = s[1] === undefined ? 0 : +s[1];
      name = name.replace(s[0], " ");
    }
  }
  return { kind, year, name: name.replace(/\s+/g, " ").trim(), stage, category };
}

/** Match the posts of a search against one edition. Each post is used once; the first in date order wins. */
export function matchEdition(e: Edition, posts: FoundPost[]): EditionMatch {
  const from = addDays(e.start, -DAYS_BEFORE);
  const to = addDays(e.end, DAYS_AFTER);
  const stageRace = !!e.stages?.length;
  const threads: MatchedThread[] = [];
  const outsideDates: FoundPost[] = [];
  const otherTitles: EditionMatch["otherTitles"] = [];
  const seen = new Set<string>();
  const taken = new Set<string>(); // "race", "stage-6", "rest-2026-07-13"

  const sorted = [...posts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const p of sorted) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const t = readTitle(p.title);
    // some titles have no year ("[Race Thread] Paris-Nice - Stage 1", 2025): the post date stands in, the date check below confirms it
    const year = t?.year ?? +p.createdAt.slice(0, 4);
    if (!t || year !== e.year || t.category !== (e.category ?? "ME") || !sameRace(t.name, e)) {
      if (/race thread/i.test(p.title)) otherTitles.push({ title: p.title, createdAt: p.createdAt, permalink: p.permalink });
      continue;
    }
    const day = p.createdAt.slice(0, 10);
    if (day < from || day > to) {
      outsideDates.push(p);
      continue;
    }
    if (t.kind === "stage") {
      if (!stageRace || t.stage === undefined) continue;
      const st = e.stages!.find((s) => s.n === t.stage);
      // a stage thread goes up up to two days before its stage
      if (!st || day < addDays(st.date, -DAYS_BEFORE) || day > addDays(st.date, DAYS_AFTER)) {
        outsideDates.push(p);
        continue;
      }
      const key = "stage-" + t.stage;
      if (taken.has(key)) continue;
      taken.add(key);
      threads.push({ kind: "stage", stage: t.stage, post: p });
    } else if (t.kind === "rest") {
      const key = "rest-" + day;
      if (taken.has(key)) continue;
      taken.add(key);
      threads.push({ kind: "rest", post: p });
    } else if (t.kind === "presentation") {
      if (taken.has("presentation")) continue;
      taken.add("presentation");
      threads.push({ kind: "presentation", post: p });
    } else {
      // "race": a one-day race, or the overall thread of a stage race
      if (taken.has("race")) continue;
      taken.add("race");
      threads.push({ kind: "race", post: p });
    }
  }

  const found = new Set(threads.filter((m) => m.kind === "stage").map((m) => m.stage));
  const missingStages = stageRace ? e.stages!.map((s) => s.n).filter((n) => !found.has(n)) : [];
  const missingRace = !stageRace && !taken.has("race");
  threads.sort((a, b) => a.post.createdAt.localeCompare(b.post.createdAt));
  return { threads, missingStages, missingRace, outsideDates, otherTitles };
}
