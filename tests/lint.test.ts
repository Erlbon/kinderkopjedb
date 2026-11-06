import { describe, expect, it } from "vitest";
import { lintThread } from "../src/core/lint";

describe("thread check", () => {
  it("finds the mistakes seen in real threads", () => {
    const body = [
      "|Information| [Official Site](https://www.rondevanvlaanderen.be/en) / [Roadbook]() |",
      "|TV| [Official live broadcasters list](https://www.letour.fr/en/#) |",
      "|Live Trackers| [Tissot](https://www.tissottiming.com/2025/vue/route) |",
      "Let me know if you'd like a version with more punchlines.",
    ].join(String.fromCharCode(10));
    expect(lintThread(body, 2026)).toEqual([
      "empty link: [Roadbook]()",
      "placeholder link: [Official live broadcasters list](https://www.letour.fr/en/#)",
      "link has 2025 in its address, not 2026: [Tissot]",
      'text looks like assistant boilerplate: "Let me know if you\'d like"',
    ]);
  });

  it("leaves good links alone: this year, dates, numbers with more digits", () => {
    const body =
      "[PCS](https://www.procyclingstats.com/race/tour-de-france/2026/stage-6/live) / " +
      "[CEST](https://www.timeanddate.com/worldclock/fixedtime.html?iso=20260709T1025&p1=1440) / " +
      "[Profile](https://firstcycling.com/img/ritt_etapper/2026_17_6.png) / [Discord](https://discord.gg/RgBftaX)";
    expect(lintThread(body, 2026)).toEqual([]);
  });
});
