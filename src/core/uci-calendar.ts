import { COUNTRIES } from "./countries";
import type { Category, DrCompetition } from "./dataride";

/**
 * The UCI calendar export (uci.org, Calendar, "Export" as .xlsx): one row per competition with its dates, name, code
 * (ROA_2027_1.UWT_000011), country, class and categories. It has no DataRide competition id, so each elite race gets
 * a stand-in id below zero, made from its code; the competition captured from DataRide later takes its place
 * (see upsertCompetition). Only men's and women's elite (ME, WE) are read: a race for both gives one line for each.
 */

const HEADERS = ["Start date", "End date", "Name", "Code", "Country", "Class", "Categories"];

/** Country names as the calendar writes them where they differ from the country table. */
const COUNTRY_NAMES: Record<string, string> = { "UNITED STATES": "USA", KOREA: "KOR", "HONG KONG, CHINA": "HKG", "CHINESE TAIPEI": "TPE", TURKEY: "TUR", "CZECH REPUBLIC": "CZE" };
const BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toUpperCase(), c.code]));

/** "ITALY" -> "ITA"; undefined for a name the table does not know. */
export function countryCode(name: string): string | undefined {
  const n = name.trim().toUpperCase();
  return COUNTRY_NAMES[n] ?? BY_NAME.get(n);
}

/** "20/03/2027" -> "2027-03-20" */
const iso = (d: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d.trim());
  return m ? m[3] + "-" + m[2]!.padStart(2, "0") + "-" + m[1]!.padStart(2, "0") : "";
};

/** The stand-in id of a calendar race: below zero, from the season and number in its code, one per category. */
export function calendarId(year: number, number: number, category: Category): number {
  return -((year - 2000) * 100000000 + number * 10 + (category === "WE" ? 1 : 0));
}

export interface UciCalendar {
  season?: number;
  competitions: DrCompetition[];
  skipped: number; // rows with no elite category (juniors, under-23 ...)
  guessed: number; // rows without categories, read from their class and name
  unknownCountries: string[];
}

/** A women's race by its name, in the languages the calendar uses. */
const WOMEN = /\b(women|womens|woman|ladies|dames|femmes|feminin|féminin|femenina|femminile|feminas|féminas|fèmines|femines|donne|vrouwen|frauen)\b/i;

/** The rows of the export (see readXlsxRows) as competitions for the queue. */
export function readUciCalendar(rows: string[][]): UciCalendar {
  const headerAt = rows.findIndex((r) => HEADERS.every((h) => r.includes(h)));
  if (headerAt < 0) throw new Error("not a UCI calendar export (no Start date, Name, Code ... header)");
  const col = Object.fromEntries(HEADERS.map((h) => [h, rows[headerAt]!.indexOf(h)]));
  const out: UciCalendar = { competitions: [], skipped: 0, guessed: 0, unknownCountries: [] };
  for (const r of rows.slice(headerAt + 1)) {
    const cell = (h: string) => (r[col[h]!] ?? "").trim();
    const code = /^[A-Z]+_(\d{4})_(.+)_(\d+)$/.exec(cell("Code"));
    if (!code) continue;
    const year = Number(code[1]);
    out.season ??= year;
    const listed = cell("Categories").split(",").map((c) => c.trim()).filter((c) => c !== "");
    const cls = code[2]!.replace(/PRO$/, "Pro"); // DataRide writes 1.Pro, the calendar code 1.PRO
    let categories = listed.filter((c): c is Category => c === "ME" || c === "WE");
    if (!listed.length) {
      // many stage races and national championships come without categories: under-23 (1.2U), Nations' Cup (juniors) and
      // criteriums are left out, a national championship is for both, and otherwise the name says whether it is women's
      if (/U$|NCUP|^CRT/.test(cls) || /\b(junior|juniors|u23|mu|wu|mj|wj)\b/i.test(cell("Name"))) categories = [];
      else if (cls === "CN") categories = ["ME", "WE"];
      else categories = [WOMEN.test(cell("Name")) ? "WE" : "ME"];
      if (categories.length) out.guessed++;
    }
    if (!categories.length) {
      out.skipped++;
      continue;
    }
    const country = countryCode(cell("Country"));
    if (!country && cell("Country") && !out.unknownCountries.includes(cell("Country"))) out.unknownCountries.push(cell("Country"));
    for (const category of categories) {
      out.competitions.push({
        id: calendarId(year, Number(code[3]), category),
        name: cell("Name"),
        start: iso(cell("Start date")),
        end: iso(cell("End date")),
        year,
        country: country ?? "",
        class: cls,
        inProgress: false,
        category,
      });
    }
  }
  return out;
}
