import type { Database } from "sql.js";
import type { Category } from "../core/dataride";
import type { Cube, QueueRace, RaceResult, ResultClassification, TeamSnapshot } from "../core/cube";
import { buildRaces, fillRaceDates } from "../core/cube";
import { COUNTRIES } from "../core/countries";
import { LINK_LABELS, linksFromRegistry, parseLinkStore } from "../core/links";
import { migrate } from "./schema";

/** Open a database from file bytes (or an empty one) and bring it to the current schema. */
export function openDatabase(SQL: { Database: new (data?: ArrayLike<number>) => Database }, bytes?: Uint8Array): Database {
  const db = new SQL.Database(bytes);
  migrate(db);
  writeCountries(db);
  return db;
}

function all(db: Database, sql: string, params: (string | number | null)[] = []): Record<string, string | number | null>[] {
  const stmt = db.prepare(sql, params);
  const rows: Record<string, string | number | null>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, string | number | null>);
  stmt.free();
  return rows;
}

/** Replace the cube tables with the contents of `cube` (one transaction). */
export function saveCube(db: Database, cube: Cube): void {
  fillRaceDates(cube);
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM result_row; DELETE FROM classification; DELETE FROM race_result; DELETE FROM queue_event; DELETE FROM queue_race; DELETE FROM team_level; DELETE FROM team_rank; DELETE FROM team_snapshot;");

    const snap = db.prepare("INSERT INTO team_snapshot(season, date, moment_id, complete) VALUES (?,?,?,?)");
    const rank = db.prepare("INSERT INTO team_rank(snapshot_id, team_id, code, name, nation, rank, points) VALUES (?,?,?,?,?,?,?)");
    for (const s of cube.teamSnapshots) {
      snap.run([s.season, s.date, s.momentId, s.complete ? 1 : 0]);
      const id = Number(db.exec("SELECT last_insert_rowid()")[0]!.values[0]![0]);
      for (const t of s.teams) rank.run([id, t.teamId, t.code, t.name, t.nation, t.rank, t.points]);
    }
    snap.free();
    rank.free();

    const lvl = db.prepare("INSERT INTO team_level(season, team_id, level) VALUES (?,?,?)");
    for (const [season, l] of Object.entries(cube.levels ?? {})) {
      for (const id of l.WT) lvl.run([Number(season), id, "WT"]);
      for (const id of l.PT) lvl.run([Number(season), id, "PT"]);
    }
    lvl.free();

    const race = db.prepare("INSERT INTO race_result(uci_id, year, name, class, class_text, dates, start, end, country, captured_at, contributor) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const cls = db.prepare("INSERT INTO classification(uci_id, label, title, total_rows, event_id, date) VALUES (?,?,?,?,?,?)");
    const row = db.prepare("INSERT INTO result_row(classification_id, rank, rider, team, age, nation, result, points) VALUES (?,?,?,?,?,?,?,?)");
    for (const r of cube.raceResults ?? []) {
      race.run([r.uciId, r.year, r.name, r.class ?? null, r.classText ?? null, r.dates ?? null, r.start ?? null, r.end ?? null, r.country ?? null, r.capturedAt ?? null, r.contributor ?? null]);
      const used = new Set<string>();
      for (const c of r.classifications) {
        // a race's classifications must differ in label or title; two events with the same names get their event number
        let label = c.label;
        if (used.has(label + "|" + c.title)) label += " [" + (c.eventId ?? used.size) + "]";
        used.add(label + "|" + c.title);
        cls.run([r.uciId, label, c.title, c.totalRows, c.eventId ?? null, c.date ?? null]);
        const cid = Number(db.exec("SELECT last_insert_rowid()")[0]!.values[0]![0]);
        for (const w of c.rows) row.run([cid, w.rank, w.rider, w.team, w.age, w.nation, w.result, w.points]);
      }
    }
    race.free();
    cls.free();
    row.free();

    const q = db.prepare("INSERT INTO queue_race(uci_id, year, name, start, end, country, hub, class, category) VALUES (?,?,?,?,?,?,?,?,?)");
    const qe = db.prepare("INSERT INTO queue_event(uci_id, event_id, name) VALUES (?,?,?)");
    for (const x of cube.queue ?? []) {
      q.run([x.uciId, x.year, x.name, x.start, x.end, x.country, x.hub, x.class ?? null, x.category ?? null]);
      for (const e of x.events ?? []) qe.run([x.uciId, e.id, e.name]);
    }
    q.free();
    qe.free();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  writeRaces(db, cube);
}

/** The country table (code, name, continent, confederation) is reference data: kept equal to the table in the code. */
export function writeCountries(db: Database): void {
  const have = Number(db.exec("SELECT COUNT(*) FROM country")[0]?.values[0]?.[0] ?? 0);
  if (have === COUNTRIES.length) return;
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM country");
    const insert = db.prepare("INSERT INTO country(code, name, continent, confederation) VALUES (?,?,?,?)");
    for (const c of COUNTRIES) insert.run([c.code, c.name, c.continent, c.confederation]);
    insert.free();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Write the races: one row per race with its internal name, its external names, and the race id on every queue entry
 * and result. They are worked out from the queue, the join lines and the rename lines saved with the data, so this is
 * run after any of those change. A race keeps its id when it is saved again.
 */
export function writeRaces(db: Database, cube: Cube): void {
  // links come from the registry of the Threads tab and from the ones stored here (Wikidata, typed by hand)
  const stores = [linksFromRegistry(getKv(db, "registry")), parseLinkStore(getKv(db, "racelinks"))];
  const races = buildRaces(cube, getKv(db, "racealiases") ?? "", getKv(db, "racenames") ?? "", undefined, stores);
  const ids = new Map(all(db, "SELECT race_id, key FROM race").map((r) => [r.key as string, r.race_id as number]));
  let next = Math.max(0, ...ids.values()) + 1;
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM race_link; DELETE FROM race_name; DELETE FROM race; UPDATE queue_race SET race_id = NULL; UPDATE race_result SET race_id = NULL;");
    const insert = db.prepare("INSERT INTO race(race_id, key, name, slug, category, first_year, last_year) VALUES (?,?,?,?,?,?,?)");
    const insertName = db.prepare("INSERT INTO race_name(race_id, name, source, first_year, last_year) VALUES (?,?,?,?,?)");
    const insertLink = db.prepare("INSERT OR IGNORE INTO race_link(race_id, kind, label, url, source) VALUES (?,?,?,?,?)");
    const q = db.prepare("UPDATE queue_race SET race_id = ? WHERE uci_id = ?");
    const r = db.prepare("UPDATE race_result SET race_id = ? WHERE uci_id = ?");
    for (const race of races) {
      const id = ids.get(race.key) ?? next++;
      insert.run([id, race.key, race.name, race.slug, race.category, race.years[0] ?? null, race.years[race.years.length - 1] ?? null]);
      for (const n of race.names) insertName.run([id, n.name, "uci", n.years[0] ?? null, n.years[n.years.length - 1] ?? null]);
      for (const l of race.links) insertLink.run([id, l.kind, l.label ?? LINK_LABELS[l.kind], l.url, l.source]);
      for (const uciId of race.uciIds) {
        q.run([id, uciId]);
        r.run([id, uciId]);
      }
    }
    insert.free();
    insertName.free();
    insertLink.free();
    q.free();
    r.free();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Read the cube tables back into the in-memory cube the pages work with. */
export function loadCube(db: Database): Cube {
  const cube: Cube = { teamSnapshots: [] };

  const snaps = all(db, "SELECT id, season, date, moment_id, complete FROM team_snapshot ORDER BY date");
  for (const s of snaps) {
    const teams = all(db, "SELECT team_id, code, name, nation, rank, points FROM team_rank WHERE snapshot_id = ? ORDER BY rank", [s.id as number]);
    const snap: TeamSnapshot = {
      date: s.date as string,
      season: s.season as number,
      momentId: (s.moment_id as number | null) ?? null,
      complete: !!s.complete,
      teams: teams.map((t) => ({
        teamId: t.team_id as number,
        code: t.code as string,
        name: t.name as string,
        nation: t.nation as string,
        rank: t.rank as number,
        points: t.points as number,
      })),
    };
    cube.teamSnapshots.push(snap);
  }

  const levels = all(db, "SELECT season, team_id, level FROM team_level ORDER BY season, team_id");
  if (levels.length) {
    cube.levels = {};
    for (const l of levels) {
      const e = (cube.levels[String(l.season)] ??= { WT: [], PT: [] });
      (l.level === "WT" ? e.WT : e.PT).push(l.team_id as number);
    }
  }

  const races = all(db, "SELECT uci_id, year, name, class, class_text, dates, start, end, country, captured_at, contributor FROM race_result ORDER BY year, uci_id");
  if (races.length) {
    cube.raceResults = races.map((r): RaceResult => {
      const classifications = all(db, "SELECT id, label, title, total_rows, event_id, date FROM classification WHERE uci_id = ? ORDER BY id", [r.uci_id as number]).map((c): ResultClassification => ({
        label: c.label as string,
        title: c.title as string,
        ...(c.event_id !== null ? { eventId: c.event_id as number } : {}),
        ...(c.date !== null ? { date: c.date as string } : {}),
        totalRows: c.total_rows as number,
        rows: all(db, "SELECT rank, rider, team, age, nation, result, points FROM result_row WHERE classification_id = ? ORDER BY COALESCE(rank, 1000000), rowid", [c.id as number]).map((w) => ({
          rank: (w.rank as number | null) ?? null,
          rider: w.rider as string,
          team: w.team as string,
          age: (w.age as number | null) ?? null,
          nation: w.nation as string,
          result: w.result as string,
          points: w.points as number,
        })),
      }));
      const out: RaceResult = { uciId: r.uci_id as number, year: r.year as number, name: r.name as string, classifications };
      if (r.class !== null) out.class = r.class as string;
      if (r.class_text !== null) out.classText = r.class_text as string;
      if (r.dates !== null) out.dates = r.dates as string;
      if (r.start !== null) out.start = r.start as string;
      if (r.end !== null) out.end = r.end as string;
      if (r.country !== null) out.country = r.country as string;
      if (r.captured_at !== null) out.capturedAt = r.captured_at as string;
      if (r.contributor !== null) out.contributor = r.contributor as string;
      return out;
    });
  }

  const queue = all(db, "SELECT uci_id, year, name, start, end, country, hub, class, category FROM queue_race ORDER BY start, name");
  if (queue.length) {
    const events = all(db, "SELECT uci_id, event_id, name FROM queue_event ORDER BY event_id");
    cube.queue = queue.map((x): QueueRace => {
      const out: QueueRace = {
        uciId: x.uci_id as number,
        year: x.year as number,
        name: x.name as string,
        start: x.start as string,
        end: x.end as string,
        country: x.country as string,
        hub: x.hub as string,
      };
      if (x.class !== null) out.class = x.class as string;
      if (x.category !== null) out.category = x.category as Category;
      const mine = events.filter((e) => e.uci_id === x.uci_id);
      if (mine.length) out.events = mine.map((e) => ({ id: e.event_id as number, name: e.name as string }));
      return out;
    });
  }
  // a database saved before dates were kept gets the race days from its queue straight away
  fillRaceDates(cube);
  return cube;
}

export function getKv(db: Database, key: string): string | undefined {
  const r = db.exec("SELECT value FROM kv WHERE key = ?", [key]);
  return r.length ? (r[0]!.values[0]![0] as string) : undefined;
}

export function setKv(db: Database, key: string, value: string): void {
  db.run("INSERT OR REPLACE INTO kv(key, value) VALUES (?, ?)", [key, value]);
}

export function deleteKv(db: Database, key: string): void {
  db.run("DELETE FROM kv WHERE key = ?", [key]);
}

/**
 * Run a read-only SQL statement and return its rows (for the SQL box on the Data page).
 * SQLite itself is switched to query-only for the call, so a second statement cannot write either.
 */
export function querySql(db: Database, sql: string): { columns: string[]; rows: (string | number | null)[][] } {
  if (!/^\s*\(*\s*(SELECT|WITH|EXPLAIN)(?![A-Za-z0-9_])/i.test(sql)) throw new Error("Only SELECT queries can be run here.");
  db.exec("PRAGMA query_only = ON");
  try {
    const res = db.exec(sql);
    if (!res.length) return { columns: [], rows: [] };
    return { columns: res[0]!.columns, rows: res[0]!.values as (string | number | null)[][] };
  } finally {
    db.exec("PRAGMA query_only = OFF");
  }
}
