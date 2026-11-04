import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { addCapture, emptyCube } from "../src/core";
import { initCollect } from "../src/web/pages/collect";
import { forgetChoices } from "../src/web/dom";
import { fakeWikidata } from "./helpers/wikidata";
import type { Store } from "../src/web/store";

// the real page, with a queue of four races: one finished, one not, one in a class the filter leaves out, one women's
function page(): { doc: Document; text: () => string } {
  forgetChoices(); // every page is a fresh visit
  const html = readFileSync(new URL("../src/site/collect.html", import.meta.url), "utf8");
  const { document } = parseHTML(html);
  (globalThis as unknown as { document: Document }).document = document as unknown as Document;
  const doc = document as unknown as Document;
  // a browser starts these ticked (checked in the HTML); the test DOM does not read that attribute
  for (const id of ["queuemissing", "queuetop"]) (doc.getElementById(id) as HTMLInputElement).checked = true;

  const cube = emptyCube();
  const comp = (id: number, name: string, cls: string, category: "ME" | "WE" = "ME") => ({ id, name, start: "2026-04-05", end: "2026-04-05", year: 2026, country: "BEL", class: cls, inProgress: false, category });
  addCapture(cube, { format: "racethreads-capture/1", competitions: [comp(1, "Finished Classic", "1.UWT"), comp(2, "Waiting Classic", "1.Pro"), comp(3, "Small Race", "1.2"), comp(4, "Women's Classic", "1.WWT", "WE")] });
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ rank: i + 1, rider: "R" + i, team: "T", age: 25, nation: "BEL", result: "x", points: 5 }));
  // race 1: the table ended on a short page; race 2: a full page of scoring rows, the next page not read
  addCapture(cube, { format: "racethreads-capture/1", eventResults: [{ competitionId: 1, eventId: 11, heading: "x", totalRows: 20, rows: rows(20) }, { competitionId: 2, eventId: 22, heading: "x", totalRows: 40, rows: rows(40) }] });

  const store = { cube, onChange: () => undefined, saveCube: async () => undefined, getText: () => undefined, setText: async () => undefined } as unknown as Store;
  initCollect(store);
  return { doc, text: () => doc.getElementById("queueout")!.textContent ?? "" };
}

// a page with a small queue built from (name, year, class) lines, and a store that remembers what is saved
function pageWith(names: [string, number, string?, ("ME" | "WE")?][], beforeInit?: (doc: Document) => void, prepare?: (cube: ReturnType<typeof emptyCube>) => void, options?: { fetch?: typeof fetch; pause?: number }) {
  const html = readFileSync(new URL("../src/site/collect.html", import.meta.url), "utf8");
  const { document } = parseHTML(html);
  (globalThis as unknown as { document: Document }).document = document as unknown as Document;
  const doc = document as unknown as Document;
  for (const id of ["queuemissing", "queuetop"]) (doc.getElementById(id) as HTMLInputElement).checked = false;
  const cube = emptyCube();
  const comp = (id: number, name: string, year: number, cls = "1.1", category: "ME" | "WE" = "ME") => ({ id, name, start: year + "-06-01", end: year + "-06-01", year, country: "FRA", class: cls, inProgress: false, category });
  addCapture(cube, { format: "racethreads-capture/1", competitions: names.map(([n, y, c, k], i) => comp(i + 1, n, y, c, k)) });
  const texts = new Map<string, string>();
  const store = { cube, onChange: () => undefined, saveCube: async () => undefined, getText: (k: string) => texts.get(k), setText: async (k: string, v: string) => void texts.set(k, v) } as unknown as Store;
  prepare?.(cube);
  beforeInit?.(doc);
  initCollect(store, options);
  const rows = () => Array.from(doc.querySelectorAll("#queueout table tr td:first-child")).map((c) => c.textContent ?? "").filter((t) => t.includes("Mayenne"));
  const button = (label: string) => Array.from(doc.querySelectorAll("button")).find((b) => b.textContent === label) as HTMLButtonElement;
  return { doc, texts, rows, button };
}

