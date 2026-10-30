import { describe, expect, it } from "vitest";
import { CaptureFile, RaceResult, addCapture, addQueue, cleanRaceName, emptyCube, queueByRace, queueStatus } from "../src/core";

// Paris-Tours 2026 as captured from uci.org: the first rows of the Final Classification (rank, rider, team, points).
const row = (rank: number, rider: string, team: string, age: number, nation: string, result: string, points: number) => ({ rank, rider, team, age, nation, result, points });
const parisTours: RaceResult = {
  uciId: 78462,
  year: 2026,
  name: "Paris - Tours Elite",
  class: "1.Pro",
  dates: "11 Oct 2026",
  classifications: [
    {
      label: "Final Classification",
      title: "General Classification",
      totalRows: 165,
      rows: [
        row(1, "Per Strand HAGENES", "TEAM VISMA | LEASE A BIKE", 23, "NOR", "4:31:46", 250),
        row(2, "Jasper STUYVEN", "SOUDAL QUICK-STEP", 34, "BEL", "+02", 170),
        row(3, "Christophe LAPORTE", "TEAM VISMA | LEASE A BIKE", 34, "FRA", "+02", 140),
      ],
    },
  ],
};
const file = (r: RaceResult[]): CaptureFile => ({ format: "racethreads-capture/1", raceResults: r });

describe("race results from a capture file", () => {
  it("adds a race and reports it", () => {
    const cube = emptyCube();
    const rep = addCapture(cube, file([parisTours]));
    expect(rep).toMatchObject({ races: 1, added: 0, replaced: 0, skipped: [] });
    expect(cube.raceResults).toHaveLength(1);
    expect(cube.raceResults![0]!.classifications[0]!.rows[0]).toMatchObject({ rider: "Per Strand HAGENES", points: 250 });
  });
  it("a second capture of the same race replaces the same classification and keeps the others", () => {
    const cube = emptyCube();
    addCapture(cube, file([parisTours]));
    const stage: RaceResult = { ...parisTours, classifications: [{ label: "Stage 1", title: "Stage", totalRows: 150, rows: [row(1, "A RIDER", "TEAM A", 25, "XXX", "1:00:00", 100)] }] };
    addCapture(cube, file([stage]));
    expect(cube.raceResults).toHaveLength(1);
    expect(cube.raceResults![0]!.classifications.map((c) => c.label)).toEqual(["Final Classification", "Stage 1"]);
    const newer: RaceResult = { ...parisTours, classifications: [{ ...parisTours.classifications[0]!, rows: [row(1, "NEW WINNER", "TEAM B", 20, "XXX", "4:00:00", 250)] }] };
    addCapture(cube, file([newer]));
    const fc = cube.raceResults![0]!.classifications;
    expect(fc).toHaveLength(2);
    expect(fc[0]!.rows[0]!.rider).toBe("NEW WINNER");
  });
  it("a file with both team rankings and race results is understood, and a foreign file is refused", () => {
    expect(addCapture(emptyCube(), { format: "racethreads-capture/1", snapshots: [], raceResults: [parisTours] }).races).toBe(1);
    expect(addCapture(emptyCube(), {} as CaptureFile).skipped[0]).toContain("not a KinderkopjeDB capture file");
  });
});

describe("the capture queue", () => {
  const races = [
    { uciId: 1, name: "Race One", start: "2027-03-06", end: "2027-03-06", country: "ITA" },
    { uciId: 78462, name: "Paris - Tours Elite", start: "2026-10-11", end: "2026-10-11", country: "FRA" },
    { uciId: 3, name: "Race Three", start: "2027-01-19", end: "2027-01-24", country: "AUS" },
  ];
  it("lists races by date and does not add one twice", () => {
    const cube = emptyCube();
    expect(addQueue(cube, "2027 UCI WorldTour", 2027, races)).toBe(3);
    expect(addQueue(cube, "2027 UCI WorldTour", 2027, races)).toBe(0);
    expect(cube.queue!.map((q) => q.uciId)).toEqual([78462, 3, 1]);
  });
  it("shows what has been captured", () => {
    const cube = emptyCube();
    addQueue(cube, "2026 UCI ProSeries", 2026, races);
    addCapture(cube, file([parisTours]));
    const lines = queueStatus(cube);
    const pt = lines.find((l) => l.uciId === 78462)!;
    expect(pt).toMatchObject({ captured: true, rows: 3, classifications: 1 });
    expect(lines.filter((l) => l.captured)).toHaveLength(1);
  });
  it("a race that was opened but had no point-scoring rows does not count as captured", () => {
    const cube = emptyCube();
    addQueue(cube, "hub", 2026, races);
    addCapture(cube, file([{ ...parisTours, classifications: [{ label: "Final Classification", title: "x", totalRows: 10, rows: [] }] }]));
    expect(queueStatus(cube).find((l) => l.uciId === 78462)!.captured).toBe(false);
  });
});

describe("the queue grouped by race across years", () => {
  const cube = emptyCube();
  addQueue(cube, "2026 UCI ProSeries", 2026, [{ uciId: 78462, name: "Paris - Tours Elite", start: "2026-10-11", end: "2026-10-11", country: "FRA" }]);
  addQueue(cube, "2025 UCI ProSeries", 2025, [{ uciId: 70001, name: "Paris-Tours", start: "2025-10-12", end: "2025-10-12", country: "FRA" }]);
  addQueue(cube, "2026 UCI WorldTour", 2026, [{ uciId: 78500, name: "Strade Bianche", start: "2026-03-07", end: "2026-03-07", country: "ITA" }]);
  addQueue(cube, "2026 UCI Women's WorldTour", 2026, [{ uciId: 78501, name: "Strade Bianche Women", start: "2026-03-07", end: "2026-03-07", country: "ITA" }]);
  addCapture(cube, file([parisTours]));
  const g = queueByRace(cube);

  it("puts the editions of one race on one row, even when the name is written differently", () => {
    const pt = g.races.find((r) => r.name.startsWith("Paris"))!;
    expect(Object.keys(pt.editions).map(Number).sort()).toEqual([2025, 2026]);
    expect(pt.editions[2026]!.captured).toBe(true);
    expect(pt.editions[2025]!.captured).toBe(false);
    expect(pt.name).toBe("Paris - Tours Elite"); // the newest year's name
  });
  it("keeps men's and women's races apart and lists the years newest first", () => {
    expect(g.races.filter((r) => r.name.startsWith("Strade Bianche")).map((r) => r.category).sort()).toEqual(["ME", "WE"]);
    expect(g.years).toEqual([2026, 2025]);
  });
});

describe("race names from UCI", () => {
  it("drops the Men / Women suffix and nothing else", () => {
    expect(cleanRaceName("Mapei Cadel Evans Great Ocean Road Race - Men")).toBe("Mapei Cadel Evans Great Ocean Road Race");
    expect(cleanRaceName("Strade Bianche Women")).toBe("Strade Bianche Women");
    expect(cleanRaceName("Paris - Tours Elite")).toBe("Paris - Tours Elite");
  });
  it("the grouped queue shows the cleaned name", () => {
    const c = emptyCube();
    addQueue(c, "2027 UCI WorldTour", 2027, [{ uciId: 79671, name: "Mapei Cadel Evans Great Ocean Road Race - Men", start: "2027-01-31", end: "2027-01-31", country: "AUS" }]);
    expect(queueByRace(c).races[0]!.name).toBe("Mapei Cadel Evans Great Ocean Road Race");
  });
});
