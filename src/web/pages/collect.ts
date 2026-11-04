import { FinderOptions, currentRaces, initLinkFinder, linksBlock } from "./race-links";
import { CATEGORY_NAMES, JoinSuggestion, QueueLine, buildRaces, chainLines, normRaceName, parseRaceAliases, queueByRace, suggestJoins } from "../../core";
import { importCaptureFiles } from "../capture-import";
import { $, el, tick } from "../dom";
import type { Store } from "../store";

export function initCollect(store: Store, options: FinderOptions = {}): void {
  const cube = () => store.cube;

  /** Choose a category in the box (through its options, which every DOM allows). */
  const chooseCategory = (value: string) => {
    const select = $<HTMLSelectElement>("queuecat");
    const options = Array.from(select.options);
    for (const o of options) o.toggleAttribute("selected", false); // clear first: choosing one may clear the others
    const target = options.find((o) => o.value === value);
    if (target) {
      target.selected = true;
      target.toggleAttribute("selected", true);
    }
    try {
      select.value = value; // a browser's own selection (a test DOM cannot set it)
    } catch {
      /* the options above carry the choice */
    }
  };
  /** The chosen value of a select. A browser knows it; a test DOM without select values falls back to the options. */
  const chosen = (id: string) => {
    const select = $<HTMLSelectElement>(id);
    if (typeof select.value === "string" && select.value !== "") return select.value;
    const options = Array.from(select.options);
    return (options.find((o) => o.selected || o.hasAttribute("selected")) ?? options[0])?.value ?? "";
  };
  const chosenCategory = () => chosen("queuecat") || "ME";
  /** WorldTour, ProSeries and championships: the classes the main interest is in. */
  const isTop = (cls?: string) => /UWT|WWT|Pro|WC|CM/i.test(cls ?? "");
  /** "Stage 14: Stage Classification" -> "Stage 14"; "Final Classification: General Classification" -> "General Classification". */
  const shortEvent = (name: string) => name.replace(": Stage Classification", "").replace("Final Classification: ", "").replace("Final Result: ", "");
  /** The lines under a race that say, per year, which events are missing or wait for their next page, each a link to that event. */
  function missingRow(editions: QueueLine[], columns: number): HTMLElement {
    const td = el("td");
    td.setAttribute("colspan", String(columns));
    for (const e of [...editions].sort((a, b) => b.year - a.year)) {
      if (!e.missingEvents.length && !e.waitingEvents.length) continue;
      const line = el("div");
      line.append(el("b", { textContent: e.year + ": " }));
      const list = (events: { id: number; name: string }[], title: string) =>
        events.forEach((ev, i) => {
          if (i) line.append(", ");
          const href = "https://dataride.uci.ch/iframe/EventResults/" + ev.id + "?competitionId=" + e.uciId + "&disciplineId=10";
          line.append(el("a", { href, target: "_blank", rel: "noopener", textContent: shortEvent(ev.name), title }));
        });
      if (e.missingEvents.length) {
        line.append("not captured yet: ");
        list(e.missingEvents, "Open this event, then press the bookmark");
      }
      if (e.waitingEvents.length) {
        if (e.missingEvents.length) line.append(". ");
        line.append("next page still to read: ");
        list(e.waitingEvents, "Go to the next page of the table, then press the bookmark");
      }
      td.append(line);
    }
    return el("tr", { class: "detail" }, td);
  }
  /** How many joins wait for a decision; undefined = work it out again (it is the slow part, so only when the data changed). */
  let pendingJoins: number | undefined;
  /** How high a UCI class ranks: WorldTour first, then ProSeries, then the rest by level. */
  const tier = (cls?: string) => (/UWT|WWT/.test(cls ?? "") ? 0 : /Pro/.test(cls ?? "") ? 1 : /[12]\.1/.test(cls ?? "") ? 2 : /[12]\.2/.test(cls ?? "") ? 3 : 4);
  /** An edition is finished when every point-giving event on its competition page has a result read to the end. Without the event list nothing is known. */
  const finished = (e: { eventsKnown: number; eventsComplete: number }) => e.eventsKnown > 0 && e.eventsComplete >= e.eventsKnown;
  function status(e: { captured: boolean; rows: number; eventsKnown: number; eventsCaptured: number; eventsComplete: number }): [string, string] {
    if (!e.eventsKnown) return e.captured ? ["no event list (" + e.rows + ")", "Results are captured, but not the list of events: press the bookmark on the competition page"] : ["open", "Nothing captured yet"];
    const waiting = e.eventsCaptured - e.eventsComplete;
    return [e.eventsComplete + "/" + e.eventsKnown + " events", waiting ? waiting + " captured event(s) filled a whole page of the table: capture the next page" : e.eventsCaptured < e.eventsKnown ? "events still to capture" : "all events captured"];
  }

  function draw(): void {
    const all = queueByRace(cube(), store.getText("racealiases") ?? "");
    // each race with its internal name and its external names
    const records = new Map(buildRaces(cube(), store.getText("racealiases") ?? "", store.getText("racenames") ?? "", all.races).map((x) => [x.key, x]));
    const internal = (r: { key: string; name: string }) => records.get(r.key)?.name ?? r.name;
    if (pendingJoins === undefined) pendingJoins = suggestJoins(cube(), store.getText("racealiases") ?? "", store.getText("racenojoin") ?? "").length;
    const pending = pendingJoins;
    const refused = all.aliasReport.filter((r) => r.includes("not joined: one is a")).length; // saved lines that joined a time trial with a road race
    $("mergednote").textContent = (all.merged.length ? all.merged.length + " joined. " : "") + (refused ? refused + " saved join line" + (refused === 1 ? " was" : "s were") + " ignored: they joined different kinds of race (a time trial and a road race). " : "") + (pending ? pending + " possible join" + (pending === 1 ? "" : "s") + " to review." : "No more joins to review.");
    const years = all.years.filter((y) => y > 0);
    const onlyTop = $<HTMLInputElement>("queuetop").checked;
    // men's and women's races are kept apart: the page shows one category at a time
    const cat = chosenCategory();
    const inCategory = all.races.filter((r) => cat === "all" || r.category === cat);
    const races = onlyTop ? inCategory.filter((r) => Object.values(r.editions).some((e) => isTop(e.class))) : inCategory;
    const out = $("queueout");
    out.replaceChildren();
    const editions = races.flatMap((r) => Object.values(r.editions));
    const done = editions.filter(finished).length;
    const results = cube().raceResults?.length ?? 0;
    $("queuemsg").textContent = editions.length
      ? done + " of " + editions.length + " editions finished, " + races.length + " races, " + results + " races with results in the database."
      : "No races in the queue yet: capture the DataRide competition list (step 2 above), one page at a time, for each year.";
    const onlyMissing = $<HTMLInputElement>("queuemissing").checked;
    const unfinished = (r: (typeof races)[number]) => Object.values(r.editions).filter((e) => !finished(e)).length;
    let rows = onlyMissing ? races.filter((r) => unfinished(r) > 0) : races;
    // search by name (accents, case and punctuation do not matter), then sort
    const q = normRaceName($<HTMLInputElement>("queuesearch").value);
    if (q) rows = rows.filter((r) => normRaceName(r.name).includes(q) || normRaceName(r.keyName).includes(q) || normRaceName(internal(r)).includes(q) || (records.get(r.key)?.names ?? []).some((n) => normRaceName(n.name).includes(q)));
    const newestClass = (r: (typeof races)[number]) => Object.values(r.editions).reduce((a, b) => (b.year > a.year ? b : a)).class;
    const sort = chosen("queuesort");
    rows = [...rows].sort((a, b) =>
      sort === "class" ? tier(newestClass(a)) - tier(newestClass(b)) || internal(a).localeCompare(internal(b)) : sort === "todo" ? unfinished(b) - unfinished(a) || internal(a).localeCompare(internal(b)) : internal(a).localeCompare(internal(b)),
    );
    // say what the two filters are hiding, with a way to show it
    const hiddenDone = races.length - rows.length;
    const hiddenClass = inCategory.length - races.length;
    const hiddenCategory = all.races.length - inCategory.length;
    if (hiddenDone > 0 || hiddenClass > 0 || hiddenCategory > 0) {
      const note = el("div", { class: "mut" });
      note.style.margin = "6px 0";
      if (hiddenDone > 0) {
        const show = el("button", { textContent: "Show them" });
        show.onclick = () => {
          $<HTMLInputElement>("queuemissing").checked = false;
          draw();
        };
        note.append(hiddenDone + " finished race" + (hiddenDone === 1 ? "" : "s") + " hidden. ", show, " ");
      }
      if (hiddenClass > 0) {
        const show = el("button", { textContent: "Show them" });
        show.onclick = () => {
          $<HTMLInputElement>("queuetop").checked = false;
          draw();
        };
        note.append(hiddenClass + " race" + (hiddenClass === 1 ? "" : "s") + " in other classes hidden. ", show);
      }
      if (hiddenCategory > 0) {
        const show = el("button", { textContent: "Show them" });
        show.onclick = () => {
          chooseCategory("all");
          draw();
        };
        note.append(" " + hiddenCategory + " " + (cat === "ME" ? "women's" : "men's") + " race" + (hiddenCategory === 1 ? "" : "s") + " hidden. ", show);
      }
      out.append(note);
    }
    if (!rows.length) return;

    const table = el("table", { class: "queue" });
    const head = el("tr", {}, el("th", { textContent: "Race" }), el("th", { textContent: "Done" }));
    for (const y of years) head.append(el("th", { textContent: String(y) }));
    table.append(head);
    for (const r of rows) {
      const eds = Object.values(r.editions);
      const nameCell = el("td");
      // the UCI class in front of the name: the newest edition's, with the history in the tooltip when it changed
      const newest = eds.reduce((a, b) => (b.year > a.year ? b : a));
      if (newest.class) {
        const changed = new Set(eds.map((e) => e.class).filter(Boolean)).size > 1;
        const tag = el("span", { class: "tag", textContent: newest.class });
        if (changed) tag.title = eds.sort((a, b) => b.year - a.year).map((e) => e.year + ": " + (e.class ?? "?")).join(", ");
        nameCell.append(tag);
      }
      nameCell.append(internal(r) + (r.category === "ME" ? "" : " (" + CATEGORY_NAMES[r.category].toLowerCase() + ")"));
      const rec = records.get(r.key);
      if (rec && (rec.names.length > 1 || rec.names[0]?.name !== rec.name)) nameCell.title = "External names: " + rec.names.map((n) => n.name + " (" + (n.years.length > 1 ? n.years[0] + "-" + n.years[n.years.length - 1] : n.years[0]) + ")").join("; ");
      const tr = el("tr", {}, nameCell, el("td", { textContent: eds.filter(finished).length + "/" + eds.length }));
      if (eds.some((e) => e.missingEvents.length || e.waitingEvents.length)) {
        // a twist in front of the name opens the list of what is missing under the row
        const twist = el("button", { class: "twist", textContent: "▸", title: "Which events are missing", type: "button" });
        twist.onclick = () => {
          const open = tr.nextElementSibling?.classList.contains("detail");
          if (open) tr.nextElementSibling!.remove();
          else tr.after(missingRow(eds, 2 + years.length));
          twist.textContent = open ? "▸" : "▾";
        };
        nameCell.prepend(twist);
      }
      for (const y of years) {
        const e = r.editions[y];
        const td = el("td");
        if (!e) {
          td.textContent = "-";
        } else {
          const a = el("a", {
            href: "https://dataride.uci.ch/iframe/CompetitionResults/" + e.uciId + "?disciplineId=10",
            target: "_blank",
            rel: "noopener",
            textContent: status(e)[0],
            title: (e.class ? e.class + ", " : "") + e.name + ", " + e.start + (e.start === e.end ? "" : " to " + e.end) + ". " + status(e)[1],
          });
          if (finished(e)) a.style.opacity = "0.6";
          td.append(a);
        }
        tr.append(td);
      }
      table.append(tr);
    }
    out.append(table);
  }

  $<HTMLInputElement>("capturefile").onchange = async (e) => {
    const lines = await importCaptureFiles(store, [...((e.target as HTMLInputElement).files ?? [])]);
    pendingJoins = undefined;
    draw();
    $("queuemsg").textContent = lines.join(" | ") + " | " + $("queuemsg").textContent;
  };
  const NL = String.fromCharCode(10);
  const years = (ys: number[]) => (ys.length === 1 ? String(ys[0]) : ys[0] + "-" + ys[ys.length - 1]);

  /** Race names: find a race by any of its names, change its internal name, see its external names. */
  function renderNames(message = ""): void {
    const list = $("racenamelist");
    list.replaceChildren();
    const q = normRaceName($<HTMLInputElement>("racefind").value);
    if (message) list.append(el("p", { class: "mut", textContent: message }));
    if (q.length < 2) return;
    const aliases = store.getText("racealiases") ?? "";
    const renames = store.getText("racenames") ?? "";
    const matches = currentRaces(store).filter((r) => normRaceName(r.name).includes(q) || r.names.some((n) => normRaceName(n.name).includes(q)));
    if (!matches.length) {
      list.append(el("p", { class: "mut", textContent: "No race with that name." }));
      return;
    }
    for (const race of matches.slice(0, 8)) {
      const input = el("input", { type: "text", value: race.name, spellcheck: false });
      input.style.width = "300px";
      const save = el("button", { textContent: "Save name", type: "button" });
      save.onclick = async () => {
        const name = input.value.trim();
        if (!name) return;
        const external = new Set(race.names.map((n) => normRaceName(n.name)));
        // the race's earlier rename line goes; a new one is written only when the name differs from the default
        const kept = renames.split(NL).filter((line) => !parseRaceAliases(line).some(([ext]) => external.has(normRaceName(ext))));
        const byDefault = buildRaces(cube(), aliases, kept.join(NL)).find((x) => x.key === race.key)?.name;
        const next = (name === byDefault ? kept : [...kept, race.names[0]!.name + " = " + name]).filter((x) => x.trim() !== "").join(NL);
        await store.setText("racenames", next);
        draw();
        renderNames('"' + name + '" saved.');
      };
      const years = (ys: number[]) => (ys.length > 1 ? ys[0] + "-" + ys[ys.length - 1] : String(ys[0]));
      list.append(
        el(
          "div",
          { class: "card" },
          el("div", { class: "row" }, el("b", { textContent: "Internal name" }), input, save, el("span", { class: "mut", textContent: (race.category === "WE" ? "women's elite" : "men's elite") + ", " + years(race.years) })),
          el("div", { class: "mut", textContent: "External names: " + race.names.map((n) => n.name + " (" + years(n.years) + ")").join("; ") }),
          linksBlock(store, race, () => {
            draw();
            renderNames();
          }),
        ),
      );
    }
  }
  $("racefind").oninput = () => renderNames();
  initLinkFinder(store, options, {
    category: chosenCategory,
    changed: () => {
      draw();
      renderNames();
    },
  });

  /**
   * The one-time review: every likely pair gets a decision. "Same race" is written as an alias line, "Not the same" is
   * remembered as rejected, and "Don't know" does nothing, so the pair comes back next time. Men's and women's pairs are
   * listed apart, for the category chosen at the top of the page (both, in two tables, when "Both" is chosen).
   */
  function review(): void {
    const box = $("joinreview");
    box.replaceChildren();
    const isNational = (j: JoinSuggestion) => /national road/i.test(j.fromName);
    const cat = chosenCategory();
    const sections: ("ME" | "WE")[] = cat === "all" ? ["ME", "WE"] : [cat === "WE" ? "WE" : "ME"];
    const every = suggestJoins(cube(), store.getText("racealiases") ?? "", store.getText("racenojoin") ?? "");
    const mine = every.filter((j) => sections.includes(j.category));
    if (!mine.length) {
      const other = every.length - mine.length;
      const where = cat === "all" ? "." : " for " + CATEGORY_NAMES[sections[0]!].toLowerCase() + (other ? " (" + other + " for the other category: choose it, or Both, in the Category box above)." : ".");
      box.append(el("p", { class: "mut", textContent: "No likely joins found" + where }));
      return;
    }
    type Decision = "same" | "diff" | "unknown";
    type Row = { j: JoinSuggestion; state: Decision; tr: HTMLElement; buttons: Record<Decision, HTMLButtonElement> };
    const rows: Row[] = [];
    const decide = (r: Row, state: Decision) => {
      r.state = state;
      r.tr.classList.toggle("rejected", state === "diff");
      for (const k of ["same", "diff", "unknown"] as const) {
        r.buttons[k].classList.toggle("on", k === state);
        r.buttons[k].setAttribute("aria-pressed", String(k === state));
      }
    };
    box.append(el("p", { class: "mut", textContent: mine.length + " likely joins. Decide each pair; the ones you leave as Don't know come back next time. A joined race is shown under its newest name." }));
    for (const section of sections) {
      const list = mine.filter((j) => j.category === section).sort((x, y) => Number(isNational(x)) - Number(isNational(y))); // national championships go last
      if (!list.length) continue;
      box.append(el("h3", { textContent: (section === "WE" ? "Women's elite races" : "Men's elite races") + " (" + list.length + ")" }));
      const table = el("table", { class: "queue" });
      table.append(el("tr", {}, el("th", { textContent: "Your decision" }), el("th", { textContent: "One name" }), el("th", { textContent: "The other name" }), el("th", { textContent: "Years of each" })));
      for (const j of list) {
        const mk = (label: string, cls: string) => el("button", { textContent: label, class: "seg-" + cls, type: "button" });
        const buttons = { same: mk("Same race", "same"), diff: mk("Not the same", "diff"), unknown: mk("Don't know", "unknown") };
        const tr = el(
          "tr",
          {},
          el("td", { class: "seg" }, buttons.same, buttons.diff, buttons.unknown),
          el("td", { textContent: j.fromName }),
          el("td", { textContent: (j.class ? j.class + " " : "") + j.intoName }),
          el("td", { textContent: years(j.fromYears) + " and " + years(j.intoYears) }),
        );
        const row: Row = { j, state: "unknown", tr, buttons };
        buttons.same.onclick = () => decide(row, "same");
        buttons.diff.onclick = () => decide(row, "diff");
        buttons.unknown.onclick = () => decide(row, "unknown");
        decide(row, "unknown");
        rows.push(row);
        table.append(tr);
      }
      box.append(table);
    }
    const bulk = (label: string, state: Decision, only: (r: Row) => boolean = () => true) => {
      const b = el("button", { textContent: label });
      b.onclick = () => rows.filter(only).forEach((r) => decide(r, state));
      return b;
    };
    const nationals = rows.filter((r) => isNational(r.j)).length;
    const apply = el("button", { textContent: "Save my decisions" });
    apply.onclick = async () => {
      const yes = chainLines(rows.filter((r) => r.state === "same").map((r): [string, string] => [r.j.from, r.j.into]));
      const no = rows.filter((r) => r.state === "diff").map((r) => r.j.from + " = " + r.j.into);
      const left = rows.filter((r) => r.state === "unknown").length;
      const keep = (key: string, add: string[]) => [store.getText(key) ?? "", ...add].filter((x) => x !== "").join(NL);
      await store.setText("racealiases", keep("racealiases", yes));
      await store.setText("racenojoin", keep("racenojoin", no));
      $<HTMLTextAreaElement>("racealiases").value = store.getText("racealiases") ?? "";
      box.replaceChildren();
      $("aliasmsg").textContent = rows.filter((r) => r.state === "same").length + " pairs joined, " + no.length + " marked as not the same (not suggested again), " + left + " left undecided.";
      pendingJoins = undefined;
      draw();
    };
    const cancel = el("button", { textContent: "Cancel" });
    cancel.onclick = () => box.replaceChildren();
    box.append(
      el(
        "div",
        { class: "row" },
        bulk("Mark all as the same race", "same"),
        bulk("Mark all as not the same", "diff"),
        ...(nationals ? [bulk("Mark national championships as not the same (" + nationals + ")", "diff", (r) => isNational(r.j))] : []),
        bulk("Clear all (don't know)", "unknown"),
        apply,
        cancel,
      ),
    );
  }
  $("joinfind").onclick = review;

  $<HTMLTextAreaElement>("racealiases").value = store.getText("racealiases") ?? "";
  $("racealiasessave").onclick = async () => {
    const msg = $("aliasmsg");
    msg.textContent = "Saving ...";
    try {
      await store.setText("racealiases", $<HTMLTextAreaElement>("racealiases").value);
    } catch (e) {
      msg.textContent = "Could not save: " + (e instanceof Error ? e.message : String(e));
    }
    pendingJoins = undefined;
    draw(); // joins what it can even when the save failed
    const report = queueByRace(cube(), $<HTMLTextAreaElement>("racealiases").value).aliasReport;
    if (msg.textContent === "Saving ...") msg.textContent = report.length ? "Saved. " + report.join(" | ") : "Saved. No alias lines to apply (write one as: old name = new name).";
  };
  $("queuemissing").onchange = draw;
  $("queuetop").onchange = draw;
  $("queuesearch").oninput = draw;
  $("queuesort").onchange = draw;
  const catBox = $<HTMLSelectElement>("queuecat");
  chooseCategory(tick("racecat") ?? "ME");
  catBox.onchange = () => {
    tick("racecat", chosenCategory());
    draw();
  };
  store.onChange(() => {
    pendingJoins = undefined;
    draw();
  });
  draw();
}