describe("races whose names changed", () => {
  const MAYENNE: [string, number][] = [["Boucles de la Mayenne", 2026], ["Boucles de la Mayenne - Crédit Mutuel", 2025]];
  const choices = (doc: Document) => Array.from(doc.querySelectorAll("#joinreview td.seg button")) as HTMLButtonElement[];
  const choice = (doc: Document, label: string, row = 0) => choices(doc).filter((b) => b.textContent === label)[row]!;
  const save = (button: (l: string) => HTMLButtonElement) => (button("Save my decisions").onclick as () => Promise<void>)();

  it("stay two rows until you review, and the page says how many joins wait", () => {
    const { doc, rows } = pageWith(MAYENNE);
    expect(rows()).toHaveLength(2);
    expect(doc.getElementById("mergednote")!.textContent).toContain("1 possible join to review");
  });
  it("Find joins gives each pair three clear choices, and decides nothing until you do", () => {
    const { doc, button } = pageWith(MAYENNE);
    button("Find joins").click();
    expect(choices(doc).map((b) => b.textContent)).toEqual(["Same race", "Not the same", "Don't know"]);
    expect(choice(doc, "Don't know").classList.contains("on")).toBe(true); // nothing is decided yet
    expect(choice(doc, "Same race").classList.contains("on")).toBe(false);
    const cells = Array.from(doc.querySelectorAll("#joinreview tr:nth-child(2) td")).map((c) => c.textContent);
    expect(cells.slice(1)).toEqual(["Boucles de la Mayenne - Crédit Mutuel", "1.1 Boucles de la Mayenne", "2025 and 2026"]);
    choice(doc, "Same race").click();
    expect(choice(doc, "Same race").classList.contains("on")).toBe(true);
    expect(choice(doc, "Don't know").classList.contains("on")).toBe(false);
  });
  it("Same race writes the alias line and joins the two", async () => {
    const { doc, texts, rows, button } = pageWith(MAYENNE);
    button("Find joins").click();
    choice(doc, "Same race").click();
    await save(button);
    expect(texts.get("racealiases")).toBe("Boucles de la Mayenne - Crédit Mutuel = Boucles de la Mayenne");
    expect(rows()).toHaveLength(1);
    expect(doc.getElementById("joinreview")!.textContent).toBe("");
    expect(doc.getElementById("mergednote")!.textContent).toContain("No more joins to review");
    expect(doc.getElementById("aliasmsg")!.textContent).toContain("1 pairs joined");
  });
  it("Not the same is struck through at once, remembered, and not suggested again", async () => {
    const { doc, texts, rows, button } = pageWith(MAYENNE);
    button("Find joins").click();
    choice(doc, "Not the same").click();
    expect(doc.querySelector("#joinreview tr.rejected")).not.toBeNull();
    await save(button);
    expect(texts.get("racenojoin")).toContain("Boucles de la Mayenne");
    expect(texts.get("racealiases")).toBe("");
    expect(rows()).toHaveLength(2);
    expect(doc.getElementById("mergednote")!.textContent).toContain("No more joins to review");
  });
  it("Don't know stores nothing, and the pair comes back next time", async () => {
    const { doc, texts, rows, button } = pageWith(MAYENNE);
    button("Find joins").click();
    await save(button); // saved without deciding
    expect(texts.get("racealiases")).toBe("");
    expect(texts.get("racenojoin")).toBe("");
    expect(rows()).toHaveLength(2);
    expect(doc.getElementById("aliasmsg")!.textContent).toContain("1 left undecided");
    expect(doc.getElementById("mergednote")!.textContent).toContain("1 possible join to review");
    button("Find joins").click();
    expect(choices(doc)).toHaveLength(3); // there it is again
  });
  it("Mark all as not the same rejects every pair at once", async () => {
    const { doc, texts, rows, button } = pageWith(MAYENNE);
    button("Find joins").click();
    button("Mark all as not the same").click();
    expect(doc.querySelectorAll("#joinreview tr.rejected")).toHaveLength(1);
    await save(button);
    expect(texts.get("racenojoin")).toContain("Boucles de la Mayenne");
    expect(rows()).toHaveLength(2);
    expect(doc.getElementById("aliasmsg")!.textContent).toContain("1 marked as not the same");
  });
  it("men's and women's pairs are never in the same table", () => {
    const names: [string, number, string?, ("ME" | "WE")?][] = [
      ["Alpha Grand Prix", 2026, "1.1", "ME"], ["Alpha Grand Prix Open", 2025, "1.1", "ME"],
      ["Beta Grand Prix", 2026, "1.WWT", "WE"], ["Beta Grand Prix Open", 2025, "1.WWT", "WE"],
    ];
    const headings = (doc: Document) => Array.from(doc.querySelectorAll("#joinreview h3")).map((h) => h.textContent);
    const pick = (doc: Document, value: string) => {
      const sel = doc.getElementById("queuecat") as HTMLSelectElement;
      for (const o of Array.from(sel.options)) o.toggleAttribute("selected", false);
      const target = Array.from(sel.options).find((o) => o.value === value)!;
      target.selected = true;
      target.toggleAttribute("selected", true);
    };
    const men = pageWith(names);
    men.button("Find joins").click();
    expect(headings(men.doc)).toEqual(["Men's elite races (1)"]);
    expect(men.doc.getElementById("joinreview")!.textContent).not.toContain("Beta");

    const women = pageWith(names);
    pick(women.doc, "WE");
    women.button("Find joins").click();
    expect(headings(women.doc)).toEqual(["Women's elite races (1)"]);
    expect(women.doc.getElementById("joinreview")!.textContent).not.toContain("Alpha");

    const both = pageWith(names);
    pick(both.doc, "all");
    both.button("Find joins").click();
    expect(headings(both.doc)).toEqual(["Men's elite races (1)", "Women's elite races (1)"]);
    expect(both.doc.querySelectorAll("#joinreview table")).toHaveLength(2);
  });
});

