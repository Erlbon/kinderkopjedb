import { describe, expect, it } from "vitest";
import { Edition, FoundPost, editionQueries, matchEdition, normName, readTitle } from "../src/core/thread-match";

const post = (id: string, title: string, createdAt: string): FoundPost => ({
  id,
  title,
  createdAt,
  permalink: "/r/peloton/comments/" + id + "/x/",
});

const strade: Edition = { name: "Strade Bianche", year: 2026, class: "1.UWT", start: "2026-03-07", end: "2026-03-07" };

const tdf: Edition = {
  name: "Tour de France",
  aliases: ["Le Tour de France"],
  year: 2026,
  class: "2.UWT",
  start: "2026-07-04",
  end: "2026-07-26",
  stages: [
    { n: 5, date: "2026-07-08" },
    { n: 6, date: "2026-07-09" },
    { n: 7, date: "2026-07-10" },
  ],
};

describe("readTitle", () => {
  it("reads the titles the profile writes", () => {
    expect(readTitle("[Race Thread] 2026 Tour de France – Stage 6 (2.UWT)")).toMatchObject({ kind: "stage", stage: 6, year: 2026, name: "Tour de France" });
    expect(readTitle("[Race Thread] 2026 Strade Bianche ME (1.UWT)")).toMatchObject({ kind: "race", year: 2026, name: "Strade Bianche", category: "ME" });
    expect(readTitle("[Race Thread] 2019 Giro d'Italia Rest Day 1")).toMatchObject({ kind: "rest", year: 2019 });
  });

  it("takes older titles: year after the name, stage without a dash", () => {
    expect(readTitle("[Race Thread] Tour de France 2023 Stage 12 (2.UWT)")).toMatchObject({ kind: "stage", stage: 12, year: 2023, name: "Tour de France" });
    expect(readTitle("[Race Thread] 2025 Tour de Romandie – Prologue (2.UWT)")).toMatchObject({ kind: "stage", stage: 0, name: "Tour de Romandie" });
  });

  it("knows a women's race by its title", () => {
    expect(readTitle("[Race Thread] 2024 Strade Bianche 1.WWT")?.category).toBe("WE");
    expect(readTitle("[Race Thread] 2025 Tour de France Femmes – Stage 2 (2.WWT)")?.category).toBe("WE");
  });

  it("reads the team presentation and zero-padded stages (as on r/peloton in 2024)", () => {
    expect(readTitle("[Race Thread] 2024 Tour de France – Team Presentation")).toMatchObject({ kind: "presentation", name: "Tour de France" });
    expect(readTitle("[Race Thread] 2025 Tour de France Team Presentation")).toMatchObject({ kind: "presentation", name: "Tour de France" });
    expect(readTitle("[Race Thread] 2024 Tour de France – Stage 01 (2.UWT)")).toMatchObject({ kind: "stage", stage: 1 });
  });

  it("is not a race thread without the tag", () => {
    expect(readTitle("[Post Race] 2026 Strade Bianche")).toBeUndefined();
  });
});

describe("editionQueries", () => {
  it("searches every name once, r/peloton's own first", () => {
    expect(editionQueries({ ...strade, aliases: ["Strade Bianche"] })).toEqual(['"Strade Bianche" 2026']);
    expect(editionQueries(tdf)).toEqual(['"Le Tour de France" 2026', '"Tour de France" 2026']);
  });
});

