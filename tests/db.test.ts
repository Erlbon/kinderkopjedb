import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js/dist/sql-wasm-inline.js";
import { Cube, addCapture, addQueue, emptyCube, CaptureFile, setLevels } from "../src/core";
import { SCHEMA_VERSION, deleteKv, getKv, loadCube, openDatabase, querySql, saveCube, schemaVersion, setKv } from "../src/db";

const SQL = await initSqlJs();

// A cube with a bit of everything. Teams and riders are made up; the structure is what is tested.
function sampleCube(): Cube {
  const cube = emptyCube();
  const t = (teamId: number, code: string, name: string, rank: number, points: number) => ({ teamId, code, name, nation: "XXX", rank, points });
  cube.teamSnapshots.push(
    { date: "2025-10-19", season: 2025, momentId: 1, complete: false, teams: [t(1, "AAA", "Team A", 1, 900.5), t(2, "BBB", "Team B", 2, 400)] },
    { date: "2026-10-13", season: 2026, momentId: 2, complete: true, teams: [t(1, "AAB", "Team A New", 1, 700)] },
  );
  setLevels(cube, 2026, { WT: [1], PT: [] });
  setLevels(cube, 2025, { WT: [1], PT: [2] });
  const file: CaptureFile = {
    format: "racethreads-capture/1",
    raceResults: [
      {
        uciId: 78462,
        year: 2026,
        name: "Paris - Tours Elite",
        class: "1.Pro",
        classText: "1.Pro - 1 day - UCI ProSeries",
        dates: "11 Oct 2026",
        classifications: [
          {
            label: "Final Classification",
            title: "General Classification",
            totalRows: 165,
            rows: [
              { rank: 1, rider: "Per Strand HAGENES", team: "TEAM VISMA | LEASE A BIKE", age: 23, nation: "NOR", result: "4:31:46", points: 250 },
              { rank: 2, rider: "Jasper STUYVEN", team: "SOUDAL QUICK-STEP", age: 34, nation: "BEL", result: "+02", points: 170 },
            ],
          },
        ],
      },
    ],
  };
  addCapture(cube, file);
  addQueue(cube, "2027 UCI WorldTour", 2027, [{ uciId: 79677, name: "Strade Bianche", start: "2027-03-06", end: "2027-03-06", country: "ITA" }]);
  return cube;
}

describe("database schema", () => {
  it("a new database is at the current schema version", () => {
    const db = openDatabase(SQL);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0]!.values.flat();
    expect(tables).toEqual(expect.arrayContaining(["team_snapshot", "team_rank", "team_level", "race_result", "classification", "result_row", "queue_race", "kv", "meta"]));
  });
  it("reopening a saved file keeps the data and does not migrate twice", () => {
    const db = openDatabase(SQL);
    setKv(db, "season", "season: 2027");
    const again = openDatabase(SQL, db.export());
    expect(getKv(again, "season")).toBe("season: 2027");
    expect(schemaVersion(again)).toBe(SCHEMA_VERSION);
  });
  it("refuses a file from a newer version of the tool", () => {
    const db = openDatabase(SQL);
    db.run("UPDATE meta SET value = '999' WHERE key = 'schema_version'");
    expect(() => openDatabase(SQL, db.export())).toThrow(/newer version/);
    // and the message says what to do, and that nothing was changed
    expect(() => openDatabase(SQL, db.export())).toThrow(/Ctrl\+F5/);
    expect(() => openDatabase(SQL, db.export())).toThrow(/Your data has not been changed/);
  });
});

describe("saving and loading the cube", () => {
  it("everything survives a round trip through SQLite and through an exported file", () => {
    const cube = sampleCube();
    const db = openDatabase(SQL);
    saveCube(db, cube);
    expect(loadCube(db)).toEqual(cube);
    const copy = openDatabase(SQL, db.export()); // the .sqlite file a moderator would pass on
    expect(loadCube(copy)).toEqual(cube);
  });
  it("saving again replaces the old rows (no duplicates)", () => {
    const db = openDatabase(SQL);
    const cube = sampleCube();
    saveCube(db, cube);
    saveCube(db, cube);
    expect(db.exec("SELECT count(*) FROM team_snapshot")[0]!.values[0]![0]).toBe(2);
    expect(db.exec("SELECT count(*) FROM result_row")[0]!.values[0]![0]).toBe(2);
  });
  it("an empty cube loads as an empty cube", () => {
    const db = openDatabase(SQL);
    expect(loadCube(db)).toEqual({ teamSnapshots: [] });
  });
});

