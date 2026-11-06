/**
 * Time-zone names in threads. European races are given as CET (or WET/EET) once and the
 * thread says CEST in summer by itself; the time links to a converter for readers elsewhere.
 */

/** Hours ahead of UTC. Only zones listed here get a converter link. */
const OFFSET: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  WET: 0,
  WEST: 1,
  BST: 1,
  CET: 1,
  CEST: 2,
  EET: 2,
  EEST: 3,
  MSK: 3,
  GST: 4,
  CST: 8, // China (Tour of Guangxi); the US zone of that name is not used in r/peloton threads
  AEST: 10,
  AEDT: 11,
  ACDT: 10.5,
  ACST: 9.5,
  NZDT: 13,
  NZST: 12,
  EDT: -4,
  EST: -5,
  PDT: -7,
  PST: -8,
};

/** Winter name -> summer name, for the zones that follow the EU summer-time rule. */
const EU_SUMMER: Record<string, string> = { CET: "CEST", WET: "WEST", EET: "EEST", GMT: "BST" };
const EU_WINTER: Record<string, string> = Object.fromEntries(Object.entries(EU_SUMMER).map(([w, s]) => [s, w]));

/** The last Sunday of a month (ISO date). */
function lastSunday(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0)); // last day of the month
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/** EU summer time: from the last Sunday of March to the day before the last Sunday of October. */
export function euSummer(date: string): boolean {
  const y = +date.slice(0, 4);
  return date >= lastSunday(y, 3) && date < lastSunday(y, 10);
}

/** The zone name for a racing day: "CET" or "CEST" by the date (either may be given); other zones as given. */
export function zoneFor(date: string, tz: string): string {
  const winter = EU_WINTER[tz] ?? tz;
  const summer = EU_SUMMER[winter];
  if (!summer) return tz;
  return euSummer(date) ? summer : winter;
}

/**
 * A timeanddate.com page that shows this moment in the reader's own time zone, or undefined
 * for a zone without a known offset. date "2026-07-09", time "12:25", zone "CEST".
 */
export function converterUrl(date: string, time: string, zone: string): string | undefined {
  const off = OFFSET[zone];
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(time.trim());
  if (off === undefined || !m) return undefined;
  const local = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +m[1]!, +m[2]!);
  const utc = new Date(local - off * 3600_000).toISOString(); // 2026-07-09T10:25:00.000Z
  const iso = utc.slice(0, 4) + utc.slice(5, 7) + utc.slice(8, 10) + "T" + utc.slice(11, 13) + utc.slice(14, 16);
  return "https://www.timeanddate.com/worldclock/fixedtime.html?iso=" + iso + "&p1=1440"; // p1=1440: the time is UTC
}
