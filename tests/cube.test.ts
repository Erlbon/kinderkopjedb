import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CaptureFile,
  Cube,
  addCapture,
  beatenByLowerLevel,
  beatenMarkdown,
  combineMerged,
  compareToLastYear,
  comparisonMarkdown,
  emptyCube,
  levelOf,
  matchListed,
  monthlyMarkdown,
  monthlyOverview,
  onlyWorldAndPro,
  parseLineage,
  parseOpenSeasons,
  parseTeamList,
  sameDayInYear,
  seasonTable,
  seasonTableMarkdown,
  setLevels,
  snapshotAsOf,
  withoutSeasons,
} from "../src/core";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

describe("importing a capture file (real sample values)", () => {
  const cube = emptyCube();
  const report = addCapture(cube, JSON.parse(read("tests/fixtures/dataride-capture-sample.json")) as CaptureFile);

  it("adds the two team-ranking snapshots in date order", () => {
    expect(report).toEqual({ added: 2, replaced: 0, races: 0, skipped: [] });
    expect(cube.teamSnapshots.map((s) => s.date)).toEqual(["2025-10-19", "2026-10-13"]);
  });
  it("keeps the same team across a code change (UAD in 2025, UEX in 2026)", () => {
    // as of 19 Oct: the 2026 ranking of 13 Oct against the 2025 ranking of 19 Oct
    const c = compareToLastYear(cube, 2026, "2026-10-19");
    const uae = c.lines.find((l) => l.teamId === 595)!;
    expect(uae).toMatchObject({ code: "UEX", now: 30329.1, before: 40637.65, diff: -10308.55 });
  });
  it("never uses a later ranking as 'the same date last year'", () => {
    // 13 Oct 2026 needs a 2025 ranking dated on or before 13 Oct 2025; the sample only has 19 Oct 2025
    const c = compareToLastYear(cube, 2026, "2026-10-13");
    expect(c.now?.date).toBe("2026-10-13");
    expect(c.before).toBeUndefined();
    expect(comparisonMarkdown(c, 2026, "2026-10-13")).toContain("compared with no ranking");
  });
});

describe("rules of the comparison", () => {
  it("takes the latest ranking on or before the cut-off, never a later one", () => {
    const cube: Cube = {
      teamSnapshots: [
        { date: "2025-10-05", season: 2025, momentId: 1, complete: true, teams: [] },
        { date: "2025-10-19", season: 2025, momentId: 2, complete: true, teams: [] },
      ],
    };
    expect(snapshotAsOf(cube, 2025, "2025-10-13")?.date).toBe("2025-10-05");
    expect(snapshotAsOf(cube, 2025, "2025-10-19")?.date).toBe("2025-10-19");
    expect(snapshotAsOf(cube, 2025, "2025-10-01")).toBeUndefined();
  });
  it("same day in another year, with 29 February handled", () => {
    expect(sameDayInYear("2026-10-13", 2025)).toBe("2025-10-13");
    expect(sameDayInYear("2028-02-29", 2027)).toBe("2027-02-28");
  });
});

