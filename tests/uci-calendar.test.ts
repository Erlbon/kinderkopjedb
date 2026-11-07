import { describe, expect, it } from "vitest";
import { addCapture, emptyCube, queueByRace, readUciCalendar, readXlsxRows } from "../src/core";

const HEAD = ["Start date", "End date", "Name", "Code", "Country", "Venue", "Discipline", "Class", "Categories", "Events"];
// rows as the 2027 export has them (generated 7 Nov 2026)
const ROWS = [
  ["Generated on 07/11/2026 01:17 (UTC+01:00)"],
  HEAD,
  ["21/10/2026", "25/10/2026", "CAC Road Cycling African Championships", "ROA_2027_CC_000090", "KENYA", "Kisumu County", "Road", "Continental Championships", "ME, MJ, MU, WE, WJ, WU, XE", "11"],
  ["20/03/2027", "20/03/2027", "Milano Sanremo Women", "ROA_2027_1.WWT_000010", "ITALY", "Sanremo", "Road", "1 day - UCI Women’s WorldTour", "WE", "1"],
  ["20/03/2027", "20/03/2027", "Milano-Sanremo", "ROA_2027_1.UWT_000011", "ITALY", "Sanremo", "Road", "1 day - UCI WorldTour", "ME", "1"],
  ["11/04/2027", "11/04/2027", "Paris-Roubaix Juniors", "ROA_2027_1.1_001034", "FRANCE", "Avesnes-le-Sec", "Road", "1 day - Class 1", "MJ", "1"],
  ["11/04/2027", "11/04/2027", "Paris-Roubaix Espoirs", "ROA_2027_1.2U_000251", "FRANCE", "VELO CLUB DE ROUBAIX", "Road", "1 day - Class 2 - U23", "", "0"],
  ["14/06/2027", "20/06/2027", "Tour de Suisse", "ROA_2027_2.UWT_000040", "SWITZERLAND", "x", "Road", "Stages - UCI WorldTour", "ME", "8"],
  ["01/05/2027", "01/05/2027", "Some Race", "ROA_2027_1.2_000500", "UNITED STATES", "x", "Road", "1 day - Class 2", "ME", "1"],
];

