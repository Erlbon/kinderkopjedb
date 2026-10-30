import type { Database } from "sql.js";
import { openDatabase } from "./cube-db";

/** Where people can ask for something to be removed from the public dataset. */
export const TAKEDOWN_URL = "https://github.com/Erlbon/kinderkopjedb/issues";

export const PUBLIC_CREDITS =
  "Rankings and race results are published by the Union Cycliste Internationale (UCI) on uci.org and dataride.uci.ch; team levels come from Wikipedia (CC BY-SA 4.0); the links of a race (official site, Wikipedia, social media) come from Wikidata (CC0) after a person checked the match, from the race registry, or were typed in. " +
  "Only names, nations, rider ages (as DataRide shows them at the race), places, points, team names, race names and race facts are included: no layout, no photos. " +
  "To have something removed, open an issue at " + TAKEDOWN_URL + ".";

export const BETA_NOTE =
  "BETA: this holds what has been collected so far, not every race. Men's elite is collected first. Races that changed their name are joined by hand, so a few may still be split.";

/**
 * A copy of the database that is safe to publish: only the ranking and result tables, with the private parts
 * (saved texts, the capture queue, who captured a race and when) emptied and the file rewritten so that
 * nothing of them stays in unused pages. It keeps the schema, so any copy opens like a normal KinderkopjeDB file.
 */
export function makePublicCopy(SQL: { Database: new (data?: ArrayLike<number>) => Database }, db: Database, note = ""): Uint8Array {
  const copy = openDatabase(SQL, db.export());
  try {
    copy.exec("DELETE FROM kv; DELETE FROM queue_race; UPDATE race_result SET contributor = NULL, captured_at = NULL;");
    // only the races that have results: a race that is only in the capture queue is left out, with its names
    copy.exec("DELETE FROM race_link WHERE race_id NOT IN (SELECT race_id FROM race_result WHERE race_id IS NOT NULL); DELETE FROM race_name WHERE race_id NOT IN (SELECT race_id FROM race_result WHERE race_id IS NOT NULL); DELETE FROM race WHERE race_id NOT IN (SELECT race_id FROM race_result WHERE race_id IS NOT NULL);");
    copy.run("INSERT OR REPLACE INTO meta(key, value) VALUES ('public', '1')");
    copy.run("INSERT OR REPLACE INTO meta(key, value) VALUES ('credits', ?)", [PUBLIC_CREDITS]);
    copy.run("INSERT OR REPLACE INTO meta(key, value) VALUES ('made', ?)", [new Date().toISOString().slice(0, 10)]);
    // what the file holds, so a visitor can see how much there is before asking it anything
    copy.run("INSERT OR REPLACE INTO meta(key, value) VALUES ('beta', '1')");
    copy.run("INSERT OR REPLACE INTO meta(key, value) VALUES ('beta_note', ?)", [BETA_NOTE + (note ? " " + note : "")]);
    const count = (sql: string) => String(copy.exec(sql)[0]?.values[0]?.[0] ?? "");
    for (const [key, sql] of Object.entries({
      races: "SELECT COUNT(*) FROM race",
      editions: "SELECT COUNT(*) FROM race_result",
      results: "SELECT COUNT(*) FROM result_row",
      first_year: "SELECT MIN(year) FROM race_result",
      last_year: "SELECT MAX(year) FROM race_result",
    })) {
      copy.run("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", [key, count(sql)]);
    }
    copy.exec("VACUUM");
    return copy.export();
  } finally {
    copy.close();
  }
}

/** Text of the credits of a public dataset file, if it is one. */
export function publicCredits(db: Database): string | undefined {
  const r = db.exec("SELECT value FROM meta WHERE key = 'credits'");
  return r.length ? String(r[0]!.values[0]![0]) : undefined;
}

export interface PublicInfo {
  beta: boolean;
  made?: string;
  races: number;
  editions: number;
  results: number;
  firstYear?: number;
  lastYear?: number;
  note?: string;
}

/** What a public file says about itself: the date, how much it holds, and that it is a beta. */
export function publicInfo(db: Database): PublicInfo {
  const meta = new Map((db.exec("SELECT key, value FROM meta")[0]?.values ?? []).map((r) => [String(r[0]), String(r[1])]));
  const num = (k: string) => (meta.has(k) && meta.get(k) !== "" ? Number(meta.get(k)) : undefined);
  return {
    beta: meta.get("beta") === "1",
    ...(meta.has("made") ? { made: meta.get("made")! } : {}),
    races: num("races") ?? 0,
    editions: num("editions") ?? 0,
    results: num("results") ?? 0,
    ...(num("first_year") !== undefined ? { firstYear: num("first_year")! } : {}),
    ...(num("last_year") !== undefined ? { lastYear: num("last_year")! } : {}),
    ...(meta.has("beta_note") ? { note: meta.get("beta_note")! } : {}),
  };
}
