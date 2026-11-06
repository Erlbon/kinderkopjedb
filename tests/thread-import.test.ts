import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProfile } from "../src/core";
import { parseOldThread, toRegistryEntry } from "../src/core/thread-import";

const NL = String.fromCharCode(10);
const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const profile = parseProfile(read("data/profiles/peloton.yaml"));

describe("the extended monument layout (Paris-Roubaix 2024-2026, Liège 2024)", () => {
  const md = [
    "[Race Thread] 2026 Paris-Roubaix (1.UWT)",
    "|Date|From > To|Length|Profile|Finish|Time|",
    "|:-|:-|:-|:-|:-|:-|",
    "|April 12, 2026|Compiegne > Roubaix|258.3km|Cobbles|Velodrome|11:05 - 16:35 CEST|",
    "",
    "|||",
    "--- | ---",
    "|**Information**|[Official Site](https://www.paris-roubaix.fr/en)",
    "|Startlist| [Men's Startlist](https://firstcycling.com/race.php?r=8&y=2026&k=8)",
    "Weather | [Sunday: Cloudy](https://www.bbc.com/weather/2982681)|",
    "|Interactive Map|[San Luca](https://sanluca.cc/races/x)|",
    "|Men's Articles|[INRNG](https://inrng.com/2026/04/paris-roubaix-2026-preview/)|",
    "|Background|[A Beginners Guide](https://www.globalcyclingnetwork.com/x)|",
    "|Men's Live Trackers|[Official](https://racecenter.paris-roubaix.fr/en/)",
    "|Timeline of sectors|[Cycling news](https://www.cyclingnews.com/x)",
    "|Where to Watch|[List](https://www.paris-roubaix.fr/en/broadcasters)",
    "|Selected Streaming Links| [Eurosport](https://www.eurosport.com/)",
  ].join(NL);

  it("reads every row into the profile's rows", () => {
    const p = parseOldThread(md);
    expect(p.unknownLabels).toEqual([]);
    expect(Object.keys(p.rows).sort()).toEqual(["background", "information", "map", "previews", "sectors", "startlist", "streams", "tracker", "watch", "weather"]);
  });

  it("the profile has a row for each, left out of a thread when empty", () => {
    for (const id of ["startlist", "weather", "map", "background", "sectors", "streams"]) {
      expect(profile.infoRows.find((r) => r.id === id), id).toMatchObject({ optional: true });
    }
  });
});

describe("table layouts", () => {
  it("knows the Profile column of one-day races (Strade 2024 women)", () => {
    const p = parseOldThread(read("tests/fixtures/old-strade-2024-we.md"));
    const r = toRegistryEntry(p, undefined, profile);
    expect(r.entry.table).toBe("profile");
    expect(r.notes.join(" ")).not.toContain("matches no known layout");
  });

  it("takes 'Arrival time' and 'Timing' as the Time column", () => {
    for (const time of ["Arrival time", "Timing"]) {
      const md = ["[Race Thread] 2025 Strade Bianche (1.UWT)", "", "Date | From > To | Length | Profile | Finish | " + time, "--- | --- | --- | --- | --- | ---", "08.03 | Siena > Siena | 213km | Gravel | Uphill | 11:00"].join(NL);
      expect(toRegistryEntry(parseOldThread(md), undefined, profile).entry.table).toBe("profile");
    }
  });
});

