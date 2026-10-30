import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import initSqlJs from "sql.js/dist/sql-wasm-inline.js";
import { openDatabase, publicInfo } from "../src/db";

// the script that builds the public beta file, run for real on a small capture
const dir = mkdtempSync(join(tmpdir(), "kinderkopjedb-beta-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const comp = (id: number, name: string, year: number) => ({ id, name, start: year + "-03-20", end: year + "-03-20", year, country: "ITA", class: "1.UWT", inProgress: false, category: "ME" });
const capture = {
  format: "racethreads-capture/1",
  competitions: [comp(1, "Milano-Sanremo", 2025), comp(2, "Milano-Sanremo", 2026), comp(3, "Race With No Results", 2026)],
  eventResults: [1, 2].map((id) => ({ competitionId: id, eventId: id, heading: "x", totalRows: 80, rows: [{ rank: 1, rider: "POGAČAR Tadej", team: "UAE TEAM EMIRATES", age: 27, nation: "SLO", result: "x", points: 800 }] })),
};

describe("the beta build script", () => {
  it("builds a public beta file from a capture file, with the races, the ages and the links it is given", async () => {
    writeFileSync(join(dir, "capture.json"), JSON.stringify(capture));
    writeFileSync(join(dir, "links.json"), JSON.stringify({ "milanosanremo|ME": [{ kind: "website", url: "https://www.milanosanremo.it/", source: "wikidata" }] }));
    const out = join(dir, "beta.sqlite");
    const run = spawnSync(process.execPath, ["scripts/build-beta.mjs", join(dir, "capture.json"), "--out", out, "--links", join(dir, "links.json"), "--note", "Test build."], { cwd: process.cwd(), encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("1 races, 2 editions, 2 results, 2025 to 2026");
    const db = openDatabase(await initSqlJs(), new Uint8Array(readFileSync(out)));
    expect(publicInfo(db)).toMatchObject({ beta: true, races: 1, editions: 2, results: 2 }); // the race without results is not in it
    expect(db.exec("SELECT name FROM race")[0]!.values).toEqual([["Milano-Sanremo"]]);
    expect(db.exec("SELECT age FROM v_results LIMIT 1")[0]!.values[0]![0]).toBe(27);
    expect(db.exec("SELECT url FROM race_link")[0]!.values).toEqual([["https://www.milanosanremo.it/"]]);
    expect(db.exec("SELECT COUNT(*) FROM kv")[0]!.values[0]![0]).toBe(0); // the join and link lines are not in the public file
    expect(db.exec("SELECT value FROM meta WHERE key = 'beta_note'")[0]!.values[0]![0]).toContain("Test build.");
    expect(db.exec("SELECT COUNT(*) FROM country")[0]!.values[0]![0]).toBe(150);
    // the temporary bundle is cleaned up
    expect(spawnSync("git", ["status", "--short", "scripts"], { encoding: "utf8" }).stdout).not.toContain(".beta-bundle");
  }, 30000);
  it("says how to use it when no file is given", () => {
    const run = spawnSync(process.execPath, ["scripts/build-beta.mjs"], { cwd: process.cwd(), encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Usage:");
  });
});
