import profileYaml from "../../../data/profiles/peloton.yaml";
import registryYaml from "../../../data/peloton/races.yaml";
import fixturesYaml from "../../../data/peloton/2026-fixtures.yaml";
import classesYaml from "../../../data/classes.yaml";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import {
  RegistryRace,
  SeasonError,
  Thread,
  applyLearned,
  draftSeason,
  fetchWikitext,
  learnFromYears,
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
  slugify,
  toRegistryEntry,
} from "../../core";
import { $, NL, copy, download, el, tick } from "../dom";
import { initLayout, LayoutControl } from "../layout";
import type { Store } from "../store";

const profile = parseProfile(profileYaml);
const classes = parseClasses(classesYaml);

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function initThreads(store: Store): void {
  let layout: LayoutControl | undefined;
  let threads: Thread[] = [];

  const seasonBox = () => $<HTMLTextAreaElement>("season");
  const registryBox = () => $<HTMLTextAreaElement>("registry");

  function render(): void {
    const out = $("out");
    const msg = $("msg");
    out.replaceChildren();
    msg.textContent = "";
    msg.className = "";
    let registry;
    try {
      registry = parseRegistry(registryBox().value);
    } catch (e) {
      showError(e);
      return;
    }
    let season;
    try {
      season = parseSeason(seasonBox().value, registry);
    } catch (e) {
      showError(e);
      return;
    }
    threads = renderSeason(profile, registry, season, classes, layout?.options() ?? {});
    void store.setText("season", seasonBox().value);
    void store.setText("registry", registryBox().value);
    const todo = threads.reduce((n, t) => n + t.warnings.length, 0);
    fillRaceChoices();
    msg.textContent = threads.length + " threads" + (todo ? ", " + todo + " things still to fill in" : "");
    threads.forEach((t) => out.append(card(t)));
  }

  function showError(e: unknown): void {
    const msg = $("msg");
    msg.className = "err";
    msg.textContent = e instanceof SeasonError ? "Fix these first:" + NL + e.errors.map((x) => "- " + x).join(NL) : String(e);
  }

  function card(t: Thread): HTMLElement {
    const key = "rt-done-" + t.id + "-" + t.firstDate;
    const c = el("div", { class: "card" });
    const cb = el("input", { type: "checkbox", checked: tick(key) === "1" });
    c.classList.toggle("done", cb.checked);
    cb.onchange = () => {
      tick(key, cb.checked ? "1" : "0");
      c.classList.toggle("done", cb.checked);
    };
    const b1 = el("button", { textContent: "Copy title" });
    b1.onclick = () => copy(t.title, b1);
    const b2 = el("button", { textContent: "Copy body" });
    b2.onclick = () => copy(t.body, b2);
    const head = el("div", { class: "row" }, cb, el("div", { class: "title", textContent: t.title }), b1, b2);
    const info = el("div", {
      class: "mut",
      textContent: t.kind + " | race date " + t.firstDate + (t.lastDate !== t.firstDate ? " to " + t.lastDate : "") + " | suggested post date " + t.suggestedPost,
    });
    c.append(head, info);
    if (t.warnings.length) c.append(el("div", { class: "warn", textContent: "Still to fill in: " + t.warnings.join("; ") }));
    c.append(el("details", {}, el("summary", { textContent: "Preview markdown" }), el("pre", { textContent: t.body })));
    return c;
  }

  function importIcs(text: string): void {
    const year = Number($<HTMLInputElement>("year").value) || new Date().getFullYear();
    const picked = [...document.querySelectorAll<HTMLInputElement>("input[name=cls]:checked")].map((x) => x.value);
    let registry = {};
    try {
      registry = parseRegistry(registryBox().value);
    } catch {
      /* an invalid registry is reported by render() */
    }
    const events = parseIcs(text);
    const season = draftSeason(events, { year, registry, classes: picked });
    seasonBox().value = seasonToYaml(season);
    $("importmsg").textContent = events.length + " calendar entries read, " + season.races.length + " races drafted";
    render();
  }

  const seasonObj = (): Obj => (yamlParse(seasonBox().value) as Obj) ?? {};
  const registryObj = (): Obj => (yamlParse(registryBox().value) as Obj) ?? {};
  const raceName = (race: Obj, registry: Obj): string => String(race.name ?? registry[race.race]?.name ?? race.race);

  function fillRaceChoices(): void {
    const sel = $<HTMLSelectElement>("wprace");
    const keep = sel.value;
    sel.replaceChildren();
    try {
      const s = seasonObj();
      const r = registryObj();
      for (const race of (s.races ?? []) as Obj[]) {
        sel.append(el("option", { value: race.race, textContent: raceName(race, r) + " (" + race.race + ")" }));
      }
      if (keep) sel.value = keep;
    } catch {
      /* invalid YAML is reported by render() */
    }
  }

  function wpSay(text: string, err = false): void {
    const m = $("wpmsg");
    m.textContent = text;
    m.className = err ? "err" : "mut";
  }

  async function fillStages(): Promise<void> {
    const id = $<HTMLSelectElement>("wprace").value;
    const title = $<HTMLInputElement>("wptitle").value.trim();
    if (!id || !title) return wpSay("Pick a race and type the Wikipedia edition page.", true);
    try {
      const s = seasonObj();
      const year = Number(/\b(19|20)\d\d\b/.exec(title)?.[0] ?? s.season);
      wpSay("Fetching " + title + "...");
      const draft = parseStageTable(await fetchWikitext(title), year);
      if (!draft.stages.length) return wpSay("No stage table found on that page.", true);
      const race = (s.races as Obj[]).find((r) => r.race === id)!;
      const have = new Map(((race.stages ?? []) as Obj[]).map((x) => [x.n, x]));
      // What you already typed wins; Wikipedia only fills the gaps.
      race.stages = draft.stages.map((d) => ({ ...d, ...have.get(d.n) }));
      if (!race.restDays?.length && draft.restDays.length) race.restDays = draft.restDays;
      delete race.date;
      seasonBox().value = yamlStringify(s, { lineWidth: 0 });
      wpSay(draft.stages.length + " stages and " + draft.restDays.length + " rest days from Wikipedia. Check them.");
      render();
    } catch (e) {
      wpSay(String(e instanceof Error ? e.message : e), true);
    }
  }

  async function lookupWebsite(): Promise<void> {
    const id = $<HTMLSelectElement>("wprace").value;
    const box = $("wpresults");
    box.replaceChildren();
    try {
      const s = seasonObj();
      const reg = registryObj();
      const race = (s.races as Obj[]).find((r) => r.race === id);
      if (!race) return wpSay("Pick a race first.", true);
      const name = raceName(race, reg);
      wpSay("Looking up " + name + "...");
      const found = await lookupRace(name);
      wpSay(found.length + " candidates for " + name + ". Pick the right one (men's and women's are separate entries).");
      for (const c of found) {
        const b = el("button", { textContent: "Use", title: "Copy website and Wikipedia link into the race registry" });
        b.onclick = () => {
          const r2 = registryObj();
          const entry = (r2[id] ??= { name, category: race.category ?? "ME" });
          if (c.officialSite) entry.officialSite = c.officialSite;
          if (c.wikipedia) entry.wikipedia = c.wikipedia;
          registryBox().value = yamlStringify(r2, { lineWidth: 0 });
          wpSay("Saved to the registry for " + id + ".");
          render();
        };
        box.append(el("div", { class: "row" }, b, el("span", { textContent: c.label + ": " + c.description + " | " + (c.officialSite ?? "no website") + " | " + (c.wikipedia ?? "no Wikipedia page") })));
      }
    } catch (e) {
      wpSay(String(e instanceof Error ? e.message : e), true);
    }
  }

  function importStageTable(): void {
    const msg = $("stagemsg");
    try {
      const id = $<HTMLSelectElement>("wprace").value;
      const s = seasonObj();
      const race = (s.races as Obj[] | undefined)?.find((r) => r.race === id);
      if (!race) {
        msg.textContent = "Pick the race under 'Wikipedia helpers' first (add it to the season if it is not listed).";
        return;
      }
      const year = Number(s.season) || new Date().getFullYear();
      const parsed = parseMarkdownStages($<HTMLTextAreaElement>("stagetable").value, year);
      if (!parsed.stages.length) {
        msg.textContent = parsed.notes.join(NL) || "No stages found.";
        return;
      }
      // The pasted table is what the moderator typed: it wins over what is already there, field by field.
      const have = new Map(((race.stages ?? []) as Obj[]).map((x) => [x.n, x]));
      race.stages = parsed.stages.map((p) => ({ ...have.get(p.n), ...p }));
      delete race.date;
      if (parsed.restDays.length) race.restDays = parsed.restDays;
      if (parsed.tz && !race.tz) race.tz = parsed.tz;
      seasonBox().value = yamlStringify(s, { lineWidth: 0 });
      msg.textContent =
        parsed.stages.length + " stages and " + parsed.restDays.length + " rest days imported" +
        (parsed.tz ? " (time zone " + parsed.tz + ")" : "") + (parsed.notes.length ? NL + parsed.notes.join(NL) : "");
      render();
    } catch (e) {
      msg.textContent = String(e instanceof Error ? e.message : e);
    }
  }

  /** Split a paste of several old threads at each "[Race Thread]" title line. */
  function splitThreads(text: string): string[] {
    const parts: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*(#+\s*)?\[Race Thread\]/i.test(line) || parts.length === 0) parts.push(line);
      else parts[parts.length - 1] += NL + line;
    }
    return parts.filter((p) => p.trim() !== "");
  }

  const slugifyId = (p: { name?: string; category?: string }): string => slugify(p.name ?? "") + "-" + (p.category ?? "me").toLowerCase();

  function learn(): void {
    const msg = $("learnmsg");
    try {
      const reg = registryObj();
      const lines: string[] = [];
      const byRace = new Map<string, ReturnType<typeof parseOldThread>[]>();
      for (const md of splitThreads($<HTMLTextAreaElement>("oldthreads").value)) {
        const parsed = parseOldThread(md);
        if (!parsed.name) {
          lines.push("Skipped a block: no [Race Thread] title found.");
          continue;
        }
        const r = toRegistryEntry(parsed, reg[slugifyId(parsed)] as RegistryRace | undefined, profile);
        byRace.set(r.id, [...(byRace.get(r.id) ?? []), parsed]);
        const had = reg[r.id] !== undefined;
        reg[r.id] = r.entry;
        const left = Object.keys(r.yearOnly);
        lines.push(
          (had ? "Updated " : "Added ") + r.id + " from the " + (parsed.year ?? "?") + " thread" +
            (left.length ? " (year-specific rows left out: " + left.join(", ") + ")" : "") +
            (r.notes.length ? ". " + r.notes.join(". ") : ""),
        );
      }
      // Threads of two or more years of a race: what they share goes to the registry as links or patterns.
      for (const [id, parsed] of byRace) {
        if (new Set(parsed.map((p) => p.year)).size < 2) continue;
        const said = applyLearned(reg[id] as RegistryRace, learnFromYears(parsed));
        lines.push(said.length ? id + ", learned from several years:" + NL + said.map((s) => "  " + s).join(NL) : id + ": nothing new shared by the years.");
      }
      registryBox().value = yamlStringify(reg, { lineWidth: 0 });
      msg.textContent = lines.join(NL) + (lines.length ? NL + "Open the race registry below to review." : "");
      render();
    } catch (e) {
      msg.textContent = String(e instanceof Error ? e.message : e);
    }
  }

  function initClassBoxes(): void {
    const box = $("clsboxes");
    for (const c of classes) {
      const cb = el("input", { type: "checkbox", name: "cls", value: c.code, checked: c.rank <= 2 }); // WorldTour/WWT, ProSeries and the championships
      box.append(el("label", { title: c.name }, cb, " " + c.code));
    }
  }

  initClassBoxes();
  layout = initLayout(profile, render, store);
  registryBox().value = store.getText("registry") ?? registryYaml;
  seasonBox().value = store.getText("season") ?? fixturesYaml;
  $("render").onclick = render;
  $("learn").onclick = learn;
  $("stageimport").onclick = importStageTable;
  $("wpstages").onclick = () => void fillStages();
  $("wplookup").onclick = () => void lookupWebsite();
  $("reset").onclick = () => {
    registryBox().value = registryYaml;
    seasonBox().value = fixturesYaml;
    render();
  };
  $<HTMLInputElement>("ics").onchange = (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) f.text().then(importIcs);
  };
  $("dl-md").onclick = () => download("threads.md", threads.map((t) => t.title + NL + NL + t.body).join(NL + "-----" + NL + NL), "text/markdown");
  $("dl-yaml").onclick = () => download("season.yaml", seasonBox().value, "text/yaml");
  // data saved by another page or tab: pick it up
  store.onChange(() => {
    registryBox().value = store.getText("registry") ?? registryYaml;
    seasonBox().value = store.getText("season") ?? fixturesYaml;
    render();
  });
  render();
}
