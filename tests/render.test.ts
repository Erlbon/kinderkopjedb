import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SeasonError,
  classWarnings,
  draftSeason,
  lookupRace,
  parseClasses,
  parseIcs,
  parseMarkdownStages,
  parseOldThread,
  parseProfile,
  parseRegistry,
  parseSeason,
  parseStageTable,
  renderSeason,
  seasonToYaml,
  toRegistryEntry,
  typeFromAltitude,
} from "../src/core";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const profile = parseProfile(read("data/profiles/peloton.yaml"));
const registry = parseRegistry(read("data/peloton/races.yaml"));
const season = parseSeason(read("data/peloton/2026-fixtures.yaml"), registry);
const threads = renderSeason(profile, registry, season);
const byId = (id: string) => threads.find((t) => t.id === id)!;

describe("one-day race (Strade Bianche 2026 men)", () => {
  const t = byId("strade-bianche-me");
  it("title", () => expect(t.title).toBe("[Race Thread] 2026 Strade Bianche ME (1.UWT)"));
  it("route table", () => {
    expect(t.body).toContain("|Date|From > To|Length|Type|Finish|Time|");
    expect(t.body).toContain(
      "|07.03|[Siena > Siena](https://www.strade-bianche.it/en/men-route/)|203km|punchy|uphill|11:45 – 16:43 [CET](https://www.timeanddate.com/worldclock/fixedtime.html?iso=20260307T1045&p1=1440)|",
    );
  });
  it("info rows: auto items first, then season items", () => {
    expect(t.body).toContain(
      "|Information|[Official Site](https://www.strade-bianche.it/en/) / " +
        "[Startlist FC](https://firstcycling.com/race.php?r=54&y=2026&k=8) / " +
        "[Roadbook (pdf)](https://www.strade-bianche.it/wp-content/uploads/2026/03/ySovlhtBGkrnv25rykp1_020326-113530.pdf)|",
    );
    expect(t.body).toContain("|Live Trackers|[PCS](https://www.procyclingstats.com/race/strade-bianche/2026/result/live)|");
    expect(t.body).toContain("|Social Media|[Instagram](https://www.instagram.com/strade_bianche) / ");
  });
  it("flags what is still to fill in", () => {
    expect(t.warnings).toEqual([]); // fixture fills everything required
  });
});

describe("stage race (Tour de France 2026)", () => {
  const t = byId("tour-de-france-me-stage-6");
  it("title has no tag and an en dash", () =>
    expect(t.title).toBe("[Race Thread] 2026 Tour de France – Stage 6 (2.UWT)"));
  it("stage table with weekday date and altitude", () => {
    expect(t.body).toContain("|Date|Stage|Route|Length|Type|Altitude|Finish|Time|");
    expect(t.body).toContain("|---:|---|---|---:|---:|---:|---|---|");
    expect(t.body).toContain(
      // July: the registry's CET becomes CEST by itself
      "|Thu. 09/07|[6](https://www.letour.fr/en/stage-6)|[Pau > Gavarnie-Gèdre](https://tourview.pages.dev/tdf2026/stage-6)|186km|Hard|3978m|Uphill|12:25-17:46 [CEST](https://www.timeanddate.com/worldclock/fixedtime.html?iso=20260709T1025&p1=1440)|",
    );
  });
  it("race-level and stage-level info merge", () => {
    expect(t.body).toContain("|Previews|[INRNG](");
    expect(t.body).toContain("|Live Trackers|[Official](https://racecenter.letour.fr/en/) / [Tissot]");
  });
  it("fills everything the fixture provides", () => {
    expect(t.body).toContain("|Where to watch|[CourseDeJour]");
    expect(t.warnings).toEqual([]);
  });
  it("missing values become TBC and are reported", () => {
    const bare = parseSeason(
      ["season: 2026", "races:", "  - race: strade-bianche-we", "    class: 1.WWT", "    date: 2026-03-07"].join(
        String.fromCharCode(10),
      ),
      registry,
    );
    const w = renderSeason(profile, registry, bare)[0]!;
    expect(w.body).toContain("|07.03|TBC|TBC|TBC|TBC|TBC|");
    expect(w.body).toContain("|Previews|TBC|");
    expect(w.warnings).toEqual(
      expect.arrayContaining(["route: route (from > to) missing", "Previews: empty", "Where to watch: empty"]),
    );
  });
  it("extra rows and notes are appended", () => {
    const x = parseSeason(
      [
        "season: 2026",
        "races:",
        "  - race: strade-bianche-me",
        "    class: 1.UWT",
        "    date: 2026-03-07",
        "    extra:",
        "      - { label: Cheat Notes, value: [ { text: Notes, url: 'https://example.org/n' } ] }",
        "    notes: Weather looks dry.",
      ].join(String.fromCharCode(10)),
      registry,
    );
    const b = renderSeason(profile, registry, x)[0]!.body;
    expect(b).toContain("|Cheat Notes|[Notes](https://example.org/n)|");
    expect(b.trimEnd().endsWith("Weather looks dry.")).toBe(true);
  });
});

