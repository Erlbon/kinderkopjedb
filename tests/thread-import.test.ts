import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProfile } from "../src/core";
import { parseOldThread, toRegistryEntry } from "../src/core/thread-import";

const NL = String.fromCharCode(10);
const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const profile = parseProfile(read("data/profiles/peloton.yaml"));

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
