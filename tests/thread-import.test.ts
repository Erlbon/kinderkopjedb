import { describe, expect, it } from "vitest";
import { parseOldThread } from "../src/core/thread-import";

const NL = String.fromCharCode(10);

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
