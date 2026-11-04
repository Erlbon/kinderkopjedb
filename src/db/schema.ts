import type { Database } from "sql.js";

/**
 * The KinderkopjeDB database (SQLite). One file holds everything the pages share:
 * team ranking snapshots, race results, the capture queue, team levels and the settings texts.
 * Bump SCHEMA_VERSION and add a step to MIGRATIONS when a table changes.
 */
export const SCHEMA_VERSION = 7;

const V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- settings and texts edited on the pages (season YAML, race registry, table layout ...)
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- UCI World Ranking, team ranking, one row per captured date
CREATE TABLE team_snapshot (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,
  date TEXT NOT NULL UNIQUE,
  moment_id INTEGER,
  complete INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE team_rank (
  snapshot_id INTEGER NOT NULL REFERENCES team_snapshot(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL,        -- UCI team id (stays with the licence through renames)
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  nation TEXT NOT NULL,
  rank INTEGER NOT NULL,
  points REAL NOT NULL,
  PRIMARY KEY (snapshot_id, team_id)
);
CREATE INDEX team_rank_team ON team_rank(team_id);

-- WorldTeam / ProTeam per season
CREATE TABLE team_level (
  season INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('WT','PT')),
  PRIMARY KEY (season, team_id)
);

-- race results from the UCI race pages
CREATE TABLE race_result (
  uci_id INTEGER PRIMARY KEY,
  year INTEGER NOT NULL,
  name TEXT NOT NULL,
  class TEXT,
  class_text TEXT,
  dates TEXT,
  country TEXT,
  captured_at TEXT
);
CREATE TABLE classification (
  id INTEGER PRIMARY KEY,
  uci_id INTEGER NOT NULL REFERENCES race_result(uci_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  title TEXT NOT NULL,
  total_rows INTEGER NOT NULL,
  UNIQUE (uci_id, label, title)
);
CREATE TABLE result_row (
  classification_id INTEGER NOT NULL REFERENCES classification(id) ON DELETE CASCADE,
  rank INTEGER,
  rider TEXT NOT NULL,
  team TEXT NOT NULL,
  age INTEGER,
  nation TEXT NOT NULL,
  result TEXT NOT NULL,
  points REAL NOT NULL
);
CREATE INDEX result_row_class ON result_row(classification_id);

-- races still to capture (from the UCI hub pages)
CREATE TABLE queue_race (
  uci_id INTEGER PRIMARY KEY,
  year INTEGER NOT NULL,
  name TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  country TEXT NOT NULL,
  hub TEXT NOT NULL
);

-- handy views for the SQL box on the Data page
CREATE VIEW v_team_points AS
  SELECT s.season, s.date, r.team_id, r.code, r.name, r.nation, r.rank, r.points
  FROM team_rank r JOIN team_snapshot s ON s.id = r.snapshot_id;
CREATE VIEW v_results AS
  SELECT q.uci_id, q.year, q.name AS race, q.class, c.label, c.title, w.rank, w.rider, w.team, w.nation, w.result, w.points
  FROM result_row w
  JOIN classification c ON c.id = w.classification_id
  JOIN race_result q ON q.uci_id = c.uci_id;
`;

// 2: who captured a race result (helper moderators put their name on the file they send back)
const V2 = `
ALTER TABLE race_result ADD COLUMN contributor TEXT;
`;

// 3: races come from DataRide (competition id, class, the events of a competition, the event of each classification)
const V3 = `
ALTER TABLE classification ADD COLUMN event_id INTEGER;
ALTER TABLE queue_race ADD COLUMN class TEXT;
ALTER TABLE queue_race ADD COLUMN category TEXT;
CREATE TABLE queue_event (
  uci_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (uci_id, event_id)
);
`;

// 4: races with an internal name and the external names UCI used for them; every edition points to its race
const V4 = `
CREATE TABLE race (
  race_id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,        -- follows the race when it is joined with others
  name TEXT NOT NULL,              -- the internal name
  slug TEXT NOT NULL,
  category TEXT NOT NULL,          -- ME = men's elite, WE = women's elite
  first_year INTEGER,
  last_year INTEGER
);
CREATE TABLE race_name (
  race_id INTEGER NOT NULL REFERENCES race(race_id) ON DELETE CASCADE,
  name TEXT NOT NULL,              -- an external name: how a source wrote it
  source TEXT NOT NULL,
  first_year INTEGER,
  last_year INTEGER,
  PRIMARY KEY (race_id, name, source)
);
ALTER TABLE queue_race ADD COLUMN race_id INTEGER;
ALTER TABLE race_result ADD COLUMN race_id INTEGER;
DROP VIEW v_results;
CREATE VIEW v_results AS
  SELECT q.uci_id, q.year, q.name AS race, q.class, c.label, c.title, w.rank, w.rider, w.team, w.nation, w.result, w.points, q.race_id, r.name AS race_name
  FROM result_row w
  JOIN classification c ON c.id = w.classification_id
  JOIN race_result q ON q.uci_id = c.uci_id
  LEFT JOIN race r ON r.race_id = q.race_id;
`;

// 5: countries with their continent (for filtering), and the links of each race (site, Wikipedia, social media, FirstCycling)
const V5 = `
CREATE TABLE country (
  code TEXT PRIMARY KEY,           -- the code UCI uses (IOC style): ITA, GER, SUI ...
  name TEXT NOT NULL,
  continent TEXT NOT NULL,
  confederation TEXT NOT NULL      -- UCI's: Europe, Asia, Africa, Pan America, Oceania
);
CREATE TABLE race_link (
  race_id INTEGER NOT NULL REFERENCES race(race_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- website, wikipedia, wikidata, x, instagram, facebook, youtube, tiktok, firstcycling, other
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL,            -- registry, wikidata or manual
  PRIMARY KEY (race_id, kind, url)
);
`;

// 6: the easy view of the results also shows the rider's age
const V6 = `
DROP VIEW v_results;
CREATE VIEW v_results AS
  SELECT q.uci_id, q.year, q.name AS race, q.class, c.label, c.title, w.rank, w.rider, w.team, w.nation, w.result, w.points, q.race_id, r.name AS race_name, w.age
  FROM result_row w
  JOIN classification c ON c.id = w.classification_id
  JOIN race_result q ON q.uci_id = c.uci_id
  LEFT JOIN race r ON r.race_id = q.race_id;
`;

// 7: dates: the first and last day of a race edition, the day of each event; the easy view shows the event's day
const V7 = `
ALTER TABLE race_result ADD COLUMN start TEXT;
ALTER TABLE race_result ADD COLUMN end TEXT;
ALTER TABLE classification ADD COLUMN date TEXT;
DROP VIEW v_results;
CREATE VIEW v_results AS
  SELECT q.uci_id, q.year, q.name AS race, q.class, c.label, c.title, w.rank, w.rider, w.team, w.nation, w.result, w.points, q.race_id, r.name AS race_name, w.age, c.date
  FROM result_row w
  JOIN classification c ON c.id = w.classification_id
  JOIN race_result q ON q.uci_id = c.uci_id
  LEFT JOIN race r ON r.race_id = q.race_id;
`;

/** Step n creates schema version n from n-1. Exported so tests can build an old database. */
export const MIGRATIONS: Record<number, string> = { 1: V1, 2: V2, 3: V3, 4: V4, 5: V5, 6: V6, 7: V7 };

export function schemaVersion(db: Database): number {
  const t = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'");
  if (!t.length) return 0;
  const v = db.exec("SELECT value FROM meta WHERE key='schema_version'");
  return v.length ? Number(v[0]!.values[0]![0]) : 0;
}

/** Bring a database to the current schema. A file from a newer version of the tool is refused. */
export function migrate(db: Database): void {
  const have = schemaVersion(db);
  if (have > SCHEMA_VERSION) {
    throw new Error(
      "This database was made by a newer version of KinderkopjeDB (schema " + have + ", this one knows " + SCHEMA_VERSION + "). This page is running an older copy of the tool, usually a page your browser kept from before an update: reload it with Ctrl+F5 (and close other tabs of this site that are still open). Your data has not been changed.",
    );
  }
  for (let v = have + 1; v <= SCHEMA_VERSION; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.run("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)", [String(v)]);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  db.exec("PRAGMA foreign_keys = ON");
}
