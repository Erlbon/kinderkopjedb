import { describe, expect, it } from "vitest";
import { expandPattern, toPattern } from "../src/core/patterns";

describe("link patterns", () => {
  it("fills in year, date and stage", () => {
    const v = { year: 2026, date: "2026-07-09", stage: 6 };
    expect(expandPattern("https://www.letour.fr/en/stage-{stage}", v)).toBe("https://www.letour.fr/en/stage-6");
    expect(expandPattern("https://firstcycling.com/img/ritt_etapper/{year}_17_{stage2}.jpg", v)).toBe("https://firstcycling.com/img/ritt_etapper/2026_17_06.jpg");
    expect(expandPattern("https://coursedujour.com/day/{date}/", v)).toBe("https://coursedujour.com/day/2026-07-09/");
    expect(expandPattern("https://inrng.com/{year}/06/x-{yy}", v)).toBe("https://inrng.com/2026/06/x-26");
  });

  it("leaves out a stage link on a one-day race", () => {
    expect(expandPattern("https://www.letour.fr/en/stage-{stage}", { year: 2026, date: "2026-03-07" })).toBeUndefined();
  });

  it("learns the patterns seen in the 2023-2025 Tour threads", () => {
    expect(toPattern("https://www.letour.fr/en/stage-6", { year: 2025, date: "2025-07-10", stage: 6 })).toBe("https://www.letour.fr/en/stage-{stage}");
    expect(toPattern("https://firstcycling.com/img/ritt_etapper/2025_17_6.png", { year: 2025, stage: 6 })).toBe("https://firstcycling.com/img/ritt_etapper/{year}_17_{stage}.png");
    expect(toPattern("https://firstcycling.com/img/ritt_etapper/2023_17_06.jpg", { year: 2023, stage: 6 })).toBe("https://firstcycling.com/img/ritt_etapper/{year}_17_{stage2}.jpg");
    // stage 17 of a race whose FirstCycling id is 17: only the last number is the stage
    expect(toPattern("https://firstcycling.com/img/ritt_etapper/2025_17_17.png", { year: 2025, stage: 17 })).toBe("https://firstcycling.com/img/ritt_etapper/{year}_17_{stage}.png");
    expect(toPattern("https://sanluca.cc/road/men/aa33eb/2023/4/", { year: 2023, stage: 4 })).toBe("https://sanluca.cc/road/men/aa33eb/{year}/{stage}/");
    expect(toPattern("https://www.tissottiming.com/2024/tdf/en-gb", { year: 2024, stage: 3 })).toBe("https://www.tissottiming.com/{year}/tdf/en-gb");
  });

  it("does not take an id for a stage number", () => {
    expect(toPattern("https://i.imgur.com/6/abc", { year: 2025, stage: 6 })).toBe("https://i.imgur.com/6/abc");
    expect(toPattern("https://dailymotion.com/playlist/x7r8wb", { year: 2024, stage: 7 })).toBe("https://dailymotion.com/playlist/x7r8wb");
  });
});
