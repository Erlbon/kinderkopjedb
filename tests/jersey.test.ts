import { describe, expect, it } from "vitest";
import { competitionPagePath, decodeWorkList, encodeWorkList, eventPagePath, jerseyKind, missingJerseyEvents, nextPageToOpen, racePages, workListFromHash } from "../src/core";

describe("the jersey pages that pay points", () => {
  it("tells the leader pages and the final points and mountain pages from everything else", () => {
    expect(jerseyKind("Stage 5: Stage General Classification")).toBe("leader");
    expect(jerseyKind("Final Classification: Points Classification")).toBe("final");
    expect(jerseyKind("Final Classification: Mountain Classification")).toBe("final");
    expect(jerseyKind("Final Classification: Mountains Classification")).toBe("final");
    for (const n of ["Stage 5: Stage Classification", "Stage 5: Stage Points Classification", "Stage 5: Overall Points Classification", "Stage 5: Stage Youth Classification", "Final Classification: General Classification", "Final Classification: Youth Classification", "General Classification"]) {
      expect(jerseyKind(n), n).toBeUndefined();
    }
  });

  const events = [
    { id: 1, name: "Stage 1: Stage Classification" },
    { id: 12, name: "Stage 12: Stage General Classification" },
    { id: 2, name: "Stage 2: Stage General Classification" },
    { id: 3, name: "Stage 1: Stage General Classification" },
    { id: 9, name: "Final Classification: Points Classification" },
    { id: 10, name: "Final Classification: Mountain Classification" },
    { id: 11, name: "Final Classification: Youth Classification" },
  ];

  it("lists only the pages not captured yet, leaders in stage order", () => {
    const m = missingJerseyEvents(events, [2]);
    expect(m.results.map((e) => e.id)).toEqual([1]);
    expect(m.leader.map((e) => e.id)).toEqual([3, 12]);
    expect(m.final.map((e) => e.id)).toEqual([10, 9]);
  });

  it("lists nothing when every page is captured, whether or not it scored", () => {
    const m = missingJerseyEvents(events, [2, 3, 12, 9, 10]);
    expect(m.leader).toEqual([]);
    expect(m.final).toEqual([]);
  });

  it("builds the address the competition page itself links to", () => {
    expect(eventPagePath(76406, 366957)).toBe("/iframe/EventResults/366957?competitionId=76406&disciplineId=10");
  });
});

describe("the next page to open after a capture", () => {
  const comp = (id: number, name: string, inProgress = false) => ({ id, name, start: "2026-10-01", end: "2026-10-01", year: 2026, country: "ITA", class: "1.Pro", inProgress });
  const stageRace = {
    competitionId: 2,
    events: [
      { id: 21, name: "Stage 1: Stage Classification" },
      { id: 22, name: "Stage 1: Stage General Classification" },
      { id: 23, name: "Final Classification: General Classification" },
      { id: 24, name: "Final Classification: Youth Classification" },
    ],
  };
  const collection = {
    competitions: [comp(1, "Giro del Veneto"), comp(2, "Tour of Guangxi"), comp(3, "Veneto Women", true), comp(4, "Paris-Tours")],
    competitionEvents: [stageRace],
    eventResults: [] as { competitionId: number; eventId: number }[],
  };

  it("stays in the race it came from first: results, then leader, then final pages", () => {
    expect(nextPageToOpen(collection, 2)).toEqual({ path: eventPagePath(2, 23), label: "Tour of Guangxi: Final Classification: General Classification" });
    expect(nextPageToOpen({ ...collection, eventResults: [{ competitionId: 2, eventId: 23 }] }, 2)?.path).toBe(eventPagePath(2, 21));
    const done = { ...collection, eventResults: [21, 23].map((eventId) => ({ competitionId: 2, eventId })) };
    expect(nextPageToOpen(done, 2)?.path).toBe(eventPagePath(2, 22));
  });

  const done = { ...collection, eventResults: [21, 22, 23].map((eventId) => ({ competitionId: 2, eventId })) };
  const none = { competitions: [], events: [] };

  it("without a work list from the queue it stays in this race: the bookmark's own list holds races of every class", () => {
    expect(nextPageToOpen(done, 2)).toBeUndefined();
    expect(nextPageToOpen(collection, 2, { competitions: [], events: [21] })?.path).toBe(eventPagePath(2, 23));
  });

  it("with a work list it goes on to the next race of the list after this one, and only to those", () => {
    const work = [
      { c: 4, name: "Paris-Tours 2026", events: [41, 42] },
      { c: 2, name: "Tour of Guangxi 2026" },
      { c: 7, name: "Il Lombardia 2026" },
    ];
    expect(nextPageToOpen(done, 2, none, work)).toEqual({ path: competitionPagePath(7), label: "Il Lombardia 2026" });
    expect(nextPageToOpen(done, 2, { competitions: [7], events: [] }, work)).toEqual({ path: eventPagePath(4, 41), label: "Paris-Tours 2026: 2 pages still to capture" });
    // a page the database or this browser already has is not opened again
    const got41 = { ...done, eventResults: [...done.eventResults, { competitionId: 4, eventId: 41 }] };
    expect(nextPageToOpen(got41, 2, { competitions: [7], events: [] }, work)?.path).toBe(eventPagePath(4, 42));
    expect(nextPageToOpen(done, 2, { competitions: [4, 7], events: [] }, work)).toBeUndefined();
  });

  it("finishes the race it came from first, also when that race is not in the work list", () => {
    expect(nextPageToOpen(collection, 2, none, [{ c: 4, name: "Paris-Tours 2026", events: [41] }])?.path).toBe(eventPagePath(2, 23));
  });

  it("the pages of one race: the work list's when it has them, else this browser's event list, else its competition page", () => {
    expect(racePages(collection, 4, { c: 4, name: "x", events: [41, 42] })).toEqual({ competitionPage: false, events: [41, 42] });
    expect(racePages(collection, 2)).toEqual({ competitionPage: false, events: [23, 21, 22] });
    expect(racePages(collection, 9)).toEqual({ competitionPage: true, events: [] });
  });

  it("the work list survives the trip through a link", () => {
    const work = [
      { c: 4, name: "Paris~Tours, 2026 #1", events: [41, 42] },
      { c: 7, name: "Il Lombardia 2026" },
    ];
    const text = encodeWorkList(work);
    expect(decodeWorkList(text)).toEqual([{ c: 4, name: "Paris Tours  2026 #1", events: [41, 42] }, { c: 7, name: "Il Lombardia 2026" }]);
    expect(workListFromHash("#kdb=" + encodeURIComponent(text))).toEqual(decodeWorkList(text));
    expect(workListFromHash("")).toBeUndefined();
  });

  it("builds the address the competition list itself links to", () => {
    expect(competitionPagePath(77536)).toBe("/iframe/CompetitionResults/77536?disciplineId=10");
  });
});