describe("which events are missing", () => {
  it("a twist on an unfinished race lists the missing events as links to their DataRide pages", () => {
    const { doc } = pageWith([["Stage Tour", 2026, "2.Pro"]], undefined, (cube) => {
      addCapture(cube, { format: "racethreads-capture/1", competitionEvents: [{ competitionId: 1, events: [{ id: 11, name: "Stage 1: Stage Classification" }, { id: 12, name: "Stage 2: Stage Classification" }, { id: 13, name: "Final Classification: General Classification" }] }] });
      const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ rank: i + 1, rider: "R" + i, team: "T", age: 25, nation: "BEL", result: "x", points: 5 }));
      addCapture(cube, { format: "racethreads-capture/1", eventResults: [{ competitionId: 1, eventId: 11, heading: "x", totalRows: 40, rows: rows(5) }, { competitionId: 1, eventId: 12, heading: "x", totalRows: 40, rows: rows(40) }] });
    });
    const twist = doc.querySelector("#queueout button.twist") as HTMLButtonElement;
    expect(twist).not.toBeNull();
    expect(doc.querySelector("#queueout tr.detail")).toBeNull(); // closed until you ask
    twist.click();
    const detail = doc.querySelector("#queueout tr.detail")!;
    expect(detail.textContent).toContain("2026: not captured yet: General Classification");
    expect(detail.textContent).toContain("next page still to read: Stage 2");
    const hrefs = Array.from(detail.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "https://dataride.uci.ch/iframe/EventResults/13?competitionId=1&disciplineId=10",
      "https://dataride.uci.ch/iframe/EventResults/12?competitionId=1&disciplineId=10",
    ]);
    twist.click(); // and closes again
    expect(doc.querySelector("#queueout tr.detail")).toBeNull();
  });
  it("a finished race has no twist", () => {
    const { doc } = pageWith([["Finished Classic", 2026, "1.UWT"]], undefined, (cube) => {
      addCapture(cube, { format: "racethreads-capture/1", eventResults: [{ competitionId: 1, eventId: 5, heading: "x", totalRows: 40, rows: [{ rank: 1, rider: "R", team: "T", age: 25, nation: "BEL", result: "x", points: 5 }] }] });
    });
    expect(doc.querySelector("#queueout button.twist")).toBeNull();
  });
});