// Synthetic teams: these numbers are made up to test the arithmetic, they are not UCI data.
describe("monthly overview (synthetic teams)", () => {
  const snap = (date: string, a: number, b?: number) => ({
    date,
    season: Number(date.slice(0, 4)),
    momentId: null,
    complete: true,
    teams: [
      { teamId: 1, code: "AAA", name: "Test Team A", nation: "XXX", rank: 1, points: a },
      ...(b === undefined ? [] : [{ teamId: 2, code: "BBB", name: "Test Team B", nation: "XXX", rank: 2, points: b }]),
    ],
  });
  const cube: Cube = {
    teamSnapshots: [
      snap("2025-01-31", 100, 50),
      snap("2025-02-28", 300, 70),
      snap("2025-03-31", 450, 90),
      snap("2026-01-31", 150, 40),
      snap("2026-02-28", 260, 100),
      // no March snapshot in 2026 yet
    ],
  };
  const lines = monthlyOverview(cube, 2026);
  const a = lines.find((l) => l.teamId === 1)!;

  it("month-end totals and points gained per month", () => {
    expect(a.total.slice(0, 3)).toEqual([150, 260, undefined]);
    expect(a.gained[0]).toBe(150);
    expect(a.gained[1]).toBe(110);
    expect(a.gainedBefore.slice(0, 3)).toEqual([100, 200, 150]);
  });
  it("months without a ranking stay empty (no invented numbers)", () => {
    expect(a.total[2]).toBeUndefined();
    expect(a.gained[2]).toBeUndefined();
  });
  it("a month after a gap is not given several months' points", () => {
    const gap: Cube = {
      teamSnapshots: [
        { date: "2026-02-28", season: 2026, momentId: null, complete: true, teams: [{ teamId: 1, code: "AAA", name: "Test Team A", nation: "XXX", rank: 1, points: 260 }] },
        { date: "2026-10-13", season: 2026, momentId: null, complete: true, teams: [{ teamId: 1, code: "AAA", name: "Test Team A", nation: "XXX", rank: 1, points: 950 }] },
      ],
    };
    const l = monthlyOverview(gap, 2026)[0]!;
    expect(l.total[9]).toBe(950);
    expect(l.gained[9]).toBeUndefined(); // September's ranking is missing
    expect(l.gained[1]).toBeUndefined(); // January's is missing
  });
  it("sorts by the latest total and renders markdown with last year in brackets", () => {
    expect(lines[0]!.teamId).toBe(1);
    const md = monthlyMarkdown(lines, 2026);
    expect(md).toContain("|Test Team A (AAA)|150 (+50)|110 (-90)|");
    expect(md).toContain("UCI World Ranking points");
  });
  it("season to date against last year as a table", () => {
    const c = compareToLastYear(cube, 2026, "2026-02-28");
    const t = c.lines.find((l) => l.teamId === 2)!;
    expect(t).toMatchObject({ now: 100, before: 70, diff: 30 });
    expect(comparisonMarkdown(c, 2026, "2026-02-28")).toContain("|Test Team B (BBB)|XXX|100|70|+30|");
  });
});

describe("importing the same date twice", () => {
  it("the newer capture replaces the older one", () => {
    const file = JSON.parse(read("tests/fixtures/dataride-capture-sample.json")) as CaptureFile;
    const cube = emptyCube();
    addCapture(cube, file);
    const again = addCapture(cube, file);
    expect(again).toMatchObject({ added: 0, replaced: 2 });
    expect(cube.teamSnapshots).toHaveLength(2);
  });
  it("refuses files that are not captures, and snapshots without a date", () => {
    expect(addCapture(emptyCube(), {} as CaptureFile).skipped[0]).toContain("not a KinderkopjeDB capture file");
    const f = JSON.parse(read("tests/fixtures/dataride-capture-sample.json")) as CaptureFile;
    f.snapshots![0]!.date = "";
    expect(addCapture(emptyCube(), f).skipped[0]).toContain("no date");
  });
});

// Synthetic teams again: made-up numbers to test the arithmetic and layout, not UCI data.
describe("seasons side by side (synthetic teams)", () => {
  const team = (id: number, code: string, name: string, rank: number, points: number) => ({ teamId: id, code, name, nation: "XXX", rank, points });
  const cube: Cube = {
    teamSnapshots: [
      { date: "2024-10-20", season: 2024, momentId: null, complete: false, teams: [team(1, "OLD", "Old Name", 1, 500), team(2, "BBB", "Team B", 2, 300), team(3, "CCC", "Team C", 3, 100)] },
      { date: "2025-06-01", season: 2025, momentId: null, complete: false, teams: [team(1, "OLD", "Old Name", 1, 200)] },
      { date: "2025-10-19", season: 2025, momentId: null, complete: false, teams: [team(1, "NEW", "New Name", 2, 700), team(2, "BBB", "Team B", 1, 800)] },
    ],
  };
  const t = seasonTable(cube);
  it("uses the latest ranking of each season and keeps a renamed team on one line", () => {
    expect(t.columns).toEqual([{ season: 2024, date: "2024-10-20" }, { season: 2025, date: "2025-10-19" }]);
    const one = t.lines.find((l) => l.teamId === 1)!;
    expect(one).toMatchObject({ name: "New Name", code: "NEW", points: [500, 700], ranks: [1, 2] });
  });
  it("a team missing from a ranking has no number (not zero), and the newest season's teams come first", () => {
    const c = t.lines.find((l) => l.teamId === 3)!;
    expect(c.points).toEqual([100, undefined]);
    expect(t.lines.map((l) => l.teamId)).toEqual([2, 1, 3]); // 2 (800) and 1 (700) are in 2025; 3 is not
  });
  it("renders markdown with dates in the header", () => {
    const md = seasonTableMarkdown(t);
    expect(md).toContain("|Team|2024 (20 Oct)|2025 (19 Oct)|");
    expect(md).toContain("|New Name (NEW)|500 (#1)|700 (#2)|");
    expect(md).toContain("|Team C (CCC)|100 (#3)|-|");
  });
});

