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
  stage?: number; // as the database numbers it
  post: FoundPost;
  /** Why this match needed a second look: a wrong year in the title, a prologue that shifts the stage numbers. */
  note?: string;
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
  otherTitles: { id: string; title: string; createdAt: string; permalink: string }[];
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

/** At most one letter added, dropped or changed ("wallone" / "wallonne", "volte" / "volta"). */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  // skip the one difference in the longer word (or both, for a changed letter), the rest must be equal
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}

/**
 * Does a title's race name mean this edition? Either name may be the longer one ("Tour de France" /
 * "Le Tour de France"), and a title may leave a word out or have a typo ("Volta Catalunya",
 * "Fleche Wallone", "BEMER Cyclassic Hamburg"): every word of the shorter name (two words or more)
 * must be in the longer one, words of five letters or more allowing one wrong letter.
 */
function sameRace(titleName: string, e: Edition): boolean {
  const t = normName(titleName);
  if (!t) return false;
  return names(e).some((n) => {
    // a very short title name ("Tour") must not match every race that contains it
    if (t === n || t.includes(n) || (t.length >= 6 && n.includes(t))) return true;
    const [short, long] = t.split(" ").length <= n.split(" ").length ? [t, n] : [n, t];
    const sw = short.split(" ");
    const lw = long.split(" ");
    if (sw.length < 2) return false;
    return sw.every((w) => lw.some((l) => w === l || (w.length >= 5 && l.length >= 5 && oneEditApart(w, l))));
  });
}

/**
 * Kind, year, race name and stage of a race-thread title. Builds on the old-thread reader and
 * also takes titles it does not expect: the year after the name, "Stage 6" without a dash.
 */
export function readTitle(
  title: string,
): { kind: ThreadTitleKind; year?: number; name: string; stage?: number; category: string } | undefined {
  // "[Race Thread 2024 Tour de Suisse ..." (a bracket left out) is read as if it were there
  const tag = /^\s*\[?\s*race thread\s*\]?\s*/i.exec(title);
  if (!tag) return undefined;
  title = "[Race Thread] " + title.slice(tag[0].length);
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
  // "2023 Fleche Wallone Men": the category word is not part of the race name
  name = name.replace(/\b(men|men's|mens|elite)\b/gi, " ");
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
  const inDates = (p: FoundPost) => p.createdAt.slice(0, 10) >= from && p.createdAt.slice(0, 10) <= to;
  // This race's threads: the name fits, and the year fits, or the post date does: some titles have no
  // year (Paris-Nice 2025) and some have last year's ("2025 Giro d'Italia - Stage 17", posted in 2026).
  const ours = (p: FoundPost, t: ReturnType<typeof readTitle>): t is NonNullable<ReturnType<typeof readTitle>> =>
    !!t && t.category === (e.category ?? "ME") && sameRace(t.name, e) && ((t.year ?? +p.createdAt.slice(0, 4)) === e.year || inDates(p));
  // UCI numbers a prologue as stage 1 in some races (Romandie, Suisse); the threads say Prologue, Stage 1 ...
  const shift =
    stageRace && !e.stages!.some((s) => s.n === 0) && sorted.some((p) => {
      const t = readTitle(p.title);
      return ours(p, t) && inDates(p) && t.kind === "stage" && t.stage === 0;
    })
      ? 1
      : 0;
  for (const p of sorted) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const t = readTitle(p.title);
    if (!ours(p, t)) {
      if (/race thread/i.test(p.title)) otherTitles.push({ id: p.id, title: p.title, createdAt: p.createdAt, permalink: p.permalink });
      continue;
    }
    const day = p.createdAt.slice(0, 10);
    if (day < from || day > to) {
      outsideDates.push(p);
      continue;
    }
    const note = t.year !== undefined && t.year !== e.year ? "the title says " + t.year : undefined;
    if (t.kind === "stage") {
      if (!stageRace || t.stage === undefined) continue;
      const n = t.stage + shift;
      const st = e.stages!.find((s) => s.n === n);
      // a stage thread goes up up to two days before its stage
      if (!st || day < addDays(st.date, -DAYS_BEFORE) || day > addDays(st.date, DAYS_AFTER)) {
        outsideDates.push(p);
        continue;
      }
      const key = "stage-" + n;
      if (taken.has(key)) continue;
      taken.add(key);
      const notes = [note, shift ? "prologue counted as stage 1" : undefined].filter(Boolean).join("; ");
      threads.push({ kind: "stage", stage: n, post: p, ...(notes ? { note: notes } : {}) });
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
      threads.push({ kind: "race", post: p, ...(note ? { note } : {}) });
    }
  }

  const found = new Set(threads.filter((m) => m.kind === "stage").map((m) => m.stage));
  const missingStages = stageRace ? e.stages!.map((s) => s.n).filter((n) => !found.has(n)) : [];
  const missingRace = !stageRace && !taken.has("race");
  threads.sort((a, b) => a.post.createdAt.localeCompare(b.post.createdAt));
  return { threads, missingStages, missingRace, outsideDates, otherTitles };
}
