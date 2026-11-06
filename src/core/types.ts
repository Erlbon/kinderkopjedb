/** A link in an info row. No url = plain text. */
export interface InfoLink {
  text: string;
  url?: string;
}

/** An info-row value: a list of links/text joined with " / ", or raw markdown. */
export type InfoValue = InfoLink[] | { md: string };

/**
 * A race that comes back every year (per category: the men's and women's
 * editions are separate entries because their ids and slugs differ).
 * Lives in data/peloton/races.yaml and is reused across seasons.
 */
export interface RegistryRace {
  name: string;
  category: string; // ME, WE, ...
  titleTag?: string; // text for {tag} in titles; default = category, "" = none
  table?: string; // name of a table layout in the profile (tables.variants); the default layout otherwise
  labels?: Record<string, string>; // info-row labels this race uses ("previews": "Overall Previews")
  officialSite?: string;
  /** Organiser contact from UCI (personal data: kept only if the moderator asked for it, never put in a thread). */
  contactEmail?: string;
  wikipedia?: string;
  pcs?: string; // procyclingstats slug, e.g. strade-bianche-donne
  firstcycling?: number | string; // firstcycling race.php?r=
  firstcyclingClass?: number | string; // firstcycling race.php?k= (default 8)
  social?: InfoLink[];
  /** Info-row items that carry over every year, per row id (information, previews, ...). */
  info?: Record<string, InfoValue>;
  tz?: string; // time zone label, e.g. CET (CET/CEST, WET/WEST, EET/EEST follow the date by themselves)
}

/** One racing day: a one-day race or one stage. */
export interface Leg {
  date: string; // ISO yyyy-mm-dd
  from?: string;
  to?: string;
  routeUrl?: string;
  stageUrl?: string; // official page of the stage (links the stage number)
  length?: number; // km
  altitude?: number; // metres climbed
  type?: string;
  typeUrl?: string; // image of the stage profile; links the Type cell
  finish?: string;
  finishUrl?: string; // image of the finish; links the Finish cell
  start?: string; // "11:45"
  end?: string; // "16:43"
  info?: Record<string, InfoValue>; // adds to / replaces standard info rows
  extra?: ExtraRow[]; // additional rows after the standard ones
  notes?: string; // free markdown appended below the tables
}

export interface Stage extends Leg {
  n: number;
}

/** One race in one season (year-specific facts). */
export interface SeasonRace extends Partial<Leg> {
  race: string; // registry id (or a new id when name+category are given here)
  name?: string; // overrides/replaces the registry entry
  category?: string;
  class: string; // 1.UWT, 2.Pro, ...
  stages?: Stage[]; // present = stage race
  // race-level extra/notes apply to every thread of the race (via Leg's optional fields)
  restDays?: string[]; // ISO dates that get a rest-day thread (Grand Tours)
  mega?: boolean; // also a thread for the whole race
  tz?: string;
  roadbook?: string;
  uciId?: number; // UCI competition id (uci.org/competition-details/<year>/ROA/<id>)
  table?: string; // overrides the registry's stage-table layout for this season
  labels?: Record<string, string>; // overrides row labels for this season
  info?: Record<string, InfoValue>; // extra/override per info row
}

/** An extra info row for one race or stage (beyond the standard rows). */
export interface ExtraRow {
  label: string;
  value: InfoValue;
}

export interface Season {
  season: number | string;
  races: SeasonRace[];
}

export type ColumnField =
  | "date"
  | "stage"
  | "route"
  | "length"
  | "type"
  | "altitude"
  | "finish"
  | "time";

export interface Column {
  header: string;
  field: ColumnField;
  align?: "l" | "r" | "c";
  /**
   * date: tokens ddd dd mm MMM ("ddd. dd/mm" -> "Thu. 09/07", "ddd. dd.MMM" -> "Sun. 13.Sep");
   * length: template with {n} (dot decimal) or {n,} (comma decimal), default "{n}km";
   * time: the separator ("-" or " – ")
   */
  format?: string;
  /** Leave the whole column out when no row has a value (used for Altitude on one-day races). */
  optional?: boolean;
  /** time: link the zone name to a page showing the start in the reader's own time zone. */
  link?: boolean;
}

/** Info-row items built from the race registry / season data when present. */
export type AutoItem = "official" | "wikipedia" | "startlistFc" | "pcsLive" | "social";

export interface InfoRowDef {
  id: string;
  label: string;
  optional?: boolean; // omitted when empty instead of showing the placeholder
  kinds?: ("oneday" | "stage")[]; // default: both
  auto?: AutoItem[];
}

export interface Profile {
  id: string;
  name: string;
  titles: { oneday: string; stage: string; rest: string; mega: string };
  /**
   * The default tables, plus named variants (different moderators lay tables out differently).
   * A variant may redefine the one-day table, the stage table, or both.
   */
  tables: {
    oneday: Column[];
    stage: Column[];
    variants?: Record<string, { label?: string; oneday?: Column[]; stage?: Column[] }>;
  };
  /** Optional closing markdown per thread type (for example a Discord invite under stage threads). */
  footers?: { oneday?: string; stage?: string; rest?: string };
  infoRows: InfoRowDef[];
  restIntro: string; // placeholder where the moderator writes the recap
  restFooter: string; // standard closing block (wiki, FAQ, dictionary links)
  megaIntro: string;
  defaultIntro: string;
  placeholder: string; // shown where a value is still missing
  /**
   * Optional: derive the stage/race Type (Easy, Medium, Hard) from the altitude gained, in whole
   * metres. Each rule matches from..to inclusive (either end may be left open); the first match wins.
   * Altitudes that no rule covers get no automatic type. Also used to warn when a given type
   * disagrees with the rule.
   */
  typeByAltitude?: { from?: number; to?: number; type: string }[];
}

export type ThreadKind = "race" | "stage" | "rest" | "mega";

export interface Thread {
  id: string;
  kind: ThreadKind;
  title: string;
  body: string;
  firstDate: string;
  lastDate: string;
  suggestedPost: string; // ISO date
  warnings: string[]; // values still to fill in
}

export class SeasonError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(String.fromCharCode(10)));
  }
}