describe("matchEdition", () => {
  it("finds a one-day race posted the day before", () => {
    const m = matchEdition(strade, [post("a", "[Race Thread] 2026 Strade Bianche ME (1.UWT)", "2026-03-06T21:00:00Z")]);
    expect(m.threads.map((t) => t.post.id)).toEqual(["a"]);
    expect(m.missingRace).toBe(false);
  });

  it("finds stage threads and lists the stages it did not find", () => {
    const m = matchEdition(tdf, [
      post("s6", "[Race Thread] 2026 Tour de France – Stage 6 (2.UWT)", "2026-07-08T20:00:00Z"),
      post("s5", "[Race Thread] 2026 Tour de France – Stage 5 (2.UWT)", "2026-07-07T20:00:00Z"),
    ]);
    expect(m.threads.map((t) => t.stage)).toEqual([5, 6]);
    expect(m.missingStages).toEqual([7]);
  });

  it("keeps the first thread when a stage was posted twice", () => {
    const m = matchEdition(tdf, [
      post("late", "[Race Thread] 2026 Tour de France – Stage 6 (2.UWT)", "2026-07-09T08:00:00Z"),
      post("early", "[Race Thread] 2026 Tour de France – Stage 6 (2.UWT)", "2026-07-08T20:00:00Z"),
    ]);
    expect(m.threads.map((t) => t.post.id)).toEqual(["early"]);
  });

  it("leaves out other years, other races, the women's race and other post types", () => {
    const m = matchEdition(tdf, [
      post("y", "[Race Thread] 2025 Tour de France – Stage 6 (2.UWT)", "2026-07-08T20:00:00Z"),
      post("f", "[Race Thread] 2026 Tour de France Femmes – Stage 6 (2.WWT)", "2026-07-08T20:00:00Z"),
      post("g", "[Race Thread] 2026 Giro d'Italia – Stage 6 (2.UWT)", "2026-07-08T20:00:00Z"),
      post("p", "[Post Race] 2026 Tour de France – Stage 6", "2026-07-09T18:00:00Z"),
    ]);
    expect(m.threads).toEqual([]);
  });

  it("takes the year from the post date when the title has none (Paris-Nice 2025)", () => {
    const pn: Edition = {
      name: "Paris-Nice",
      year: 2025,
      class: "2.UWT",
      start: "2025-03-09",
      end: "2025-03-16",
      stages: [
        { n: 3, date: "2025-03-11" },
        { n: 8, date: "2025-03-16" },
      ],
    };
    const m = matchEdition(pn, [
      post("3", "[Race Thread] Paris-Nice - Stage 3 (TTT) (2.UWT)", "2025-03-11T07:01:00Z"),
      post("8", "[Race Thread] Paris-Nice - Stage 8 (final) (2.UWT)", "2025-03-16T07:01:00Z"),
      post("old", "[Race Thread] Paris-Nice - Stage 3 (2.UWT)", "2024-03-05T07:01:00Z"),
    ]);
    expect(m.threads.map((t) => t.post.id)).toEqual(["3", "8"]);
    expect(m.missingStages).toEqual([]);
  });

  it("keeps the team presentation apart from the overall thread", () => {
    const m = matchEdition(tdf, [
      post("tp", "[Race Thread] 2026 Tour de France – Team Presentation", "2026-07-02T16:30:00Z"),
      post("all", "[Race Thread] 2026 Tour de France (2.UWT) – overall", "2026-07-03T08:00:00Z"),
    ]);
    expect(m.threads.map((t) => t.kind + ":" + t.post.id)).toEqual(["presentation:tp", "race:all"]);
  });

  it("lists the race threads it could not use, so a miss can be explained", () => {
    const m = matchEdition(strade, [
      post("o", "[Race Thread] 2026 Omloop Het Nieuwsblad (1.UWT)", "2026-02-28T08:00:00Z"),
      post("z", "[Post Race] 2026 Strade Bianche", "2026-03-07T18:00:00Z"),
    ]);
    expect(m.missingRace).toBe(true);
    expect(m.otherTitles.map((o) => o.title)).toEqual(["[Race Thread] 2026 Omloop Het Nieuwsblad (1.UWT)"]);
  });

  it("shows a thread whose date does not fit, without using it", () => {
    const m = matchEdition(tdf, [post("x", "[Race Thread] 2026 Tour de France – Stage 6 (2.UWT)", "2026-07-20T20:00:00Z")]);
    expect(m.threads).toEqual([]);
    expect(m.outsideDates.map((p) => p.id)).toEqual(["x"]);
  });

  it("matches a name by alias, ignoring accents and dashes", () => {
    const lbl: Edition = { name: "Liège-Bastogne-Liège", year: 2025, class: "1.UWT", start: "2025-04-27", end: "2025-04-27" };
    const m = matchEdition(lbl, [post("l", "[Race Thread] 2025 Liege–Bastogne–Liege (1.UWT)", "2025-04-26T20:00:00Z")]);
    expect(m.threads).toHaveLength(1);
    const flanders: Edition = { name: "Ronde van Vlaanderen", aliases: ["Tour of Flanders"], year: 2025, class: "1.UWT", start: "2025-04-06", end: "2025-04-06" };
    expect(matchEdition(flanders, [post("f", "[Race Thread] 2025 Tour of Flanders ME (1.UWT)", "2025-04-05T20:00:00Z")]).threads).toHaveLength(1);
    expect(normName("Liège–Bastogne–Liège")).toBe("liege bastogne liege");
  });
});
