import { RaceClass, classWarnings } from "./classes";
import { addDays, ddmm, yearOf } from "./dates";
import { lintThread } from "./lint";
import { converterUrl, zoneFor } from "./timezone";
import {
  Column,
  InfoLink,
  InfoRowDef,
  InfoValue,
  Leg,
  Profile,
  RegistryRace,
  Season,
  SeasonRace,
  Stage,
  Thread,
} from "./types";

const NL = String.fromCharCode(10);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface RenderOptions {
  /** Default table layout (a name from the profile's tables.variants) for races that do not choose their own. */
  table?: string;
  /** The moderator's own column set (from the layout editor); beats the named default, not a race's own layout. */
  columns?: { oneday?: Column[]; stage?: Column[] };
}

interface Ctx {
  opts: RenderOptions;
  profile: Profile;
  race: SeasonRace;
  reg: RegistryRace | undefined;
  name: string;
  category: string;
  year: number;
  warnings: string[];
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Tokens: ddd (weekday), dd (day), mm (month number), MMM (month abbreviation), yyyy (year). One pass, so tokens never clash. */
export function fmtDate(iso: string, format: string): string {
  const wd = WEEKDAYS[new Date(iso + "T00:00:00Z").getUTCDay()]!;
  return format.replace(/ddd|dd|MMM|mm|yyyy/g, (tok) =>
    tok === "ddd"
      ? wd
      : tok === "dd"
        ? iso.slice(8, 10)
        : tok === "MMM"
          ? MONTH_ABBR[+iso.slice(5, 7) - 1]!
          : tok === "yyyy"
            ? iso.slice(0, 4)
            : iso.slice(5, 7),
  );
}

function fmtNumber(n: number, template: string): string {
  return template.replace("{n,}", String(n).replace(".", ",")).replace("{n}", String(n));
}

/** Easy / Medium / Hard from the metres climbed, using the profile's rules (none = no guess). */
export function typeFromAltitude(altitude: number | undefined, profile: Profile): string | undefined {
  const rules = profile.typeByAltitude;
  if (altitude === undefined || !rules?.length) return undefined;
  const hit = rules.find((r) => (r.from === undefined || altitude >= r.from) && (r.to === undefined || altitude <= r.to));
  return hit?.type;
}

/** Does this leg have a value for the column's field? (used to drop optional columns) */
function hasValue(col: Column, leg: Leg & { n?: number }, profile: Profile): boolean {
  switch (col.field) {
    case "date":
      return true;
    case "stage":
      return leg.n !== undefined;
    case "route":
      return !!leg.from && !!leg.to;
    case "length":
      return leg.length !== undefined;
    case "altitude":
      return leg.altitude !== undefined;
    case "type":
      return !!leg.type || typeFromAltitude(leg.altitude, profile) !== undefined;
    case "finish":
      return !!leg.finish;
    case "time":
      return !!leg.start;
  }
}

function fill(tpl: string, vars: Record<string, string | number>): string {
  const out = tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
  return out.replace(/ {2,}/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
}

function mdLink(l: InfoLink): string {
  return l.url ? "[" + l.text + "](" + l.url + ")" : l.text;
}

function cell(col: Column, leg: Leg & { n?: number }, ctx: Ctx, what: string): string {
  const miss = (field: string): string => {
    ctx.warnings.push(what + ": " + field + " missing");
    return ctx.profile.placeholder;
  };
  switch (col.field) {
    case "date":
      return fmtDate(leg.date, col.format ?? "dd.mm");
    case "stage":
      if (leg.n === undefined) return miss("stage number");
      return leg.stageUrl ? "[" + leg.n + "](" + leg.stageUrl + ")" : String(leg.n);
    case "route": {
      if (!leg.from || !leg.to) return miss("route (from > to)");
      const t = leg.from + " > " + leg.to;
      return leg.routeUrl ? "[" + t + "](" + leg.routeUrl + ")" : t;
    }
    case "length":
      return leg.length === undefined ? miss("length") : fmtNumber(leg.length, col.format ?? "{n}km");
    case "altitude":
      return leg.altitude === undefined ? miss("altitude") : leg.altitude + "m";
    case "type": {
      const byRule = typeFromAltitude(leg.altitude, ctx.profile);
      const type = leg.type ?? byRule;
      if (!type) {
        if (leg.altitude !== undefined && ctx.profile.typeByAltitude?.length) {
          ctx.warnings.push(what + ": " + leg.altitude + " m falls between the Easy/Medium/Hard rules; choose the type");
        }
        return miss("type");
      }
      // A given type that disagrees with the altitude rule is kept, but flagged (TTT, ITT ... are not checked).
      const vocab = ctx.profile.typeByAltitude?.map((r) => r.type) ?? [];
      if (leg.type && byRule && vocab.includes(leg.type) && leg.type !== byRule) {
        ctx.warnings.push(what + ": type " + leg.type + " but " + leg.altitude + " m is " + byRule + " by the altitude rule");
      }
      return leg.typeUrl ? "[" + type + "](" + leg.typeUrl + ")" : type;
    }
    case "finish":
      if (!leg.finish) return miss("finish");
      return leg.finishUrl ? "[" + leg.finish + "](" + leg.finishUrl + ")" : leg.finish;
    case "time": {
      if (!leg.start) return miss("time");
      const zone = zoneFor(leg.date, ctx.race.tz ?? ctx.reg?.tz ?? "CET");
      const sep = col.format ?? " – ";
      const url = col.link ? converterUrl(leg.date, leg.start, zone) : undefined;
      return (leg.end ? leg.start + sep + leg.end : leg.start) + " " + (url ? "[" + zone + "](" + url + ")" : zone);
    }
  }
}

function alignCell(a: Column["align"]): string {
  return a === "r" ? "---:" : a === "c" ? ":-:" : a === "l" ? ":-" : "---";
}

function table(allCols: Column[], rows: (Leg & { n?: number })[], ctx: Ctx, what: string): string {
  // Optional columns (Altitude on a one-day race) are left out when no row has a value.
  const cols = allCols.filter((c) => !c.optional || rows.some((r) => hasValue(c, r, ctx.profile)));
  const head = "|" + cols.map((c) => c.header).join("|") + "|";
  const sep = "|" + cols.map((c) => alignCell(c.align)).join("|") + "|";
  const body = rows.map(
    (leg) => "|" + cols.map((c) => cell(c, leg, ctx, what)).join("|") + "|",
  );
  return [head, sep, ...body].join(NL);
}

function autoItems(row: InfoRowDef, ctx: Ctx): InfoLink[] {
  const out: InfoLink[] = [];
  const r = ctx.reg;
  for (const a of row.auto ?? []) {
    if (a === "official" && r?.officialSite) out.push({ text: "Official Site", url: r.officialSite });
    if (a === "wikipedia" && r?.wikipedia) out.push({ text: "Wikipedia", url: r.wikipedia });
    if (a === "startlistFc" && r?.firstcycling !== undefined) {
      const k = r.firstcyclingClass ?? 8;
      out.push({
        text: "Startlist FC",
        url: "https://firstcycling.com/race.php?r=" + r.firstcycling + "&y=" + ctx.year + "&k=" + k,
      });
    }
    if (a === "pcsLive" && r?.pcs) {
      out.push({
        text: "PCS",
        url: "https://www.procyclingstats.com/race/" + r.pcs + "/" + ctx.year + "/result/live",
      });
    }
    if (a === "social" && r?.social) out.push(...r.social);
  }
  return out;
}

function infoTable(kind: "oneday" | "stage", leg: Leg, ctx: Ctx): string {
  const lines = ["|||", "|-|-|"];
  for (const row of ctx.profile.infoRows) {
    if (row.kinds && !row.kinds.includes(kind)) continue;
    // Order: built from ids, then what carries over every year, then this year's race, then this leg.
    const layers: (InfoValue | undefined)[] = [
      ctx.reg?.info?.[row.id],
      ctx.race.info?.[row.id],
      leg.info?.[row.id],
    ];
    let md: string | undefined;
    const links: InfoLink[] = autoItems(row, ctx);
    for (const v of layers) {
      if (!v) continue;
      if (Array.isArray(v)) links.push(...v);
      else md = v.md;
    }
    const text = md ?? links.map(mdLink).join(" / ");
    // Moderators name rows differently ("Overall Previews"); a race can carry its own label.
    const label = ctx.race.labels?.[row.id] ?? ctx.reg?.labels?.[row.id] ?? row.label;
    if (!text) {
      if (row.optional) continue;
      ctx.warnings.push(row.label + ": empty");
      lines.push("|" + label + "|" + ctx.profile.placeholder + "|");
    } else {
      lines.push("|" + label + "|" + text + "|");
    }
  }
  for (const x of [...(ctx.race.extra ?? []), ...(leg.extra ?? [])]) {
    const text = Array.isArray(x.value) ? x.value.map(mdLink).join(" / ") : x.value.md;
    lines.push("|" + x.label + "|" + text + "|");
  }
  return lines.join(NL);
}

/** Free-text notes of the race, then of the leg, appended under the tables. */
function notes(leg: Leg, ctx: Ctx): string {
  const parts = [ctx.race.notes, leg.notes].filter((n): n is string => !!n && n.trim() !== "");
  return parts.length ? NL + NL + parts.map((p) => p.trim()).join(NL + NL) : "";
}

/** The columns to use: the race's own layout, else the chosen default, else the profile's standard one. */
function cols(ctx: Ctx, kind: "oneday" | "stage"): Column[] {
  const variants = ctx.profile.tables.variants ?? {};
  // 1. a layout the race itself asks for, 2. the moderator's own columns, 3. the chosen named layout, 4. the standard one
  const own = ctx.race.table ?? ctx.reg?.table;
  const ownCols = own ? variants[own]?.[kind] : undefined;
  if (ownCols) return ownCols;
  const custom = ctx.opts.columns?.[kind];
  if (custom && custom.length) return custom;
  const chosen = ctx.opts.table ? variants[ctx.opts.table]?.[kind] : undefined;
  return chosen ?? ctx.profile.tables[kind];
}

function footer(kind: "oneday" | "stage" | "rest", ctx: Ctx): string {
  const f = ctx.profile.footers?.[kind];
  return f && f.trim() !== "" ? NL + NL + f.trim() : "";
}

function mkCtx(
  profile: Profile,
  race: SeasonRace,
  registry: Record<string, RegistryRace>,
  season: Season,
  opts: RenderOptions,
): Ctx {
  const reg = registry[race.race];
  const first = race.stages?.[0]?.date ?? race.date!;
  return {
    opts,
    profile,
    race,
    reg,
    name: race.name ?? reg!.name,
    category: race.category ?? reg!.category,
    year: typeof season.season === "number" ? season.season : yearOf(first),
    warnings: [],
  };
}

function vars(ctx: Ctx, extra: Record<string, string | number> = {}): Record<string, string | number> {
  return {
    year: ctx.year,
    name: ctx.name,
    tag: ctx.race.category !== undefined ? ctx.race.category : (ctx.reg?.titleTag ?? ctx.category),
    class: ctx.race.class,
    ...extra,
  };
}

function thread(
  ctx: Ctx,
  id: string,
  kind: Thread["kind"],
  title: string,
  body: string,
  first: string,
  last: string,
): Thread {
  return {
    id,
    kind,
    title,
    body: body + NL,
    firstDate: first,
    lastDate: last,
    suggestedPost: addDays(first, -1),
    warnings: [...ctx.warnings, ...lintThread(body, ctx.year)],
  };
}

export function renderRace(
  profile: Profile,
  registry: Record<string, RegistryRace>,
  season: Season,
  race: SeasonRace,
  opts: RenderOptions = {},
): Thread[] {
  const ctx = mkCtx(profile, race, registry, season, opts);
  const out: Thread[] = [];
  const id = race.race;

  if (!race.stages) {
    // A one-day race is its own leg. Take only the leg's own route fields so the
    // race-level info/extra/notes are not applied a second time.
    const leg: Leg = {
      date: race.date!,
      from: race.from,
      to: race.to,
      routeUrl: race.routeUrl,
      stageUrl: race.stageUrl,
      length: race.length,
      altitude: race.altitude,
      type: race.type,
      typeUrl: race.typeUrl,
      finish: race.finish,
      finishUrl: race.finishUrl,
      start: race.start,
      end: race.end,
    };
    const title = fill(profile.titles.oneday, vars(ctx));
    const body =
      table(cols(ctx, "oneday"), [leg], ctx, "route") +
      NL + NL + infoTable("oneday", leg, ctx) + notes(leg, ctx) + footer("oneday", ctx);
    out.push(thread(ctx, id, "race", title, body, leg.date, leg.date));
    return out;
  }

  const stages = [...race.stages].sort((a, b) => a.date.localeCompare(b.date));
  const first = stages[0]!.date;
  const last = stages[stages.length - 1]!.date;

  if (race.mega) {
    const mctx = mkCtx(profile, race, registry, season, opts);
    const title = fill(profile.titles.mega, vars(mctx));
    const body =
      table(cols(mctx, "stage"), stages, mctx, "stages") +
      NL + NL + infoTable("stage", {} as Leg, mctx) + NL + NL + profile.megaIntro;
    out.push(thread(mctx, id + "-mega", "mega", title, body, first, last));
  }

  for (const st of stages) {
    const sctx = mkCtx(profile, race, registry, season, opts);
    const title = fill(profile.titles.stage, vars(sctx, { stage: st.n }));
    const body =
      table(cols(sctx, "stage"), [st], sctx, "stage " + st.n) +
      NL + NL + infoTable("stage", st, sctx) + notes(st, sctx) + footer("stage", sctx);
    out.push(thread(sctx, id + "-stage-" + st.n, "stage", title, body, st.date, st.date));
  }

  (race.restDays ?? []).forEach((date, i) => {
    const rctx = mkCtx(profile, race, registry, season, opts);
    const title = fill(profile.titles.rest, vars(rctx, { n: i + 1 }));
    rctx.warnings.push("recap text: write it");
    const body = profile.restIntro + NL + NL + profile.restFooter + footer("rest", rctx);
    out.push(thread(rctx, id + "-rest-" + (i + 1), "rest", title, body, date, date));
  });

  return out;
}

/** All threads of a season in posting order. */
export function renderSeason(
  profile: Profile,
  registry: Record<string, RegistryRace>,
  season: Season,
  classes?: RaceClass[],
  opts: RenderOptions = {},
): Thread[] {
  const all: Thread[] = [];
  for (const race of season.races) {
    const extra = classes ? classWarnings(race.class, !!race.stages, classes) : [];
    for (const t of renderRace(profile, registry, season, race, opts)) {
      t.warnings.push(...extra);
      all.push(t);
    }
  }
  const rank = { mega: 0, race: 1, stage: 1, rest: 1 } as const;
  return all
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        a.t.firstDate.localeCompare(b.t.firstDate) ||
        rank[a.t.kind] - rank[b.t.kind] ||
        a.i - b.i,
    )
    .map((x) => x.t);
}

export type { Stage };
export { ddmm };