describe("internal and external race names", () => {
  const NAMES: [string, number, string?][] = [["Classic Brugge-De Panne", 2024], ["MINERVA CLASSIC BRUGGE - DE PANNE", 2022], ["Oxyclean Classic Brugge-De Panne", 2021]];
  const firstCells = (doc: Document) => Array.from(doc.querySelectorAll("#queueout table tr td:first-child")).map((c) => c as HTMLElement);

  it("the queue shows the internal name, and the external names UCI used on hover, once the names are joined", async () => {
    const { doc, texts, button } = pageWith(NAMES);
    button("Find joins").click();
    button("Mark all as the same race").click();
    await (button("Save my decisions").onclick as () => Promise<void>)();
    expect(texts.get("racealiases")).toContain("=");
    const cells = firstCells(doc).filter((c) => /Brugge/i.test(c.textContent ?? ""));
    expect(cells).toHaveLength(1);
    expect(cells[0]!.textContent).toContain("Classic Brugge-De Panne");
    expect(cells[0]!.textContent).not.toContain("MINERVA");
    expect(cells[0]!.title).toContain("MINERVA CLASSIC BRUGGE - DE PANNE (2022)");
    expect(cells[0]!.title).toContain("Oxyclean Classic Brugge-De Panne (2021)");
  });
  it("finding a race by any of its names shows its internal name and its external names", () => {
    const { doc } = pageWith(NAMES);
    const find = doc.getElementById("racefind") as HTMLInputElement;
    find.value = "minerva";
    find.oninput!(new Event("input") as unknown as InputEvent);
    const card = doc.querySelector("#racenamelist .card")!;
    expect(card.textContent).toContain("Internal name");
    expect(card.textContent).toContain("External names: MINERVA CLASSIC BRUGGE - DE PANNE (2022)");
  });
  it("saving a new internal name writes a rename line and the queue shows it; saving the default name removes the line again", async () => {
    const { doc, texts, button } = pageWith(NAMES);
    button("Find joins").click();
    button("Mark all as the same race").click();
    await (button("Save my decisions").onclick as () => Promise<void>)();
    const find = doc.getElementById("racefind") as HTMLInputElement;
    find.value = "oxyclean";
    find.oninput!(new Event("input") as unknown as InputEvent);
    const field = doc.querySelector("#racenamelist input[type=text]") as HTMLInputElement;
    field.value = "Brugge - De Panne";
    await (button("Save name").onclick as () => Promise<void>)();
    expect(texts.get("racenames")).toContain("= Brugge - De Panne");
    expect(firstCells(doc).some((c) => (c.textContent ?? "").includes("Brugge - De Panne") && !(c.textContent ?? "").includes("Classic"))).toBe(true);
    // back to the default name: the rename line is removed
    find.oninput!(new Event("input") as unknown as InputEvent);
    const again = doc.querySelector("#racenamelist input[type=text]") as HTMLInputElement;
    again.value = "Classic Brugge-De Panne";
    await (button("Save name").onclick as () => Promise<void>)();
    expect(texts.get("racenames")).toBe("");
  });
});