// Synthetic teams: made-up numbers for the merge arithmetic (the real ids 929 and 1372 appear in data/cube/team-lineage.yaml).
describe("merged teams (lineage)", () => {
  const team = (id: number, name: string, rank: number, points: number) => ({ teamId: id, code: "X" + id, name, nation: "XXX", rank, points });
  const lineage = parseLineage("merges:\n  - { into: 1, from: 2, effective: 2026 }\n");
  const cube: Cube = {
    teamSnapshots: [
      { date: "2025-10-19", season: 2025, momentId: null, complete: false, teams: [team(3, "Big", 1, 500), team(1, "Continues", 2, 200), team(2, "Stops", 3, 150), team(4, "Small", 4, 100)] },
      { date: "2026-10-13", season: 2026, momentId: null, complete: false, teams: [team(3, "Big", 1, 450), team(1, "Merged", 2, 380), team(4, "Small", 3, 90)] },
    ],
  };
  it("adds the stopping team to the continuing one before the merge, and not from the merge season on", () => {
    const c = combineMerged(cube, lineage);
    const s25 = c.teamSnapshots[0]!.teams;
    expect(s25.find((t) => t.teamId === 1)!.points).toBe(350);
    expect(s25.find((t) => t.teamId === 2)).toBeUndefined();
    expect(c.teamSnapshots[1]!.teams).toEqual(cube.teamSnapshots[1]!.teams); // 2026 untouched
  });
  it("recomputes ranks among the captured teams", () => {
    const c = combineMerged(cube, lineage);
    expect(c.teamSnapshots[0]!.teams.map((t) => [t.teamId, t.rank])).toEqual([[3, 1], [1, 2], [4, 3]]);
  });
  it("does not change the original cube", () => {
    combineMerged(cube, lineage);
    expect(cube.teamSnapshots[0]!.teams.find((t) => t.teamId === 2)!.points).toBe(150);
  });
  it("the real lineage file parses and names the Lotto and Intermarché-Wanty ids", () => {
    const real = parseLineage(read("data/cube/team-lineage.yaml"));
    expect(real.merges).toEqual([expect.objectContaining({ into: 929, from: 1372, effective: 2026 })]);
  });
  it("a team outside the captured part of the continuing side takes the stopping team's place", () => {
    const only: Cube = { teamSnapshots: [{ date: "2025-10-19", season: 2025, momentId: null, complete: false, teams: [team(2, "Stops", 1, 150)] }] };
    expect(combineMerged(only, lineage).teamSnapshots[0]!.teams[0]).toMatchObject({ teamId: 1, points: 150 });
  });
});

describe("unfinished seasons", () => {
  const snap = (date: string, season: number) => ({ date, season, momentId: null, complete: false, teams: [] });
  it("reads the list of open seasons from data/cube/seasons.yaml", () => {
    expect(parseOpenSeasons(read("data/cube/seasons.yaml"))).toEqual([2026]);
    expect(parseOpenSeasons("open: []")).toEqual([]);
    expect(parseOpenSeasons("")).toEqual([]);
  });
  it("leaves open seasons out of a copy of the cube", () => {
    const cube: Cube = { teamSnapshots: [snap("2025-10-19", 2025), snap("2026-10-13", 2026), snap("2024-10-20", 2024)] };
    const done = withoutSeasons(cube, [2026]);
    expect(done.teamSnapshots.map((s) => s.season)).toEqual([2025, 2024]);
    expect(cube.teamSnapshots).toHaveLength(3); // the original is untouched
  });
});

