import { describe, expect, it } from "vitest";
import { converterUrl, euSummer, zoneFor } from "../src/core/timezone";

describe("time zones", () => {
  it("EU summer time runs from the last Sunday of March to the last Sunday of October", () => {
    expect(euSummer("2026-03-28")).toBe(false);
    expect(euSummer("2026-03-29")).toBe(true); // last Sunday of March 2026
    expect(euSummer("2026-10-24")).toBe(true);
    expect(euSummer("2026-10-25")).toBe(false); // last Sunday of October 2026
  });

  it("CET in July is CEST, CEST in March is CET; other zones stay as given", () => {
    expect(zoneFor("2026-07-09", "CET")).toBe("CEST");
    expect(zoneFor("2026-03-07", "CEST")).toBe("CET");
    expect(zoneFor("2026-08-20", "WET")).toBe("WEST");
    expect(zoneFor("2026-01-21", "ACDT")).toBe("ACDT");
  });

  it("links the start to a page in the reader's time zone, in UTC", () => {
    expect(converterUrl("2026-07-09", "12:25", "CEST")).toBe("https://www.timeanddate.com/worldclock/fixedtime.html?iso=20260709T1025&p1=1440");
    // the UTC time can fall on the day before
    expect(converterUrl("2026-01-21", "09:30", "ACDT")).toBe("https://www.timeanddate.com/worldclock/fixedtime.html?iso=20260120T2300&p1=1440");
    expect(converterUrl("2026-07-09", "12:25", "XYZ")).toBeUndefined();
  });
});