describe("race links", () => {
  const MONUMENTS: [string, number, string?][] = [["Milano-Sanremo", 2025, "1.UWT"], ["Tour of Flanders", 2025, "1.UWT"], ["Paris-Roubaix", 2025, "1.UWT"], ["Liège-Bastogne-Liège", 2025, "1.UWT"], ["Il Lombardia", 2025, "1.UWT"], ["Small Local Race", 2025, "1.2"]];
  const find = (doc: Document) => (doc.getElementById("linkfind")!.onclick as () => Promise<void>)();
  const saveDecisions = (doc: Document) => (Array.from(doc.querySelectorAll("#linkreview button")).find((b) => b.textContent === "Save my decisions") as HTMLButtonElement).onclick as () => Promise<void>;

  it("Find links asks Wikidata about the World Tour races only, and shows each match to decide on", async () => {
    const asked: string[] = [];
    const { doc, texts } = pageWith(MONUMENTS, undefined, undefined, { fetch: fakeWikidata(asked), pause: 0 });
    await find(doc);
    expect(asked.sort()).toEqual(["Il Lombardia", "Liège-Bastogne-Liège", "Milano-Sanremo", "Paris-Roubaix", "Tour of Flanders"]); // not the small local race
    expect(doc.querySelectorAll("#linkreview tr.rejected").length).toBe(0);
    const rows = Array.from(doc.querySelectorAll("#linkreview td.seg")).map((c) => c.parentElement!.textContent ?? "");
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.includes("Milano-Sanremo"))).toContain("Milan - San Remo (Q33951)");
    expect(rows.find((r) => r.includes("Il Lombardia"))).toContain("Giro di Lombardia (Q34032)"); // UCI's name and Wikidata's differ
    expect(doc.getElementById("linkreview")!.textContent).toContain("Instagram, Facebook, X, Wikidata"); // what Flanders would add
    expect(texts.get("racelinks")).toBeUndefined(); // nothing saved until you decide
  });
  it("saving the clear matches stores the links, and they show on the race's card", async () => {
    const { doc, texts } = pageWith(MONUMENTS, undefined, undefined, { fetch: fakeWikidata(), pause: 0 });
    await find(doc);
    (Array.from(doc.querySelectorAll("#linkreview button")).find((b) => (b.textContent ?? "").startsWith("Mark the clear matches")) as HTMLButtonElement).click();
    expect(doc.querySelectorAll("#linkreview td.seg button.on.seg-same")).toHaveLength(5);
    await saveDecisions(doc)();
    const stored = JSON.parse(texts.get("racelinks")!) as Record<string, { kind: string; url: string }[]>;
    expect(Object.keys(stored)).toHaveLength(5);
    expect(stored["parisroubaix|ME"]!.map((l) => l.kind)).toEqual(["website", "wikipedia", "instagram", "facebook", "x", "wikidata"]);
    expect(doc.getElementById("linkmsg")!.textContent).toContain("5 races got their links");
    // the card under Race names
    const box = doc.getElementById("racefind") as HTMLInputElement;
    box.value = "roubaix";
    box.oninput!(new Event("input") as unknown as InputEvent);
    const card = doc.querySelector("#racenamelist .card")!;
    expect(Array.from(card.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Official site", "Wikipedia", "Instagram", "Facebook", "X", "Wikidata"]);
    expect(card.querySelector('a[title^="https://www.paris-roubaix.fr/"]')).not.toBeNull();
  });
  it("a match marked Not the same is not offered again, and nothing is stored for it", async () => {
    const { doc, texts } = pageWith(MONUMENTS.slice(0, 1), undefined, undefined, { fetch: fakeWikidata(), pause: 0 });
    await find(doc);
    (doc.querySelector("#linkreview td.seg .seg-diff") as HTMLButtonElement).click();
    await saveDecisions(doc)();
    expect(texts.get("racelinks")).toBe("{}");
    expect(JSON.parse(texts.get("linkrejected")!)).toEqual({ "milanosanremo|ME": ["Q33951"] });
    await find(doc);
    expect(doc.getElementById("linkreview")!.textContent).not.toContain("Q33951"); // the next best, or none
  });
  it("Don't know leaves everything as it was", async () => {
    const { doc, texts } = pageWith(MONUMENTS.slice(0, 2), undefined, undefined, { fetch: fakeWikidata(), pause: 0 });
    await find(doc);
    await saveDecisions(doc)();
    expect(texts.get("racelinks")).toBe("{}");
    expect(texts.get("linkrejected")).toBe("{}");
    expect(doc.getElementById("linkmsg")!.textContent).toContain("2 left undecided");
  });
  it("only the races you name are looked up, and a race Wikidata does not have says so", async () => {
    const asked: string[] = [];
    const { doc } = pageWith([...MONUMENTS.slice(0, 3), ["Unknown Classic", 2025, "1.UWT"]], undefined, undefined, { fetch: fakeWikidata(asked), pause: 0 });
    (doc.getElementById("linkonly") as HTMLInputElement).value = "roubaix, unknown classic";
    await find(doc);
    expect(asked.sort()).toEqual(["Paris-Roubaix", "Unknown", "Unknown Classic"]); // an unknown race is also tried without the word Classic
    expect(doc.getElementById("linkreview")!.textContent).toContain("No match on Wikidata");
  });
  it("says so and keeps what it has when Wikidata does not answer", async () => {
    let calls = 0;
    const flaky = (async () => {
      if (++calls > 2) throw new Error("network down");
      return new Response(JSON.stringify({ search: [] }));
    }) as unknown as typeof fetch;
    const { doc } = pageWith(MONUMENTS.slice(0, 5), undefined, undefined, { fetch: flaky, pause: 0 });
    await find(doc);
    expect(doc.getElementById("linkmsg")!.textContent).toContain("Wikidata did not answer (network down)");
    expect(doc.getElementById("linkfind")!.hasAttribute("disabled")).toBe(false); // can be pressed again
  });
  it("a link can be added by hand, shown, and removed again; registry links cannot be removed here", async () => {
    const { doc, texts } = pageWith([["Paris-Roubaix", 2025, "1.UWT"]], undefined, (cube) => void cube, { fetch: fakeWikidata(), pause: 0 });
    texts.set("registry", ["paris-roubaix-me:", "  name: Paris-Roubaix", "  category: ME", "  officialSite: https://www.paris-roubaix.fr/"].join(String.fromCharCode(10)));
    const box = doc.getElementById("racefind") as HTMLInputElement;
    const open = () => {
      box.value = "roubaix";
      box.oninput!(new Event("input") as unknown as InputEvent);
    };
    open();
    let card = doc.querySelector("#racenamelist .card")!;
    expect(card.textContent).toContain("Official site"); // from the registry
    expect(card.querySelectorAll("button.twist")).toHaveLength(0); // not removable here
    (card.querySelector("input[placeholder='https://...']") as HTMLInputElement).value = "https://www.instagram.com/parisroubaixcourse";
    const kinds = Array.from((card.querySelector("select") as HTMLSelectElement).options);
    for (const o of kinds) o.toggleAttribute("selected", o.value === "instagram");
    const add = Array.from(card.querySelectorAll("button")).find((b) => b.textContent === "Add link") as HTMLButtonElement;
    await (add.onclick as () => Promise<void>)();
    card = doc.querySelector("#racenamelist .card")!;
    const shown = () => Array.from(doc.querySelectorAll("#racenamelist .card a")).map((a) => a.textContent);
    expect(shown()).toEqual(["Official site", "Instagram"]);
    expect(JSON.parse(texts.get("racelinks")!)["parisroubaix|ME"][0]).toMatchObject({ url: "https://www.instagram.com/parisroubaixcourse", source: "manual" });
    await ((card.querySelector("button.twist") as HTMLButtonElement).onclick as () => Promise<void>)();
    expect(shown()).toEqual(["Official site"]);
  });
});