describe("the UCI calendar export", () => {
  it("gives the elite races with dates, class from the code, country codes, and a stand-in id below zero", () => {
    const cal = readUciCalendar(ROWS);
    expect(cal.season).toBe(2027);
    expect(cal.skipped).toBe(2); // juniors, and the under-23 race with no category
    expect(cal.unknownCountries).toEqual([]);
    const sanremo = cal.competitions.filter((c) => /Sanremo/.test(c.name));
    expect(sanremo.map((c) => [c.name, c.category, c.class, c.start, c.end, c.country, c.year])).toEqual([
      ["Milano Sanremo Women", "WE", "1.WWT", "2027-03-20", "2027-03-20", "ITA", 2027],
      ["Milano-Sanremo", "ME", "1.UWT", "2027-03-20", "2027-03-20", "ITA", 2027],
    ]);
    // a championship for every category gives one men's and one women's line; the 2027 season starts in October 2026
    expect(cal.competitions.filter((c) => /African/.test(c.name)).map((c) => [c.category, c.class, c.year, c.start])).toEqual([["ME", "CC", 2027, "2026-10-21"], ["WE", "CC", 2027, "2026-10-21"]]);
    expect(cal.competitions.find((c) => c.name === "Some Race")!.country).toBe("USA");
    const ids = cal.competitions.map((c) => c.id);
    expect(ids.every((id) => id < 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reads rows the export left without categories from their class and name", () => {
    const row = (name: string, code: string) => ["10/05/2027", "12/05/2027", name, code, "ITALY", "x", "Road", "x", "", "3"];
    const cal = readUciCalendar([HEAD, row("Settimana Internazionale Coppi e Bartali", "ROA_2027_2.1_000169"), row("Bretagne Ladies Tour", "ROA_2027_2.1_001236"), row("Volta Ciclista a Catalunya Femenina", "ROA_2027_2.1_000337"), row("Tour of Norway", "ROA_2027_2.PRO_001113"), row("National Road Championships - Denmark", "ROA_2027_CN_000327"), row("National Road Championships - Peru (Junior)", "ROA_2027_CN_001231"), row("National Road Championships - Slovakia (MU)", "ROA_2027_CN_001216"), row("Copa de Naciones Junior - Colombia", "ROA_2027_2.NCUP_001077"), row("Watersley Womens Challenge", "ROA_2027_2.2U_001155"), row("Wakayama Castle Criterium", "ROA_2027_CRT_001145")]);
    expect(cal.competitions.map((c) => c.category + " " + c.class + " " + c.name)).toEqual([
      "ME 2.1 Settimana Internazionale Coppi e Bartali",
      "WE 2.1 Bretagne Ladies Tour",
      "WE 2.1 Volta Ciclista a Catalunya Femenina",
      "ME 2.Pro Tour of Norway", // the class as DataRide writes it
      "ME CN National Road Championships - Denmark",
      "WE CN National Road Championships - Denmark",
    ]);
    expect(cal).toMatchObject({ guessed: 5, skipped: 5 });
  });

  it("refuses a sheet that is not the calendar export", () => {
    expect(() => readUciCalendar([["Name", "Points"], ["A", "1"]])).toThrow("not a UCI calendar export");
  });

  it("goes into the queue, and the DataRide competition takes the calendar line's place", () => {
    const cube = emptyCube();
    addCapture(cube, { format: "racethreads-capture/1", competitions: readUciCalendar(ROWS).competitions });
    expect(cube.queue!.filter((q) => q.uciId < 0)).toHaveLength(6);
    expect(cube.queue!.find((q) => q.name === "Milano-Sanremo")).toMatchObject({ hub: "UCI calendar", class: "1.UWT" });
    // DataRide's list for 2027: Sanremo men (another spelling), and the women's race under DataRide's own name
    const dr = (id: number, name: string, category: "ME" | "WE", start = "2027-03-20") => ({ id, name, start, end: start, year: 2027, country: "ITA", class: category === "ME" ? "1.UWT" : "1.WWT", inProgress: false, category });
    addCapture(cube, { format: "racethreads-capture/1", competitions: [dr(80011, "Milano-Sanremo", "ME"), dr(80010, "Milano-Sanremo Donne", "WE"), dr(80020, "Gran Premio Other", "ME", "2027-03-20")] });
    const sanremo = cube.queue!.filter((q) => /Sanremo/.test(q.name));
    expect(sanremo.map((q) => [q.uciId, q.category, q.hub])).toEqual([[80011, "ME", "DataRide"], [80010, "WE", "DataRide"]]);
    expect(cube.queue!.filter((q) => q.uciId < 0)).toHaveLength(4); // the others wait; an unrelated race on the same day did not take a line
    // opening the calendar again does not bring the replaced lines back
    addCapture(cube, { format: "racethreads-capture/1", competitions: readUciCalendar(ROWS).competitions });
    expect(cube.queue!.filter((q) => /Sanremo/.test(q.name))).toHaveLength(2);
    expect(cube.queue!.filter((q) => q.uciId < 0)).toHaveLength(4);
  });

  it("a calendar line is a 2027 edition of its race, lined up with the earlier years by name", () => {
    const cube = emptyCube();
    addCapture(cube, { format: "racethreads-capture/1", competitions: [{ id: 1, name: "Milano-Sanremo", start: "2026-03-21", end: "2026-03-21", year: 2026, country: "ITA", class: "1.UWT", inProgress: false, category: "ME" }] });
    addCapture(cube, { format: "racethreads-capture/1", competitions: readUciCalendar(ROWS).competitions });
    const race = queueByRace(cube).races.find((r) => r.name === "Milano-Sanremo")!;
    expect(Object.keys(race.editions)).toEqual(["2026", "2027"]);
  });
});

describe("reading an .xlsx file", () => {
  // a small .xlsx made here: shared strings, inline strings, a skipped (empty) cell and an escaped character
  async function xlsx(files: Record<string, string>): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(files)) {
      const raw = enc.encode(text);
      const packed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
      const n = enc.encode(name);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(8, 8, true);
      local.setUint32(18, packed.length, true);
      local.setUint32(22, raw.length, true);
      local.setUint16(26, n.length, true);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(10, 8, true);
      cd.setUint32(20, packed.length, true);
      cd.setUint32(24, raw.length, true);
      cd.setUint16(28, n.length, true);
      cd.setUint32(42, offset, true);
      parts.push(new Uint8Array(local.buffer), n, packed);
      central.push(new Uint8Array(cd.buffer), n);
      offset += 30 + n.length + packed.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, Object.keys(files).length, true);
    end.setUint16(10, Object.keys(files).length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of all) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  it("gives the first sheet's rows as text, empty cells kept in their column", async () => {
    const bytes = await xlsx({
      "xl/sharedStrings.xml": '<sst><si><t>Name</t></si><si><r><t>Liège</t></r><r><t xml:space="preserve">-Bastogne</t></r></si></sst>',
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="str"><v>Gent &amp; Wevelgem</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>12</v></c><c r="C2" t="inlineStr"><is><t>inline</t></is></c></row></sheetData></worksheet>',
    });
    expect(await readXlsxRows(bytes)).toEqual([
      ["Name", "", "Gent & Wevelgem"],
      ["Liège-Bastogne", "12", "inline"],
    ]);
  });

  it("says so when the file is not an .xlsx", async () => {
    await expect(readXlsxRows(new TextEncoder().encode("hello"))).rejects.toThrow("not a zip file");
  });
});
