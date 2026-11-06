import { parse } from "yaml";
import { isIsoDate } from "./dates";
import { Profile, RegistryRace, Season, SeasonError } from "./types";

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function parseProfile(text: string): Profile {
  const p = parse(text) as unknown;
  const errors: string[] = [];
  if (!isObj(p)) throw new SeasonError(["profile: not a YAML mapping"]);
  for (const k of ["id", "name", "titles", "tables", "infoRows", "placeholder"]) {
    if (p[k] === undefined) errors.push("profile: missing '" + k + "'");
  }
  if (errors.length) throw new SeasonError(errors);
  return p as unknown as Profile;
}

export function parseRegistry(text: string): Record<string, RegistryRace> {
  const r = parse(text) as unknown;
  if (r === null || r === undefined) return {};
  if (!isObj(r)) throw new SeasonError(["races registry: not a YAML mapping"]);
  const errors: string[] = [];
  for (const [id, v] of Object.entries(r)) {
    if (!isObj(v) || typeof v.name !== "string" || typeof v.category !== "string") {
      errors.push("registry '" + id + "': needs name and category");
    }
  }
  if (errors.length) throw new SeasonError(errors);
  return r as unknown as Record<string, RegistryRace>;
}

/** Parse and validate a season file. Dates stay ISO strings. */
export function parseSeason(text: string, registry: Record<string, RegistryRace>): Season {
  const s = parse(text) as unknown;
  const errors: string[] = [];
  if (!isObj(s)) throw new SeasonError(["season: not a YAML mapping"]);
  if (s.season === undefined) errors.push("season: missing 'season' (the year)");
  if (!Array.isArray(s.races)) throw new SeasonError([...errors, "season: 'races' must be a list"]);

  const seen = new Set<string>();
  s.races.forEach((raw: unknown, i: number) => {
    const where = "races[" + i + "]";
    if (!isObj(raw)) {
      errors.push(where + ": not a mapping");
      return;
    }
    // YAML reads an unquoted class such as 1.1 as a number; it is a code, keep it as text.
    if (typeof raw.class === "number") raw.class = String(raw.class);
    const id = raw.race;
    if (typeof id !== "string" || !id) {
      errors.push(where + ": missing 'race' id");
      return;
    }
    const w = where + " (" + id + ")";
    if (seen.has(id)) errors.push(w + ": duplicate race id");
    seen.add(id);
    const reg = registry[id];
    const name = raw.name ?? reg?.name;
    const category = raw.category ?? reg?.category;
    if (typeof name !== "string") errors.push(w + ": no name (not in registry, none given)");
    if (typeof category !== "string") errors.push(w + ": no category (not in registry, none given)");
    if (typeof raw.class !== "string") errors.push(w + ": missing 'class' (e.g. 1.UWT)");

    const stages = raw.stages;
    if (stages !== undefined) {
      if (!Array.isArray(stages) || stages.length === 0) {
        errors.push(w + ": 'stages' must be a non-empty list");
      } else {
        const nums = new Set<number>();
        stages.forEach((st: unknown, j: number) => {
          if (!isObj(st) || typeof st.n !== "number" || !isIsoDate(st.date)) {
            errors.push(w + ".stages[" + j + "]: needs numeric 'n' and ISO 'date'");
            return;
          }
          if (nums.has(st.n)) errors.push(w + ": duplicate stage " + st.n);
          nums.add(st.n);
        });
      }
    } else if (!isIsoDate(raw.date)) {
      errors.push(w + ": one-day race needs an ISO 'date' (yyyy-mm-dd)");
    }
    const rest = raw.restDays;
    if (rest !== undefined) {
      if (!Array.isArray(rest) || rest.some((d) => !isIsoDate(d))) {
        errors.push(w + ": 'restDays' must be a list of ISO dates");
      }
    }
    const pres = raw.presentation;
    if (pres !== undefined && (!isObj(pres) || !isIsoDate(pres.date))) {
      errors.push(w + ": 'presentation' needs an ISO 'date'");
    }
  });
  if (errors.length) throw new SeasonError(errors);
  return s as unknown as Season;
}