describe("the Category box in a real browser", () => {
  it("follows the browser's own selection, not the marker the page leaves on the first option", () => {
    const names: [string, number, string?, ("ME" | "WE")?][] = [["Alpha Grand Prix", 2026, "1.1", "ME"], ["Beta Grand Prix", 2026, "1.WWT", "WE"]];
    let shown = "WE"; // what the box shows: the user chose Women elite
    const { doc } = pageWith(names, (d) => {
      const select = d.getElementById("queuecat") as HTMLSelectElement;
      Object.defineProperty(select, "value", { get: () => shown, configurable: true }); // a browser's select knows its value
    });
    // the page's own start-up marks "Men elite" with a selected attribute; that must not win over the browser's answer
    const text = () => doc.getElementById("queueout")!.textContent ?? "";
    expect(text()).toContain("Beta Grand Prix");
    expect(text()).not.toContain("Alpha Grand Prix");
    expect(text()).toContain("1 men's race hidden");
    shown = "ME";
    (doc.getElementById("queuecat") as HTMLSelectElement).onchange!(new Event("change"));
    expect(text()).toContain("Alpha Grand Prix");
    expect(text()).not.toContain("Beta Grand Prix");
  });
});

describe("the Save and join button", () => {
  it("joins the two names you wrote, on the page, and remembers the line", async () => {
    const html = readFileSync(new URL("../src/site/collect.html", import.meta.url), "utf8");
    const { document } = parseHTML(html);
    (globalThis as unknown as { document: Document }).document = document as unknown as Document;
    const doc = document as unknown as Document;
    for (const id of ["queuemissing", "queuetop"]) (doc.getElementById(id) as HTMLInputElement).checked = false;
    const cube = emptyCube();
    const comp = (id: number, name: string, year: number) => ({ id, name, start: year + "-06-01", end: year + "-06-08", year, country: "FRA", class: "2.UWT", inProgress: false, category: "ME" as const });
    addCapture(cube, { format: "racethreads-capture/1", competitions: [comp(1, "Critérium du Dauphiné", 2025), comp(2, "Critérium du Dauphiné", 2024), comp(3, "Tour Auvergne - Rhône-Alpes", 2026)] });
    const texts = new Map<string, string>();
    const store = { cube, onChange: () => undefined, saveCube: async () => undefined, getText: (k: string) => texts.get(k), setText: async (k: string, v: string) => void texts.set(k, v) } as unknown as Store;
    initCollect(store);
    const rows = () => Array.from(doc.querySelectorAll("#queueout table tr td:first-child")).map((c) => c.textContent);
    expect(rows().filter((r) => /Dauphin|Auvergne/.test(r ?? ""))).toHaveLength(2);

    (doc.getElementById("racealiases") as HTMLTextAreaElement).value = "Critérium du Dauphiné = Tour Auvergne - Rhône-Alpes";
    await (doc.getElementById("racealiasessave")!.onclick as () => Promise<void>)();
    expect(rows().filter((r) => /Dauphin|Auvergne/.test(r ?? ""))).toHaveLength(1);
    expect(texts.get("racealiases")).toContain("Dauphiné");
    expect(doc.getElementById("mergednote")!.textContent).toContain("1 joined");
    expect(doc.getElementById("aliasmsg")!.textContent).toContain("joined");
  });
  it("says why a line did nothing", async () => {
    const html = readFileSync(new URL("../src/site/collect.html", import.meta.url), "utf8");
    const { document } = parseHTML(html);
    (globalThis as unknown as { document: Document }).document = document as unknown as Document;
    const doc = document as unknown as Document;
    for (const id of ["queuemissing", "queuetop"]) (doc.getElementById(id) as HTMLInputElement).checked = false;
    const cube = emptyCube();
    const comp = (id: number, name: string, year: number) => ({ id, name, start: year + "-06-01", end: year + "-06-08", year, country: "FRA", class: "2.UWT", inProgress: false, category: "ME" as const });
    addCapture(cube, { format: "racethreads-capture/1", competitions: [comp(1, "Race One", 2026), comp(2, "Race Two", 2026)] });
    const store = { cube, onChange: () => undefined, saveCube: async () => undefined, getText: () => undefined, setText: async () => undefined } as unknown as Store;
    initCollect(store);
    const NL = String.fromCharCode(10);
    (doc.getElementById("racealiases") as HTMLTextAreaElement).value = ["Race One = Race Two", "Race One = Nothing Like It"].join(NL);
    await (doc.getElementById("racealiasessave")!.onclick as () => Promise<void>)();
    const said = doc.getElementById("aliasmsg")!.textContent ?? "";
    expect(said).toContain("same year");
    expect(said).toContain('no race named "Nothing Like It"');
  });
});

