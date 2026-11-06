import { describe, expect, it } from "vitest";
import { applyLearned, lastYearHints, learnFromYears } from "../src/core/learn";
import { parseOldThread } from "../src/core/thread-import";
import type { RegistryRace } from "../src/core/types";

const NL = String.fromCharCode(10);

/** A different id per thread, like an imgur or Google Drive id (no year or stage inside). */
const id = (year: number, stage: number) => "q" + "abcdefghij"[year % 10] + "klmnopqrstuvwxyz"[stage % 16];

/** A Tour stage thread shaped like the 2023-2025 r/peloton ones. */
function tour(year: number, stage: number, extra = ""): string {
  return [
    "[Race Thread] " + year + " Tour de France – Stage " + stage + " (2.UWT)",
    "| Date | Stage | Route | Length | Type | Altitude | Time |",
    "|---|---|---|---|---|---|---|",
    "|x|[" + stage + "](https://www.letour.fr/en/stage-" + stage + ")|[A > B](https://i.imgur.com/" + id(year, stage) + ".jpeg)|186 km|[Hard](https://firstcycling.com/img/ritt_etapper/" + year + "_17_" + stage + ".png)|3978 m|12:25-17:46 CEST|",
    "",
    "|||",
    "|-|-|",
    "|Information| [Official Site](https://www.letour.fr/en/) / [Startlist FC](https://firstcycling.com/race.php?r=17&y=" + year + "&k=8) / [Roadbook](https://drive.google.com/file/d/" + id(year, 0) + "/view)",
    "|Social Media|[Instagram](https://www.instagram.com/letourdefrance/)",
    "|Overall Previews|[CyclingNews](https://www.cyclingnews.com/tour-de-france/) / [INRNG](https://inrng.com/" + year + "/06/tour-de-france-" + year + "-guide/)",
    "|/r/peloton content| [Cheat Notes](https://www.reddit.com/r/peloton/comments/abc" + year + "/cheat_notes/)",
    "|Live Trackers| [Official](https://racecenter.letour.fr/en/) / [Tissot](https://www.tissottiming.com/" + year + "/tdf/en-gb)" + extra,
  ].join(NL);
}

describe("learning from two or more years", () => {
  const threads = [tour(2023, 6), tour(2023, 7), tour(2024, 6, " / [Velon](https://racecentre.velon.cc/)")].map(parseOldThread);
  const learned = learnFromYears(threads);
  const byUrl = (u: string) => learned.links.find((l) => l.url === u);

  it("keeps links that are the same in both years", () => {
    expect(byUrl("https://racecenter.letour.fr/en/")).toMatchObject({ row: "tracker", text: "Official", kind: "stable", years: [2023, 2024] });
    expect(byUrl("https://www.cyclingnews.com/tour-de-france/")).toMatchObject({ row: "previews", kind: "stable" });
  });

  it("turns links that differ only by year into patterns", () => {
    expect(byUrl("https://www.tissottiming.com/{year}/tdf/en-gb")).toMatchObject({ row: "tracker", kind: "pattern" });
    expect(byUrl("https://inrng.com/{year}/06/tour-de-france-{year}-guide/")).toMatchObject({ row: "previews", kind: "pattern" });
  });

  it("leaves out one-year links, ids handled elsewhere and the r/peloton posts", () => {
    const urls = learned.links.map((l) => l.url).join(" ");
    expect(urls).not.toContain("velon"); // 2024 only
    expect(urls).not.toContain("drive.google"); // a new roadbook each year
    expect(urls).not.toContain("firstcycling.com/race.php"); // built from the FirstCycling id
    expect(urls).not.toContain("letour.fr/en/\""); // the official site has its own field
    expect(urls).not.toContain("reddit.com");
    expect(urls).not.toContain("instagram");
  });

  it("learns the stage-table patterns", () => {
    expect(learned.cells).toEqual(
      expect.arrayContaining([
        { field: "stage", url: "https://www.letour.fr/en/stage-{stage}", years: [2023, 2024] },
        { field: "type", url: "https://firstcycling.com/img/ritt_etapper/{year}_17_{stage}.png", years: [2023, 2024] },
      ]),
    );
    expect(learned.cells.find((c) => c.field === "route")).toBeUndefined(); // a new image each stage
  });

  it("adds what is new to a registry entry and says so; nothing twice", () => {
    const entry: RegistryRace = { name: "Tour de France", category: "ME", links: [{ row: "tracker", text: "Official", url: "https://racecenter.letour.fr/en" }] };
    const said = applyLearned(entry, learned);
    expect(entry.links!.filter((l) => l.url.includes("racecenter"))).toHaveLength(1);
    expect(entry.cells?.stage).toBe("https://www.letour.fr/en/stage-{stage}");
    expect(said.some((s) => s.startsWith("tracker: Tissot"))).toBe(true);
    expect(applyLearned(entry, learned)).toEqual([]);
  });

  it("lists what belonged to the newest edition only, to be replaced in the next", () => {
    const h = lastYearHints(threads, learned)!;
    expect(h.year).toBe(2024);
    const row = (r: string) => h.rows.find((x) => x.row === r)?.links.map((l) => l.text);
    expect(row("information")).toEqual(["Roadbook"]); // the official site and start list carry over
    expect(row("content")).toEqual(["Cheat Notes"]);
    expect(row("tracker")).toEqual(["Velon"]); // race centre and Tissot are lasting
    expect(row("previews")).toBeUndefined(); // CyclingNews is stable, INRNG a pattern
  });

  it("in a stage race, a link in one stage thread only is that stage's, not the edition's", () => {
    const ts = [tour(2025, 1), tour(2025, 2, " / [Stage 2 extra](https://example.com/s2)"), tour(2025, 3)].map(parseOldThread);
    const h = lastYearHints(ts)!;
    expect(h.rows.find((x) => x.row === "tracker")!.links.map((l) => l.text)).toEqual(["Official", "Tissot"]);
  });

  it("a link no longer used in the newest year is not lasting (an old Twitter account)", () => {
    const ts = [
      tour(2021, 6, " / [Official Twitter](https://twitter.com/LeTour)"),
      tour(2022, 6, " / [Official Twitter](https://twitter.com/LeTour)"),
      tour(2023, 6),
    ].map(parseOldThread);
    const urls = learnFromYears(ts).links.map((l) => l.url).join(" ");
    expect(urls).not.toContain("twitter");
    expect(urls).toContain("racecenter.letour.fr");
  });

  it("one year alone teaches nothing", () => {
    expect(learnFromYears([tour(2025, 1), tour(2025, 2)].map(parseOldThread))).toEqual({ links: [], cells: [] });
  });
});