describe("team levels (Wikipedia lists)", () => {
  const wt = parseTeamList(read("tests/fixtures/wiki-worldteams-2026.wikitext"));
  const pt = parseTeamList(read("tests/fixtures/wiki-proteams-2026.wikitext"));
  // Names, codes and UCI ids as captured from DataRide; the points are made up for these tests.
  const t = (teamId: number, code: string, name: string, points: number, rank: number) => ({ teamId, code, name, nation: "XXX", rank, points });
  const captured = [
    t(1552, "NCI", "NETCOMPANY INEOS", 5000, 1),
    t(1488, "APT", "ALPECIN-PREMIER TECH", 4000, 2),
    t(3440, "LNS", "LI NING STAR", 3000, 3), // a lower-level team in these lists
    t(1377, "PQT", "PINARELLO-Q36.5 PRO CYCLING TEAM", 2500, 4),
    t(3768, "URR", "UNIBET ROSE ROCKETS", 2000, 5),
    t(4086, "MBH", "MBH BANK CSB TELECOM FORT", 1000, 6),
  ];

  it("reads both table layouts (18 WorldTeams with names, ProTeams with codes)", () => {
    expect(wt).toHaveLength(18);
    expect(wt[0]).toEqual({ code: "APC", name: "Alpecin–Premier Tech" });
    expect(pt.map((x) => x.code)).toEqual(["BCS", "BBH", "CJR", "COF", "EKP", "EUS", "MBH", "MAP", "PQT", "TFT", "PTV", "TEN", "TUD", "URR"]);
  });
  it("matches by code, then by name where the codes differ (IGD / NCI, APC / APT)", () => {
    const m = matchListed(wt, captured);
    expect(m.ids.sort()).toEqual([1488, 1552]);
    expect(m.unmatched.length).toBe(16); // the other WorldTeams are not in this small captured list
  });
  it("matches ProTeams by code", () => {
    expect(matchListed(pt, captured).ids.sort((a, b) => a - b)).toEqual([1377, 3768, 4086]);
  });

  const cube: Cube = { teamSnapshots: [{ date: "2026-10-13", season: 2026, momentId: null, complete: false, teams: captured }] };
  setLevels(cube, 2026, { WT: matchListed(wt, captured).ids, PT: matchListed(pt, captured).ids });

  it("knows each team's level", () => {
    expect(levelOf(cube, 2026, 1552)).toBe("WT");
    expect(levelOf(cube, 2026, 1377)).toBe("PT");
    expect(levelOf(cube, 2026, 3440)).toBeUndefined();
    expect(levelOf(cube, 2025, 1552)).toBeUndefined(); // no levels loaded for 2025
  });
  it("finds the WorldTeams and ProTeams that a lower-level team finished above", () => {
    const r = beatenByLowerLevel(cube, 2026);
    expect(r.lines.map((l) => [l.team.code, l.beatenBy.map((b) => b.code)])).toEqual([
      ["PQT", ["LNS"]],
      ["URR", ["LNS"]],
      ["MBH", ["LNS"]],
    ]);
    expect(beatenMarkdown([{ season: 2026, res: r }])).toContain("|2026|PINARELLO-Q36.5 PRO CYCLING TEAM (PQT)|PT|2,500|LI NING STAR (3,000)|");
  });
  it("keeps only WorldTeams and ProTeams for the main tables", () => {
    const only = onlyWorldAndPro(cube);
    expect(only.teamSnapshots[0]!.teams.map((x) => x.code)).toEqual(["NCI", "APT", "PQT", "URR", "MBH"]);
    expect(cube.teamSnapshots[0]!.teams).toHaveLength(6);
  });
  it("seasons without levels are left as they are", () => {
    const c2: Cube = { teamSnapshots: [{ date: "2025-10-19", season: 2025, momentId: null, complete: false, teams: captured }] };
    expect(onlyWorldAndPro(c2).teamSnapshots[0]!.teams).toHaveLength(6);
    expect(beatenByLowerLevel(c2, 2025)).toEqual({ lines: [], missing: 0 });
  });
});