describe("rest day", () => {
  const t = byId("tour-de-france-me-rest-1");
  it("skeleton with footer and a to-do warning", () => {
    expect(t.title).toBe("[Race Thread] 2026 Tour de France Rest Day 1");
    expect(t.body).toContain("procylingdictionary");
    expect(t.warnings).toContain("recap text: write it");
  });
});

describe("thread order", () => {
  it("is by date", () => {
    const dates = threads.map((t) => t.firstDate);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("validation", () => {
  it("reports every problem at once", () => {
    const bad = "season: 2026" + String.fromCharCode(10) + "races:" + String.fromCharCode(10) +
      "  - race: nowhere" + String.fromCharCode(10) + "    date: 2026-13-45" + String.fromCharCode(10);
    try {
      parseSeason(bad, registry);
      throw new Error("should have failed");
    } catch (e) {
      expect(e).toBeInstanceOf(SeasonError);
      const msg = (e as SeasonError).errors.join(" | ");
      expect(msg).toContain("no name");
      expect(msg).toContain("class");
      expect(msg).toContain("ISO");
    }
  });
});

describe("classifications", () => {
  const classes = parseClasses(read("data/classes.yaml"));
  it("loads the table with string codes", () => {
    expect(classes.map((c) => c.code)).toEqual(
      expect.arrayContaining(["1.UWT", "2.WWT", "1.Pro", "1.1", "2.1", "1.2", "2.2"]),
    );
    expect(classes.every((c) => typeof c.code === "string")).toBe(true);
  });
  it("an unquoted class like 1.1 in a season is read as text", () => {
    const s = parseSeason(
      ["season: 2026", "races:", "  - race: strade-bianche-me", "    class: 1.1", "    date: 2026-03-07"].join(
        String.fromCharCode(10),
      ),
      registry,
    );
    expect(s.races[0]!.class).toBe("1.1");
  });
  it("flags unknown classes and kind mismatches", () => {
    expect(classWarnings("1.UWT", false, classes)).toEqual([]);
    expect(classWarnings("9.X", false, classes)[0]).toContain("not in data/classes.yaml");
    expect(classWarnings("1.UWT", true, classes)[0]).toContain("one-day class but the race has stages");
    expect(classWarnings("2.UWT", false, classes)[0]).toContain("stage-race class but the race has no stages");
  });
  it("renderSeason adds class warnings to the thread", () => {
    const bad = parseSeason(
      ["season: 2026", "races:", "  - race: strade-bianche-me", "    class: 2.UWT", "    date: 2026-03-07"].join(
        String.fromCharCode(10),
      ),
      registry,
    );
    const t = renderSeason(profile, registry, bad, classes)[0]!;
    expect(t.warnings.join(" ")).toContain("stage-race class");
  });
});

describe("iCal draft", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260307",
    "DTEND;VALUE=DATE:20260308",
    "LOCATION:Italy",
    "SUMMARY:Strade Bianche (1.UWT)",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260321",
    "DTEND;VALUE=DATE:20260322",
    "SUMMARY:Milano-Sanremo Donne (1.WWT)",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260307",
    "DTEND;VALUE=DATE:20260314",
    "SUMMARY:Paris-Nice (2.UWT)",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260401",
    "DTEND;VALUE=DATE:20260402",
    "SUMMARY:Small Race (1.2)",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join(String.fromCharCode(13, 10));

  it("reads events with exclusive end dates", () => {
    const ev = parseIcs(ics);
    expect(ev).toHaveLength(4);
    expect(ev[2]).toMatchObject({ start: "2026-03-07", end: "2026-03-13" });
  });
  it("drafts a season: known race via registry, new ones by name, stage race days", () => {
    const s = draftSeason(parseIcs(ics), { year: 2026, registry, classes: ["1.UWT", "2.UWT", "1.WWT", "2.WWT"] });
    expect(s.races).toHaveLength(3);
    expect(s.races[0]).toMatchObject({ race: "strade-bianche-me", class: "1.UWT", date: "2026-03-07" });
    const paris = s.races.find((r) => r.name === "Paris-Nice")!;
    expect(paris.stages).toHaveLength(7);
    const msr = s.races.find((r) => r.category === "WE")!;
    expect(msr.race).toBe("milano-sanremo-donne-we");
  });
  it("a drafted season survives YAML and validates", () => {
    const s = draftSeason(parseIcs(ics), { year: 2026, registry });
    const back = parseSeason(seasonToYaml(s), registry);
    expect(back.races.length).toBe(s.races.length);
  });
});

describe("Wikipedia stage table", () => {
  const wt = read("tests/fixtures/tdf2026-stages.wikitext");
  const d = parseStageTable(wt, 2026);
  it("reads stages with dates, courses, lengths and types", () => {
    expect(d.stages.map((s) => s.n)).toEqual([1, 2, 3, 6, 10]);
    expect(d.stages[0]).toMatchObject({ date: "2026-07-04", from: "Barcelona", to: "Barcelona", length: 19.6, type: "TTT" });
    expect(d.stages[1]).toMatchObject({ from: "Tarragona", to: "Barcelona", length: 169, type: "hilly" });
    expect(d.stages[2]).toMatchObject({ from: "Granollers", to: "Les Angles", type: "mountain" });
    expect(d.stages[3]).toMatchObject({ date: "2026-07-09", from: "Pau", to: "Gavarnie-Gèdre", length: 186, type: "mountain" });
  });
  it("finds rest days", () => expect(d.restDays).toEqual(["2026-07-13", "2026-07-20"]));
  it("returns nothing when the page has no stage table", () => {
    expect(parseStageTable("just text", 2026)).toEqual({ stages: [], restDays: [] });
  });
  it("lookupRace reads official site and Wikipedia link via an injected fetch", async () => {
    const fake = (async (url: string) => {
      const body = String(url).includes("wbsearchentities")
        ? { search: [{ id: "Q1", label: "Strade Bianche", description: "race" }] }
        : { entities: { Q1: { claims: { P856: [{ mainsnak: { datavalue: { value: "https://www.strade-bianche.it/" } } }] }, sitelinks: { enwiki: { url: "https://en.wikipedia.org/wiki/Strade_Bianche" } } } } };
      return { ok: true, json: async () => body } as unknown as Response;
    }) as unknown as typeof fetch;
    const r = await lookupRace("Strade Bianche", fake);
    expect(r[0]).toMatchObject({ officialSite: "https://www.strade-bianche.it/", wikipedia: "https://en.wikipedia.org/wiki/Strade_Bianche" });
  });
});

describe("learning from old threads", () => {
  const men = parseOldThread(read("tests/fixtures/old-strade-2026-me.md"));
  const tdf = parseOldThread(read("tests/fixtures/old-tdf-2026-stage6.md"));
  const women = parseOldThread(read("tests/fixtures/old-strade-2024-we.md"));

  it("reads title parts", () => {
    expect(men).toMatchObject({ year: 2026, name: "Strade Bianche", category: "ME", tag: "ME", klass: "1.UWT", kind: "race" });
    expect(tdf).toMatchObject({ year: 2026, name: "Tour de France", tag: "", klass: "2.UWT", kind: "stage", stage: 6 });
    expect(women).toMatchObject({ year: 2024, name: "Strade Bianche", category: "WE", klass: "1.WWT" });
  });
  it("maps the row labels of different years", () => {
    expect(Object.keys(men.rows).sort()).toEqual(["information", "previews", "social", "tracker", "watch"]);
    expect(Object.keys(tdf.rows).sort()).toEqual(["content", "information", "previews", "social", "tracker", "watch"]);
    expect(Object.keys(women.rows)).toEqual(expect.arrayContaining(["coverage", "watch", "tracker"]));
  });
  it("keeps mixed cells (links plus words) as raw markdown", () => {
    expect(men.rows.watch).toHaveProperty("md");
    expect((men.rows.watch as { md: string }).md).toContain("HBO Max");
  });
  it("men's race: registry entry from the carry-over parts", () => {
    const r = toRegistryEntry(men);
    expect(r.id).toBe("strade-bianche-me");
    expect(r.entry).toMatchObject({
      name: "Strade Bianche",
      category: "ME",
      officialSite: "https://www.strade-bianche.it/en/",
      firstcycling: 54,
      pcs: "strade-bianche",
    });
    expect(r.entry.social?.map((s) => s.text)).toEqual(["Instagram", "Facebook", "Twitter"]);
    // the roadbook is year-specific and stays out of the registry
    expect((r.yearOnly.information as { text: string }[]).map((l) => l.text)).toEqual(["Roadbook (pdf)"]);
    expect(Object.keys(r.yearOnly).sort()).toEqual(["information", "previews", "watch"]);
  });
  it("women's race gets its own ids (different FirstCycling id and PCS slug)", () => {
    const r = toRegistryEntry(women);
    expect(r.id).toBe("strade-bianche-we");
    expect(r.entry).toMatchObject({ firstcycling: 9044, pcs: "strade-bianche-donne", category: "WE" });
  });
  it("a missing tag in an old title is not recorded as 'no tag'", () => {
    expect(toRegistryEntry(women).entry.titleTag).toBeUndefined();
    expect(toRegistryEntry(men).entry.titleTag).toBe("ME");
  });
  it("Tour de France: only clearly stable links carry over; the rest is shown as year-specific", () => {
    const r = toRegistryEntry(tdf, undefined, profile);
    expect(r.entry).toMatchObject({ wikipedia: "https://en.wikipedia.org/wiki/Tour_de_France", firstcycling: 17 });
    expect(r.entry.info).toBeUndefined();
    const yearInfo = r.yearOnly.information as { text: string }[];
    expect(yearInfo.map((l) => l.text)).toEqual(["Startlist", "TourView"]);
    expect(r.entry.social).toHaveLength(6);
  });
  it("Vuelta: remembers its own row label and its stage-first table layout", () => {
    const vuelta = parseOldThread(read("tests/fixtures/old-vuelta-2026-stage21.md"));
    expect(vuelta).toMatchObject({ kind: "stage", stage: 21, name: "Vuelta a España" });
    expect(vuelta.tableHeader.slice(0, 3)).toEqual(["Stage", "Date", "Route"]);
    const r = toRegistryEntry(vuelta, undefined, profile);
    expect(r.entry).toMatchObject({ firstcycling: 23, table: "stage-first", labels: { previews: "Overall Previews" } });
    expect(r.entry.social?.map((x) => x.text)).toContain("Twitch");
    expect(toRegistryEntry(tdf, undefined, profile).entry.table).toBeUndefined(); // TdF uses the default layout
  });
});

describe("table features", () => {
  const mk = (extra: string[]) =>
    parseSeason(["season: 2026", "races:", ...extra].join(String.fromCharCode(10)), registry);
  const stageRace = mk([
    "  - race: tour-de-france-me",
    "    class: 2.UWT",
    "    stages:",
    "      - { n: 21, date: 2026-09-13, from: Granada, to: Granada, length: 99.4, type: Easy, typeUrl: 'https://img.example/t.jpg', altitude: 1311, finish: Flat, finishUrl: 'https://img.example/f.jpg', start: '16:23', end: '19:07' }",
  ]);

  it("links Type and Finish to their profile images", () => {
    const t = renderSeason(profile, registry, stageRace)[0]!;
    expect(t.body).toContain("|[Easy](https://img.example/t.jpg)|1311m|[Flat](https://img.example/f.jpg)|");
  });
  it("named layout: stage first, comma length without unit, month-name date", () => {
    const t = renderSeason(profile, registry, stageRace, undefined, { table: "stage-first" })[0]!;
    expect(t.body).toContain("|Stage|Date|Route|Length|Type|Altitude|Finish|Time|");
    expect(t.body).toContain("|21|Sun. 13.Sep|Granada > Granada|99,4|");
  });
  it("a race can choose its own layout over the default", () => {
    const r = mk([
      "  - race: tour-de-france-me",
      "    class: 2.UWT",
      "    table: stage-first",
      "    stages:",
      "      - { n: 1, date: 2026-07-04 }",
    ]);
    expect(renderSeason(profile, registry, r)[0]!.body).toContain("|Stage|Date|Route|");
  });
  it("one-day altitude column appears only when there is an altitude", () => {
    const without = renderSeason(profile, registry, season)[0]!.body;
    expect(without).not.toContain("Altitude");
    const withAlt = mk(["  - race: strade-bianche-me", "    class: 1.UWT", "    date: 2026-03-07", "    altitude: 2800"]);
    const b = renderSeason(profile, registry, withAlt)[0]!.body;
    expect(b).toContain("|Date|From > To|Length|Altitude|Type|Finish|Time|");
    expect(b).toContain("2800m");
  });
  it("custom columns passed as options override the default layout", () => {
    const t = renderSeason(profile, registry, stageRace, undefined, {
      columns: { stage: [{ header: "Day", field: "date", format: "dd MMM" }, { header: "Km", field: "length", format: "{n}" }] },
    })[0]!;
    expect(t.body).toContain("|Day|Km|");
    expect(t.body).toContain("|13 Sep|99.4|");
  });
  it("row labels can be overridden per race", () => {
    const r = mk([
      "  - race: strade-bianche-me",
      "    class: 1.UWT",
      "    date: 2026-03-07",
      "    labels: { previews: Overall Previews }",
    ]);
    expect(renderSeason(profile, registry, r)[0]!.body).toContain("|Overall Previews|TBC|");
  });
});

describe("type from altitude (thresholds come from the profile; the numbers here are test values only)", () => {
  const p = { ...profile, typeByAltitude: [{ to: 1000, type: "Easy" }, { from: 1001, to: 2000, type: "Medium" }, { from: 2001, type: "Hard" }] };
  const mkRace = (alt: string) =>
    parseSeason(
      ["season: 2026", "races:", "  - race: tour-de-france-me", "    class: 2.UWT", "    stages:",
        "      - { n: 1, date: 2026-07-04, altitude: " + alt + " }"].join(String.fromCharCode(10)),
      registry,
    );
  it("fills Easy, Medium and Hard by the rules", () => {
    expect(typeFromAltitude(500, p)).toBe("Easy");
    expect(typeFromAltitude(1500, p)).toBe("Medium");
    expect(typeFromAltitude(4000, p)).toBe("Hard");
    expect(renderSeason(p, registry, mkRace("4000"))[0]!.body).toContain("|4000m|");
    expect(renderSeason(p, registry, mkRace("4000"))[0]!.body).toContain("|Hard|");
  });
  it("makes no guess without rules, and an explicit type always wins", () => {
    expect(typeFromAltitude(4000, { ...profile, typeByAltitude: undefined })).toBeUndefined();
    const r = parseSeason(
      ["season: 2026", "races:", "  - race: tour-de-france-me", "    class: 2.UWT", "    stages:",
        "      - { n: 1, date: 2026-07-04, altitude: 4000, type: Easy }"].join(String.fromCharCode(10)),
      registry,
    );
    expect(renderSeason(p, registry, r)[0]!.body).toContain("|Easy|");
  });
});

describe("stage table import (the hand-built Grand Tour table)", () => {
  const r = parseMarkdownStages(read("tests/fixtures/internal-tdf-2026.md"), 2026);
  it("reads all 21 stages with every link", () => {
    expect(r.stages).toHaveLength(21);
    expect(r.notes).toEqual([]);
    expect(r.stages[5]).toEqual({
      n: 6,
      date: "2026-07-09",
      stageUrl: "https://www.letour.fr/en/stage-6",
      from: "Pau",
      to: "Gavarnie-Gèdre",
      routeUrl: "https://i.imgur.com/0uWgEFb.jpeg",
      length: 186,
      altitude: 3978,
      type: "Hard",
      typeUrl: "https://i.imgur.com/z4xgbd7.jpeg",
      finish: "Uphill",
      finishUrl: "https://i.imgur.com/U7E8aaG.jpeg",
      start: "12:25",
      end: "17:46",
    });
  });
  it("cleans route notes, keeps '-' as the finish of a team time trial, and finds the time zone", () => {
    expect(r.stages[0]).toMatchObject({ from: "Barcelona", to: "Barcelona", type: "TTT", altitude: 231, finish: "-" });
    expect(r.tz).toBe("CET");
  });
  it("finds the rest days from the gaps between stage dates", () => {
    expect(r.restDays).toEqual(["2026-07-13", "2026-07-20"]);
  });
  it("understands other column orders and date styles (the Vuelta table)", () => {
    const v = parseMarkdownStages(
      [
        "|Stage|Date|Route|Length|Type|Altitude|Finish|Time |",
        "|---:|---|---|---:|---:|---:|---|---|",
        "|[21](https://www.lavuelta.es/en/stage-21)|Sun. 13.Sep|[Granada > Granada](https://www.komoot.com/tour/3035277977)|99,4|Easy|1311m|[Flat](https://files.catbox.moe/k01e5r.jpg)|16:23-19:07 CEST|",
      ].join(String.fromCharCode(10)),
      2026,
    );
    expect(v.stages[0]).toMatchObject({ n: 21, date: "2026-09-13", length: 99.4, altitude: 1311, type: "Easy", finish: "Flat" });
    expect(v.tz).toBe("CEST");
  });
  it("the imported stages render as the full Tour de France thread, like the hand-built one", () => {
    const season = { season: 2026, races: [{ race: "tour-de-france-me", class: "2.UWT", tz: r.tz, stages: r.stages, restDays: r.restDays }] };
    const ts = renderSeason(profile, registry, season);
    expect(ts.filter((t) => t.kind === "stage")).toHaveLength(21);
    expect(ts.filter((t) => t.kind === "rest")).toHaveLength(2);
    const s6 = ts.find((t) => t.id === "tour-de-france-me-stage-6")!;
    expect(s6.body).toContain(
      "|Thu. 09/07|[6](https://www.letour.fr/en/stage-6)|[Pau > Gavarnie-Gèdre](https://i.imgur.com/0uWgEFb.jpeg)|186km|[Hard](https://i.imgur.com/z4xgbd7.jpeg)|3978m|[Uphill](https://i.imgur.com/U7E8aaG.jpeg)|12:25-17:46 [CEST](https://www.timeanddate.com/worldclock/fixedtime.html?iso=20260709T1025&p1=1440)|",
    );
    const s1 = ts.find((t) => t.id === "tour-de-france-me-stage-1")!;
    expect(s1.body).toContain("|19km|[TTT](https://i.imgur.com/qW5xMfO.jpeg)|231m|-|17:05-19:15 [CEST](https://www.timeanddate.com/worldclock/fixedtime.html?iso=20260704T1505&p1=1440)|");
  });
});

describe("Easy / Medium / Hard rule of the peloton profile", () => {
  it("classifies by the community's thresholds (Easy to 2000, Medium 2001-3499, Hard 3500+)", () => {
    expect(typeFromAltitude(1883, profile)).toBe("Easy");
    expect(typeFromAltitude(2000, profile)).toBe("Easy");
    expect(typeFromAltitude(2001, profile)).toBe("Medium");
    expect(typeFromAltitude(3259, profile)).toBe("Medium");
    expect(typeFromAltitude(3499, profile)).toBe("Medium");
    expect(typeFromAltitude(3500, profile)).toBe("Hard");
    expect(typeFromAltitude(5601, profile)).toBe("Hard");
  });
  it("flags types in a table that disagree with the rule", () => {
    const r = parseMarkdownStages(read("tests/fixtures/internal-tdf-2026.md"), 2026);
    const season = { season: 2026, races: [{ race: "tour-de-france-me", class: "2.UWT", tz: r.tz, stages: r.stages }] };
    const ts = renderSeason(profile, registry, season);
    const warn = (n: number) => ts.find((t) => t.id === "tour-de-france-me-stage-" + n)!.warnings.join(" | ");
    expect(warn(18)).toContain("type Medium but 3950 m is Hard");
    expect(warn(7)).toContain("type Easy but 2053 m is Medium");
    expect(warn(4)).not.toContain("altitude rule"); // Medium, 3259 m: agrees
    expect(warn(6)).not.toContain("altitude rule"); // Hard, 3978 m: agrees
    expect(warn(1)).not.toContain("altitude rule"); // TTT is not checked
  });
});

describe("rules with a gap (a community may leave a band undecided)", () => {
  it("asks for a type when none is given and the altitude is in the gap", () => {
    const gapProfile = { ...profile, typeByAltitude: [{ to: 2000, type: "Easy" }, { from: 3500, type: "Hard" }] };
    const season = {
      season: 2026,
      races: [{ race: "tour-de-france-me", class: "2.UWT", stages: [{ n: 4, date: "2026-07-07", altitude: 3259 }] }],
    };
    const t = renderSeason(gapProfile, registry, season)[0]!;
    expect(t.warnings.join(" | ")).toContain("3259 m falls between the Easy/Medium/Hard rules; choose the type");
    expect(t.body).toContain("|3259m|TBC|");
  });
});

describe("footers", () => {
  it("stage threads end with the Discord invite; one-day and rest-day threads do not get it", () => {
    const stageBody = byId("tour-de-france-me-stage-6").body;
    expect(stageBody.trimEnd().endsWith("[have a discord too](https://discord.gg/RgBftaX)!*")).toBe(true);
    expect(stageBody).toContain(String.fromCharCode(10) + "---" + String.fromCharCode(10));
    expect(byId("strade-bianche-me").body).not.toContain("discord");
    expect(byId("tour-de-france-me-rest-1").body).not.toContain("discord");
  });
});
