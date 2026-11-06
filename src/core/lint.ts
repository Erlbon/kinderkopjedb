/**
 * Checks on a finished thread, from mistakes found in real r/peloton threads: an empty
 * link ("[Roadbook]()"), a placeholder address ("letour.fr/en/#"), last year's address
 * (Tissot 2025 in a 2026 thread) and assistant text left in by accident.
 */

const LINK = /\[([^\]]*)\]\(([^)]*)\)/g;
const BOILERPLATE = /let me know if you'?d like|as an ai (language )?model|i hope this helps|certainly! here('| i)s/i;

/** Warnings for a thread body; year = the thread's season. */
export function lintThread(body: string, year: number): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(LINK)) {
    const text = m[1]!.trim();
    const url = m[2]!.trim();
    if (url === "") {
      out.push("empty link: [" + text + "]()");
      continue;
    }
    if (url === "#" || /\/#$/.test(url)) out.push("placeholder link: [" + text + "](" + url + ")");
    // a year in the address that is not this season's (digits on both sides = part of a longer number)
    const years = [...url.matchAll(/(?<![0-9])(20[0-9]{2})(?![0-9])/g)].map((y) => +y[1]!);
    const other = years.find((y) => y !== year);
    if (other !== undefined && !years.includes(year)) out.push("link has " + other + " in its address, not " + year + ": [" + text + "]");
  }
  const bp = BOILERPLATE.exec(body);
  if (bp) out.push('text looks like assistant boilerplate: "' + bp[0] + '"');
  return out;
}
