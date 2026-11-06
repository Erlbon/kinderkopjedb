/**
 * Link patterns: an address with tokens for the parts that change per thread, so one line in the
 * race registry fills that link in every thread of every year.
 *
 *   {year} 2026   {yy} 26   {date} 2026-07-09   {yyyymmdd} 20260709   {stage} 6   {stage2} 06
 */

export interface PatternVars {
  year: number;
  date?: string; // ISO, the racing day
  stage?: number;
}

/** Fill in a pattern; undefined when it needs a value this thread does not have (a {stage} on a one-day race). */
export function expandPattern(pattern: string, v: PatternVars): string | undefined {
  let missing = false;
  const out = pattern.replace(/\{(year|yy|date|yyyymmdd|stage|stage2)\}/g, (_m, k: string) => {
    switch (k) {
      case "year":
        return String(v.year);
      case "yy":
        return String(v.year).slice(2);
      case "date":
        if (!v.date) missing = true;
        return v.date ?? "";
      case "yyyymmdd":
        if (!v.date) missing = true;
        return (v.date ?? "").split("-").join("");
      case "stage":
        if (v.stage === undefined) missing = true;
        return String(v.stage ?? "");
      default:
        if (v.stage === undefined) missing = true;
        return String(v.stage ?? "").padStart(2, "0");
    }
  });
  return missing ? undefined : out;
}

/**
 * The other way: turn a link from an old thread into a pattern by putting tokens where this
 * thread's date, stage number and year are. A stage number only counts after a word such as
 * "stage-" or a separator at the end of a path part, so "186km" or an id is left alone.
 */
export function toPattern(url: string, v: PatternVars): string {
  let u = url.trim();
  if (v.date) {
    u = u.split(v.date).join("{date}");
    u = u.split(v.date.split("-").join("")).join("{yyyymmdd}");
  }
  if (v.stage !== undefined) {
    const n = String(v.stage);
    // "stage-6", "etape-06", "tappa/6", and "/6/" or "_6." in a path (2025_17_6.png, sanluca .../2023/6/)
    u = u.replace(new RegExp("(stage|etape|tappa|etapa)([-_/=]?)(0" + n + "|" + n + ")(?![0-9])", "gi"), (_m, a: string, b: string, num: string) =>
      a + b + (num.length === 2 && num.startsWith("0") && n.length === 1 ? "{stage2}" : "{stage}"),
    );
    // Only the last such number, and only in an address that also has the year or date: in stage 17 of
    // ".../2025_17_17.png" the first 17 is FirstCycling's race id, and a lone "/6/" may be any id.
    if (!u.includes("{stage") && (u.includes(String(v.year)) || u.includes("{date}"))) {
      const hits = [...u.matchAll(new RegExp("([_/])(0" + n + "|" + n + ")(?=[/._?#]|$)", "g"))];
      const last = hits[hits.length - 1];
      if (last && last.index !== undefined) {
        const num = last[2]!;
        const tok = num.length === 2 && n.length === 1 ? "{stage2}" : "{stage}";
        u = u.slice(0, last.index) + last[1] + tok + u.slice(last.index + last[0].length);
      }
    }
  }
  u = u.split(String(v.year)).join("{year}");
  return u;
}