describe("settings texts", () => {
  it("stores, reads, replaces and deletes", () => {
    const db = openDatabase(SQL);
    expect(getKv(db, "registry")).toBeUndefined();
    setKv(db, "registry", "a: 1");
    setKv(db, "registry", "a: 2");
    expect(getKv(db, "registry")).toBe("a: 2");
    deleteKv(db, "registry");
    expect(getKv(db, "registry")).toBeUndefined();
  });
});

describe("the SQL box", () => {
  const db = openDatabase(SQL);
  saveCube(db, sampleCube());
  it("answers questions with the views", () => {
    const r = querySql(db, "SELECT team_id, code, points FROM v_team_points WHERE season = 2026");
    expect(r.columns).toEqual(["team_id", "code", "points"]);
    expect(r.rows).toEqual([[1, "AAB", 700]]);
    const pts = querySql(db, "SELECT team, SUM(points) AS p FROM v_results GROUP BY team ORDER BY p DESC");
    expect(pts.rows[0]).toEqual(["TEAM VISMA | LEASE A BIKE", 250]);
  });
  it("matches the same team across a code change by the UCI id", () => {
    const r = querySql(db, "SELECT team_id, group_concat(code) FROM v_team_points GROUP BY team_id HAVING team_id = 1");
    expect(r.rows).toEqual([[1, "AAA,AAB"]]);
  });
  it("refuses anything that writes, also behind a second statement", () => {
    expect(() => querySql(db, "DELETE FROM team_rank")).toThrow(/Only SELECT/);
    expect(() => querySql(db, "SELECT 1; DELETE FROM team_rank")).toThrow();
    expect(db.exec("SELECT count(*) FROM team_rank")[0]!.values[0]![0]).toBe(3);
    // and the database accepts writes again afterwards
    setKv(db, "k", "v");
    expect(getKv(db, "k")).toBe("v");
  });
});

describe("upgrading an older database", () => {
  it("a version 1 file opens, keeps its data and is brought to the current version", async () => {
    const { MIGRATIONS } = await import("../src/db");
    const old = new SQL.Database();
    old.exec(MIGRATIONS[1]!);
    old.run("INSERT INTO meta(key, value) VALUES ('schema_version', '1')");
    old.run("INSERT INTO race_result(uci_id, year, name) VALUES (78462, 2026, 'Paris - Tours Elite')");
    old.run("INSERT INTO kv(key, value) VALUES ('season', 'season: 2026')");
    expect(schemaVersion(old)).toBe(1);

    const upgraded = openDatabase(SQL, old.export());
    expect(schemaVersion(upgraded)).toBe(SCHEMA_VERSION);
    expect(upgraded.exec("SELECT COUNT(*) FROM queue_event")[0]!.values[0]![0]).toBe(0);
    expect(getKv(upgraded, "season")).toBe("season: 2026");
    const cube = loadCube(upgraded);
    expect(cube.raceResults![0]).toMatchObject({ uciId: 78462, name: "Paris - Tours Elite" });
    expect(cube.raceResults![0]!.contributor).toBeUndefined();
  });
  it("two events of one race with the same names are both saved", () => {
    const cube = emptyCube();
    const rows = [{ rank: 1, rider: "A", team: "T", age: 20, nation: "ITA", result: "x", points: 5 }];
    cube.raceResults = [
      { uciId: 77382, year: 2026, name: "AlUla Tour", classifications: [{ label: "Event 1", title: "AlUla Tour", eventId: 1, totalRows: 40, rows }, { label: "Event 1", title: "AlUla Tour", eventId: 2, totalRows: 40, rows }] },
    ];
    const db = openDatabase(SQL);
    saveCube(db, cube); // used to fail with a UNIQUE constraint and lose the whole import
    expect(loadCube(db).raceResults![0]!.classifications.map((c) => c.eventId)).toEqual([1, 2]);
  });
  it("the contributor of a race result is kept", () => {
    const cube = emptyCube();
    cube.raceResults = [{ uciId: 1, year: 2026, name: "Some Race", contributor: "A Helper", classifications: [] }];
    const db = openDatabase(SQL);
    saveCube(db, cube);
    expect(loadCube(db).raceResults![0]!.contributor).toBe("A Helper");
  });
});