describe("men's and women's races", () => {
  it("shows men's elite by default and says how many women's races are hidden", () => {
    const { text, doc } = page();
    const chosen = Array.from((doc.getElementById("queuecat") as HTMLSelectElement).options).find((o) => o.selected || o.hasAttribute("selected"));
    expect(chosen?.value ?? "ME").toBe("ME");
    expect(text()).toContain("Waiting Classic");
    expect(text()).not.toContain("Women's Classic");
    expect(text()).toContain("1 women's race hidden");
  });
  it("shows the women's races when asked, labelled as women's", () => {
    const { text, doc } = page();
    const sel = doc.getElementById("queuecat") as HTMLSelectElement;
    for (const o of Array.from(sel.options)) o.toggleAttribute("selected", false);
    const women = Array.from(sel.options).find((o) => o.value === "WE")!;
    women.selected = true;
    women.toggleAttribute("selected", true);
    sel.onchange!(new Event("change"));
    expect(text()).toContain("Women's Classic (women elite)");
    expect(text()).not.toContain("Waiting Classic");
  });
});

describe("the race queue page", () => {
  it("lists the unfinished race, and says how many finished and how many other-class races are hidden", () => {
    const { text } = page();
    expect(text()).toContain("Waiting Classic");
    expect(text()).not.toContain("Finished Classic");
    expect(text()).not.toContain("Small Race");
    expect(text()).toContain("1 finished race hidden");
    expect(text()).toContain("1 race in other classes hidden");
  });
  it("the Show them button next to the note shows the hidden races", () => {
    const { doc, text } = page();
    const show = Array.from(doc.querySelectorAll("#queueout button")).find((b) => b.textContent === "Show them") as HTMLButtonElement;
    show.click();
    expect(text()).toContain("Finished Classic");
    expect((doc.getElementById("queuemissing") as HTMLInputElement).checked).toBe(false);
  });
  it("puts the UCI class in front of the race name", () => {
    const { doc } = page();
    (doc.getElementById("queuemissing") as HTMLInputElement).checked = false;
    doc.getElementById("queuemissing")!.onchange!(new Event("change"));
    const cells = Array.from(doc.querySelectorAll("#queueout table tr td:first-child"));
    const finished = cells.find((c) => c.textContent?.includes("Finished Classic"))!;
    expect(finished.firstElementChild?.textContent).toBe("1.UWT");
    expect(finished.textContent).toBe("1.UWTFinished Classic");
    const waiting = cells.find((c) => c.textContent?.includes("Waiting Classic"))!;
    expect(waiting.querySelector(".tag")?.textContent).toBe("1.Pro"); // an unfinished race also has a twist in front of the pill
  });
  it("searches by name, ignoring case and accents", () => {
    const { doc, text } = page();
    (doc.getElementById("queuemissing") as HTMLInputElement).checked = false;
    const box = doc.getElementById("queuesearch") as HTMLInputElement;
    box.value = "FINISHED";
    box.oninput!(new Event("input") as unknown as InputEvent);
    expect(text()).toContain("Finished Classic");
    expect(text()).not.toContain("Waiting Classic");
  });
  it("sorts by class, WorldTour first, or by name", () => {
    const { doc } = pageWith([["Alpha Classic", 2026, "1.1"], ["Zeta Classic", 2026, "1.UWT"], ["Middle Classic", 2026, "1.Pro"]]);
    const order = () => Array.from(doc.querySelectorAll("#queueout table tr td:first-child")).map((c) => (c.textContent ?? "").replace(/^[0-9A-Za-z.]*(?=[A-Z][a-z]+ Classic)/, ""));
    const sort = doc.getElementById("queuesort") as HTMLSelectElement;
    const choose = (v: string) => {
      for (const o of Array.from(sort.options)) o.toggleAttribute("selected", false);
      const target = Array.from(sort.options).find((o) => o.value === v)!;
      target.selected = true;
      target.toggleAttribute("selected", true);
      sort.onchange!(new Event("change"));
    };
    choose("name");
    expect(order().filter((t) => /Classic/.test(t)).map((t) => t.slice(-14))).toHaveLength(3);
    const names = () => order().filter((t) => /Classic/.test(t)).map((t) => (/Alpha|Zeta|Middle/.exec(t) ?? [""])[0]);
    expect(names()).toEqual(["Alpha", "Middle", "Zeta"]);
    choose("class");
    expect(names()).toEqual(["Zeta", "Middle", "Alpha"]); // UWT, then Pro, then 1.1
  });
  it("shows the finished race when the filter is switched off", () => {
    const { doc, text } = page();
    (doc.getElementById("queuemissing") as HTMLInputElement).checked = false;
    doc.getElementById("queuemissing")!.onchange!(new Event("change"));
    expect(text()).toContain("Finished Classic");
    expect(text()).not.toContain("finished race hidden");
    expect(text()).toContain("1/1 events");
  });
});