describe("registry entries from several years (monuments, 2021-2026)", () => {
  const thread = (year: number, label: string, fc: string) =>
    parseOldThread(
      [
        "[Race Thread] " + year + " Il Lombardia (1.UWT)",
        "|Date|From > To|Length|Type|Finish|Time|",
        "|:-|:-|:-|:-|:-|:-|",
        "|10.10|Bergamo > Como|239km|Hilly|Flat|11:00 - 17:00 CEST|",
        "",
        "|||",
        "|:-|:-|",
        "|Information|[Official](https://www.ilombardia.it/en/) / [Start List](https://firstcycling.com/race.php?r=24&y=" + year + "&k=" + fc + ")|",
        "|" + label + "|[PCS](https://www.procyclingstats.com/race/il-lombardia/" + year + "/result/live)|",
      ].join(NL),
    );

  it("an old 'k=start' start-list link is not a class number", () => {
    expect(toRegistryEntry(thread(2021, "Live Trackers", "start"), undefined, profile).entry.firstcyclingClass).toBeUndefined();
  });

  it("the standard one-day table is known even without its optional Altitude column", () => {
    const r = toRegistryEntry(thread(2026, "Live Trackers", "8"), undefined, profile);
    expect(r.entry.table).toBeUndefined();
    expect(r.notes.join(" ")).not.toContain("matches no known layout");
  });

  it("a layout from an old year is dropped when a newer thread uses the standard one", () => {
    const old = toRegistryEntry(parseOldThread(read("tests/fixtures/old-strade-2024-we.md")), undefined, profile).entry;
    expect(old.table).toBe("profile");
    expect(toRegistryEntry(thread(2026, "Live Trackers", "8"), old, profile).entry.table).toBeUndefined();
  });

  it("a row label from an old year is dropped when a newer thread uses the standard one", () => {
    const old = toRegistryEntry(thread(2022, "Live Tracker", "8"), undefined, profile).entry;
    expect(old.labels).toEqual({ tracker: "Live Tracker" });
    expect(toRegistryEntry(thread(2026, "Live Trackers", "8"), old, profile).entry.labels).toBeUndefined();
  });
});

describe("thread kinds", () => {
  it("keeps what follows the stage number out of the race name", () => {
    for (const title of [
      "[Race Thread] 2025 Tour de France – Stage 5 - ITT (2.UWT)",
      "[Race Thread] 2024 Paris-Nice - Stage 3 TTT (2.UWT)",
      "[Race Thread] 2025 Paris-Nice - Stage 8 (final) (2.UWT)",
    ]) {
      const p = parseOldThread(title);
      expect(p.kind, title).toBe("stage");
      expect(p.klass, title).toBe("2.UWT");
      expect(["Tour de France", "Paris-Nice"], title).toContain(p.name);
    }
  });

  it("knows a team presentation thread, with or without a dash", () => {
    expect(parseOldThread("[Race Thread] 2024 Tour de France – Team Presentation")).toMatchObject({ kind: "presentation", name: "Tour de France" });
    expect(parseOldThread("[Race Thread] 2025 Tour de France Team Presentation")).toMatchObject({ kind: "presentation", name: "Tour de France" });
  });
});

describe("row labels as r/peloton threads write them", () => {
  it("reads ticker, TV & Streams and Live coverage rows, and the 'Outlet type' header", () => {
    const md = [
      "[Race Thread] 2024 Paris-Nice - Stage 4 (2.UWT)",
      "",
      "Outlet type | Links",
      "--- | ---",
      "Information | [Official website](https://www.paris-nice.fr/en/)",
      "Live coverage | Begins @ 3.45 pm CET",
      "Live ticker | [PCS](https://www.procyclingstats.com/race/paris-nice/2024/stage-4/live)",
      "TV & Streams | [Eurosport](https://www.eurosport.com/)",
    ].join(NL);
    const p = parseOldThread(md);
    expect(Object.keys(p.rows).sort()).toEqual(["coverage", "information", "tracker", "watch"]);
    expect(p.unknownLabels).toEqual([]);
  });

  it("drops a trailing colon and knows the one-word tracker spellings", () => {
    const md = [
      "[Race Thread] 2023 Strade Bianche Men (1.UWT)",
      "|||",
      "|-|-|",
      "|Information:|[Official Site](https://www.strade-bianche.it/en/)|",
      "|Livetrackers|[PCS](https://www.procyclingstats.com/race/strade-bianche/2023/result/live)|",
      "|Livetickers|[Sporza](https://sporza.be/)|",
    ].join(NL);
    const p = parseOldThread(md);
    expect(p.rows.information).toBeDefined();
    expect(p.rows.tracker).toEqual([
      { text: "PCS", url: "https://www.procyclingstats.com/race/strade-bianche/2023/result/live" },
      { text: "Sporza", url: "https://sporza.be/" },
    ]);
    expect(p.unknownLabels).toEqual([]);
  });
});