describe("race and event dates", () => {
  const rows = [{ rank: 1, rider: "A", team: "T", age: 20, nation: "ITA", result: "x", points: 5 }];
  const stage = (eventId: number, date?: string) => ({ competitionId: 9, eventId, heading: "Tour Stage", totalRows: 30, rows, ...(date ? { date } : {}) });

  it("importing a capture file again adds the event dates, without adding rows", () => {
    const cube = emptyCube();
    // as stored before dates were kept
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [stage(91), stage(92)] });
    expect(cube.raceResults![0]!.classifications.map((c) => c.date)).toEqual([undefined, undefined]);
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [stage(91, "2026-10-13"), stage(92, "2026-10-15")] });
    const race = cube.raceResults![0]!;
    expect(race.classifications.map((c) => [c.date, c.rows.length])).toEqual([["2026-10-13", 1], ["2026-10-15", 1]]);
  });

  it("a race's first and last day come from the competition list, else from its events; a one-day race dates its events", () => {
    const cube = emptyCube();
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [stage(91, "2026-10-13"), stage(92, "2026-10-15")] });
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [{ ...stage(81), competitionId: 8 }] });
    addCapture(cube, { format: "racethreads-capture/1", competitions: [{ id: 8, name: "One Day", start: "2026-10-10", end: "2026-10-10", year: 2026, country: "ITA", class: "1.Pro", inProgress: false }] });
    const db = openDatabase(SQL);
    saveCube(db, cube);
    const back = loadCube(openDatabase(SQL, db.export()));
    const byId = new Map(back.raceResults!.map((r) => [r.uciId, r]));
    expect(byId.get(9)).toMatchObject({ start: "2026-10-13", end: "2026-10-15" });
    expect(byId.get(8)).toMatchObject({ start: "2026-10-10", end: "2026-10-10" });
    expect(byId.get(8)!.classifications[0]!.date).toBe("2026-10-10");
    expect(db.exec("SELECT DISTINCT date FROM v_results WHERE uci_id = 9 ORDER BY date")[0]!.values).toEqual([["2026-10-13"], ["2026-10-15"]]);
  });

  it("a version 6 database gets the date columns, and its races get their days from the queue on opening", async () => {
    const { MIGRATIONS } = await import("../src/db");
    const old = new SQL.Database();
    for (let v = 1; v <= 6; v++) old.exec(MIGRATIONS[v]!);
    old.run("INSERT INTO meta(key, value) VALUES ('schema_version', '6')");
    old.run("INSERT INTO race_result(uci_id, year, name) VALUES (8, 2026, 'One Day')");
    old.run("INSERT INTO classification(uci_id, label, title, total_rows, event_id) VALUES (8, 'Final', 'Result', 30, 81)");
    old.run("INSERT INTO queue_race(uci_id, year, name, start, end, country, hub) VALUES (8, 2026, 'One Day', '2026-10-10', '2026-10-10', 'ITA', 'DataRide')");
    const upgraded = openDatabase(SQL, old.export());
    const cube = loadCube(upgraded);
    expect(cube.raceResults![0]).toMatchObject({ start: "2026-10-10", end: "2026-10-10" });
    expect(cube.raceResults![0]!.classifications[0]!.date).toBe("2026-10-10");
    saveCube(upgraded, cube);
    expect(upgraded.exec("SELECT start, end FROM race_result")[0]!.values).toEqual([["2026-10-10", "2026-10-10"]]);
  });
});
