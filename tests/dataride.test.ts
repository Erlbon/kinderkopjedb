import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js/dist/sql-wasm-inline.js";
import { Cube, addCapture, buildRaces, raceKind, chainLines, joinByHand, joinLinesOf, unjoinByHand, parseRaceAliases, suggestJoins, categoryFromFilter, cleanHeading, emptyCube, isComplete, isOtherCategory, isScoringEvent, mergeEvents, pageKind, queueByRace, queueStatus, readCompetitionEvents, readCompetitionList, readEventResults } from "../src/core";
import { loadCube, openDatabase, saveCube, setKv, writeRaces } from "../src/db";

const doc = (html: string) => parseHTML(html).document as unknown as Document;
const SQL = await initSqlJs();

// markup copied from the real DataRide pages (three rows each)
const LIST = `<html><body><table><thead><tr><th>Date</th><th>Competition</th><th>Country</th><th>Class</th></tr></thead><tbody>
<tr class="k-master-row" role="row"><td role="gridcell">14 Oct 2026</td><td role="gridcell"><a class="uci-competition-link" href="/iframe/CompetitionResults/77536?disciplineId=10">Giro del Veneto</a><span class="label uci-small-label false"></span></td><td role="gridcell"><div class="f32" style="display: flex"><div class="flag it"></div><div style="padding-left:37px;">ITA</div></div></td><td role="gridcell">1.Pro</td></tr>
<tr class="k-alt k-master-row" role="row"><td role="gridcell">14 Oct 2026</td><td role="gridcell"><a class="uci-competition-link" href="/iframe/CompetitionResults/77867?disciplineId=10">Veneto Women</a><span class="label uci-small-label false"></span></td><td role="gridcell"><div class="f32"><div class="flag it"></div><div>ITA</div></div></td><td role="gridcell">1.1</td></tr>
<tr class="k-master-row" role="row"><td role="gridcell">13 Oct-18 Oct 2026</td><td role="gridcell"><a class="uci-competition-link" href="/iframe/CompetitionResults/76415?disciplineId=10">Tour of Guangxi</a><span class="label uci-small-label true">IN PROGRESS</span></td><td role="gridcell"><div class="f32"><div class="flag cn"></div><div>CHN</div></div></td><td role="gridcell">2.UWT</td></tr>
</tbody></table></body></html>`;

const point = (n: string) => `<td class="points" role="gridcell"><span class="uci-points-left">${n}</span><span class="uci-points-right"></span></td>`;
const row = (rank: number, bib: number, rider: string, nation: string, team: string, age: number, result: string, pts: string) =>
  `<tr class="k-master-row" role="row"><td class="text-right">${rank}</td><td class="text-right">${bib}</td><td>${rider}</td><td><div class="f32"><div class="flag x"></div><div style="padding-left:37px;">${nation} </div></div></td><td>${team}</td><td>${age}</td><td>${result}</td><td></td>${point(pts)}</tr>`;
const EVENT = `<html><body><div>IFrame Giro del Veneto Individual Road Race - 14 Oct 2026 Results</div><table><thead><tr><th>Rank</th><th>BIB</th><th>Rider</th><th>Nation</th><th>Team</th><th>Age</th><th>Result</th><th>IRM</th><th>Points</th></tr></thead><tbody>
${row(1, 51, "SEIXAS Paul", "FRA", "DECATHLON CMA CGM TEAM", 20, "5:49:28", "800")}
${row(2, 111, "MAS Enric", "ESP", "MOVISTAR TEAM", 31, "00:00:48", "640")}
${row(3, 81, "CICCONE Giulio", "ITA", "LIDL-TREK", 32, "00:01:05", "520")}
${row(51, 5, "NOBODY Some", "BEL", "SOME TEAM", 25, "00:09:00", "")}
</tbody></table></body></html>`;

describe("which DataRide page is it", () => {
  it("tells the three kinds apart", () => {
    expect(pageKind("/iframe/Results/10/")).toBe("list");
    expect(pageKind("/iframe/CompetitionResults/77536")).toBe("competition");
    expect(pageKind("/iframe/EventResults/374263")).toBe("event");
    expect(pageKind("/competition-details/2026/ROA/78468")).toBeUndefined();
  });
});

describe("the competition list", () => {
  const list = readCompetitionList(doc(LIST));
  it("reads id, name, dates, country and class", () => {
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ id: 77536, name: "Giro del Veneto", start: "2026-10-14", end: "2026-10-14", year: 2026, country: "ITA", class: "1.Pro", inProgress: false });
    expect(list[2]).toMatchObject({ id: 76415, start: "2026-10-13", end: "2026-10-18", class: "2.UWT", inProgress: true });
  });
  it("tells women's races from the name, or from the page's Category filter", () => {
    expect(list[0]!.category).toBe("ME");
    expect(list[1]!.category).toBe("WE");
    expect(readCompetitionList(doc(LIST), "Women Elite")[0]!.category).toBe("WE");
  });
});

describe("the categories", () => {
  it("only men's and women's elite are collected", () => {
    expect(categoryFromFilter("Men Elite")).toBe("ME");
    expect(categoryFromFilter("Women Elite")).toBe("WE");
    for (const other of ["Men Under 23", "Women Under 23", "Men Junior", "Women Junior", "All", ""]) expect(categoryFromFilter(other), other).toBeUndefined();
    expect(isOtherCategory("Men Under 23")).toBe(true);
    expect(isOtherCategory("Women Junior")).toBe(true);
    expect(isOtherCategory("Men Elite")).toBe(false);
    expect(isOtherCategory("")).toBe(false);
  });
  it("a list captured under the Category filter keeps its category, whatever the race is called", () => {
    const men = readCompetitionList(doc(LIST), "Men Elite");
    expect(men.every((c) => c.category === "ME")).toBe(true);
    const women = readCompetitionList(doc(LIST), "Women Elite");
    expect(women.every((c) => c.category === "WE")).toBe(true);
  });
  it("the import says how many of each came in", () => {
    const cube = emptyCube();
    const r = addCapture(cube, { format: "racethreads-capture/1", competitions: [...readCompetitionList(doc(LIST), "Men Elite"), ...readCompetitionList(doc(LIST).documentElement.ownerDocument, "Women Elite").map((c) => ({ ...c, id: c.id + 1000 }))] });
    expect(r.categories).toEqual({ "Men elite": 3, "Women elite": 3 });
  });
});

describe("a competition page", () => {
  const link = (id: number, name: string) => `<tr class="k-master-row"><td><a href="/iframe/EventResults/${id}?competitionId=77382&disciplineId=10">${name}</a></td><td>CHRISTEN Jan</td></tr>`;
  const stage = (name: string, links: string) =>
    `<tr class="k-master-row"><td class="k-hierarchy-cell"></td><td>${name}</td><td>31 Jan 2026</td><td>Men Elite</td></tr><tr class="k-detail-row"><td colspan="4"><table><tbody>${links}</tbody></table></td></tr>`;
  const page = (rows: string) => `<table><tbody>${rows}</tbody></table>`;

  it("names each event after the stage row it sits under, so the stages do not look alike", () => {
    const html = page(
      stage("Stage 5", link(371486, "Stage Points Classification") + link(372678, "Stage Classification") + link(372786, "Stage Youth Classification")) +
        stage("Stage 4", link(369277, "Stage Classification")),
    );
    const r = readCompetitionEvents(doc(html), "/iframe/CompetitionResults/77382")!;
    expect(r.events.map((e) => e.name)).toEqual([
      "Stage 5: Stage Points Classification",
      "Stage 5: Stage Classification",
      "Stage 5: Stage Youth Classification",
      "Stage 4: Stage Classification",
    ]);
    expect(r.events.filter((e) => isScoringEvent(e.name)).map((e) => e.id)).toEqual([372678, 369277]);
  });
  it("a one-day race links to its event directly", () => {
    const html = `<a href="/iframe/EventResults/374263?competitionId=77536&disciplineId=10">General Classification</a><a href="/iframe/EventResults/374263?competitionId=77536&disciplineId=10">General Classification</a>`;
    expect(readCompetitionEvents(doc(html), "/iframe/CompetitionResults/77536")!.events).toEqual([{ id: 374263, name: "General Classification" }]);
  });
  it("events seen in several presses add up", () => {
    const one = [{ id: 2, name: "Stage 2: Stage Classification" }];
    const two = [{ id: 1, name: "Stage 1: Stage Classification" }, { id: 2, name: "Stage 2: Stage Classification" }];
    expect(mergeEvents(one, two).map((e) => e.id)).toEqual([1, 2]);
    const cube = emptyCube();
    addCapture(cube, { format: "racethreads-capture/1", competitionEvents: [{ competitionId: 5, events: one }] });
    addCapture(cube, { format: "racethreads-capture/1", competitionEvents: [{ competitionId: 5, events: [{ id: 3, name: "Final Classification: General Classification" }] }] });
    expect(cube.queue!.find((q) => q.uciId === 5)!.events!.map((e) => e.id)).toEqual([2, 3]);
  });
});

describe("an event page", () => {
  const r = readEventResults(doc(EVENT), "/iframe/EventResults/374263", "?competitionId=77536&disciplineId=10")!;
  it("keeps only the rows that score points, with every field", () => {
    expect(r).toMatchObject({ competitionId: 77536, eventId: 374263, totalRows: 51, date: "2026-10-14", heading: "Giro del Veneto Individual Road Race" });
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({ rank: 1, rider: "SEIXAS Paul", team: "DECATHLON CMA CGM TEAM", age: 20, nation: "FRA", result: "5:49:28", points: 800 });
  });
  it("reads the heading without the page's scripts", () => {
    const withScript = EVENT.replace("<body>", "<body><script>$(document).on('keydown', 'input', function(e) { if (e.which) { e.preventDefault(); } });</script>");
    expect(readEventResults(doc(withScript), "/iframe/EventResults/374263", "?competitionId=77536")!.heading).toBe("Giro del Veneto Individual Road Race");
    expect(cleanHeading("n', '.k-input', function(e) { x(); }); ADAC Cyclassics Individual Road Race")).toBe("ADAC Cyclassics Individual Road Race");
  });
  it("needs the event and competition in the address, and a result table", () => {
    expect(readEventResults(doc(EVENT), "/iframe/EventResults/374263", "")).toBeUndefined();
    expect(readEventResults(doc("<html><body>loading</body></html>"), "/iframe/EventResults/1", "?competitionId=2")).toBeUndefined();
  });
});

describe("when an event is complete", () => {
  it("is not complete while every row of the page scored: the next page may hold more points", () => {
    expect(isComplete({ rows: new Array(40).fill(0), totalRows: 40 })).toBe(false);
    expect(isComplete({ rows: new Array(40).fill(0), totalRows: 80 })).toBe(true); // the next page was read and went on past the last scoring row
    expect(isComplete({ rows: new Array(5).fill(0), totalRows: 40 })).toBe(true);
    expect(isComplete({ rows: new Array(58).fill(0), totalRows: 58 })).toBe(true); // 40 + a short last page, everyone scored: the table ended
    expect(isComplete({ rows: new Array(80).fill(0), totalRows: 80 })).toBe(false);
  });
  it("only the general classification and the stages count, not the jersey classifications", () => {
    for (const n of ["General Classification", "Stage 3", "Prologue", "Individual Time Trial", "Stage 5: Stage Classification", "Final Classification: General Classification", "Final Result: General Classification", "Prologue: Stage Classification"]) expect(isScoringEvent(n), n).toBe(true);
    // the standings after a stage, and the jersey classifications, are not what a race is counted by
    for (const n of ["Stage 5: Stage General Classification", "Stage 5: Overall Points Classification", "Stage 5: Overall Mountain Classification", "Stage 5: Overall Youth Classification", "Stage 5: Stage Points Classification", "Stage 5: Stage Mountain Classification", "Final Classification: Youth Classification"]) expect(isScoringEvent(n), n).toBe(false);
    for (const n of ["Points Classification", "Youth Classification", "Mountains Classification", "Teams Classification"]) expect(isScoringEvent(n), n).toBe(false);
  });
});

describe("the same race under different names", () => {
  const comp = (id: number, name: string, year: number, category: "ME" | "WE" = "ME") => ({ id, name, start: year + "-06-01", end: year + "-06-01", year, country: "FRA", class: "1.1", inProgress: false, category });
  const queue = (...c: ReturnType<typeof comp>[]) => {
    const cube = emptyCube();
    addCapture(cube, { format: "racethreads-capture/1", competitions: c });
    return cube;
  };

  it("suggests joining a race that gained a sponsor in its name, but joins nothing by itself", () => {
    const cube = queue(comp(1, "Boucles de la Mayenne", 2026), comp(2, "Boucles de la Mayenne", 2025), comp(3, "Boucles de la Mayenne - Crédit Mutuel", 2024), comp(4, "Boucles de la Mayenne - Crédit Mutuel", 2023));
    expect(queueByRace(cube).races).toHaveLength(2); // nothing joined without a decision
    const found = suggestJoins(cube);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ fromYears: [2023, 2024], intoYears: [2025, 2026], category: "ME" }); // the sponsored version into the plain core
    // the names are the two as they were before the join, not the one name after it
    expect(found[0]).toMatchObject({ fromName: "Boucles de la Mayenne - Crédit Mutuel", intoName: "Boucles de la Mayenne" });
    // accepting writes an alias line; with it the two are one race, with every year, under the newest name
    const line = found[0]!.from + " = " + found[0]!.into;
    const { races } = queueByRace(cube, line);
    expect(races).toHaveLength(1);
    expect(Object.keys(races[0]!.editions).sort()).toEqual(["2023", "2024", "2025", "2026"]);
    expect(races[0]!.name).toBe("Boucles de la Mayenne");
    // once accepted it is not suggested again, and a rejected pair stays rejected
    expect(suggestJoins(cube, line)).toHaveLength(0);
    expect(suggestJoins(cube, "", line)).toHaveLength(0);
  });
  it("also suggests names that share their telltale words, when neither holds the other (pass 2)", () => {
    const cube = queue(
      comp(1, "Gent-Wevelgem in Flanders Fields", 2021), comp(2, "In Flanders Fields - From Middelkerke to Wevelgem", 2023),
      comp(3, "Trofeo Alfredo Binda - Comune di Cittiglio", 2022, "WE"), comp(4, "Trofeo Alfredo Binda Cittiglio", 2025, "WE"),
    );
    const found = suggestJoins(cube);
    expect(found.map((j) => j.fromName + " -> " + j.intoName).sort()).toEqual([
      "Gent-Wevelgem in Flanders Fields -> In Flanders Fields - From Middelkerke to Wevelgem", // into the newest
      "Trofeo Alfredo Binda - Comune di Cittiglio -> Trofeo Alfredo Binda Cittiglio",
    ]);
    // each pair says what the two have in common
    const binda = found.find((j) => j.category === "WE")!;
    expect(binda.why).toEqual(["one name has all the other's words", "same week of the season", "same class", "same country"]);
    // accepting it joins them like any other line, and a rejection in either direction keeps it away
    const line = binda.from + " = " + binda.into;
    expect(queueByRace(cube, line).races).toHaveLength(3);
    expect(suggestJoins(cube, "", line).filter((j) => j.category === "WE")).toHaveLength(0);
    expect(suggestJoins(cube, "", binda.into + " = " + binda.from).filter((j) => j.category === "WE")).toHaveLength(0);
  });
  it("one shared word is enough only for two races of the same class in the same week", () => {
    const dated = (id: number, name: string, year: number, start: string, cls = "2.WWT") => ({ ...comp(id, name, year, "WE"), start: year + start, end: year + start, class: cls });
    expect(suggestJoins(queue(dated(1, "Baloise Belgium Tour", 2022, "-06-14"), dated(2, "Lotto Belgium Tour", 2024, "-06-16")))).toHaveLength(1);
    expect(suggestJoins(queue(dated(1, "Baloise Belgium Tour", 2022, "-06-14"), dated(2, "Lotto Belgium Tour", 2024, "-09-16")))).toHaveLength(0); // months apart
    expect(suggestJoins(queue(dated(1, "Baloise Belgium Tour", 2022, "-06-14"), dated(2, "Lotto Belgium Tour", 2024, "-06-16", "2.1")))).toHaveLength(0); // another class
    // words many races share (Tour, Grand Prix, Classic ...) never count
    expect(suggestJoins(queue(dated(1, "Grand Prix Alpha Classic", 2022, "-06-14"), dated(2, "Grand Prix Beta Classic", 2024, "-06-14")))).toHaveLength(0);
    // nor do championship words in other languages, the race kind, years and edition numbers
    expect(suggestJoins(queue(dated(1, "Championnats Nationaux Route - Belgique", 2021, "-06-14", "CN"), dated(2, "Championnats Nationaux Route - Suisse", 2022, "-06-14", "CN")))).toHaveLength(0);
    expect(suggestJoins(queue(dated(1, "Juegos Panamericanos Santiago 2023 - ITT", 2023, "-06-14"), dated(2, "XX Juegos Centroamericanos 2025 ITT", 2025, "-06-14")))).toHaveLength(0);
  });
  it("races ticked by hand are joined into the one with the newest edition, and can be unjoined", () => {
    const cube = queue(comp(1, "Tour des Flandres Femmes", 2021, "WE"), comp(2, "Ronde van Vlaanderen voor Vrouwen", 2022, "WE"), comp(3, "Ronde van Vlaanderen", 2025, "WE"), comp(4, "Ronde van Vlaanderen", 2025));
    const women = queueByRace(cube).races.filter((r) => r.category === "WE");
    const done = joinByHand(women);
    expect(done).toEqual({ lines: ["Ronde van Vlaanderen voor Vrouwen = Tour des Flandres Femmes = Ronde van Vlaanderen"] });
    const aliases = "Other A = Other B" + String.fromCharCode(10) + (done as { lines: string[] }).lines[0];
    const joined = queueByRace(cube, aliases).races;
    expect(joined.filter((r) => r.category === "WE").map((r) => Object.keys(r.editions).length)).toEqual([3]);
    expect(joined.filter((r) => r.category === "ME")).toHaveLength(1); // the men's race is untouched
    // unjoin: the race's line goes (others stay), and its pairs are not suggested again
    const names = ["Tour des Flandres Femmes", "Ronde van Vlaanderen voor Vrouwen", "Ronde van Vlaanderen"];
    expect(joinLinesOf(aliases, names)).toHaveLength(1);
    const undone = unjoinByHand(aliases, "", names);
    expect(undone).toMatchObject({ aliases: "Other A = Other B", removed: 1 });
    expect(queueByRace(cube, undone.aliases).races.filter((r) => r.category === "WE")).toHaveLength(3);
    expect(suggestJoins(cube, undone.aliases, undone.nojoin).filter((j) => j.category === "WE")).toHaveLength(0);
  });
  it("refuses to join by hand what cannot be one race, and says why", () => {
    const cube = queue(comp(1, "Alpha Race", 2024), comp(2, "Beta Race", 2024), comp(3, "Gamma Race", 2023, "WE"), comp(4, "Alpha Race (ITT)", 2022));
    const races = queueByRace(cube).races;
    const by = (n: string) => races.find((r) => r.name === n)!;
    expect(joinByHand([by("Alpha Race"), by("Beta Race")])).toEqual({ error: "Not joined: Alpha Race and Beta Race both have a 2024 edition, so they are two races." });
    expect(joinByHand([by("Alpha Race"), by("Gamma Race")])).toMatchObject({ error: expect.stringContaining("men's and women's") });
    expect(joinByHand([by("Alpha Race"), by("Alpha Race (ITT)")])).toMatchObject({ error: expect.stringContaining("time trial") });
    expect(joinByHand([by("Alpha Race")])).toMatchObject({ error: expect.stringContaining("two or more") });
  });
  it("keeps two races apart when both have an edition in the same year", () => {
    const cube = queue(comp(1, "Tour de Something Long", 2026), comp(2, "Tour de Something Long - Grand Prix", 2026));
    expect(suggestJoins(cube)).toHaveLength(0);
    expect(queueByRace(cube).races).toHaveLength(2);
  });
  it("does not join men's and women's races, or short names", () => {
    const cube = queue(comp(1, "Boucles de la Mayenne", 2026, "ME"), comp(2, "Boucles de la Mayenne - Crédit Mutuel", 2025, "WE"));
    expect(suggestJoins(cube)).toHaveLength(0);
    const short = queue(comp(3, "Giro", 2026), comp(4, "Giro del Veneto", 2025));
    expect(suggestJoins(short)).toHaveLength(0);
  });
  it("finds a race whose sponsor changes at the front of the name (Brugge-De Panne), men's and women's apart", () => {
    const cube = queue(
      comp(1, "Oxyclean Classic Brugge-De Panne", 2021), comp(2, "MINERVA CLASSIC BRUGGE - DE PANNE", 2022), comp(3, "Classic Brugge-De Panne", 2023), comp(4, "Classic Brugge-De Panne", 2024),
      comp(5, "Oxyclean Classic Brugge-De Panne", 2021, "WE"), comp(6, "EXTERIOO CLASSIC BRUGGE - DE PANNE", 2022, "WE"), comp(7, "Classic Brugge-De Panne", 2023, "WE"),
      comp(8, "Bredene Koksijde Classic", 2023),
    );
    expect(queueByRace(cube).races).toHaveLength(7);
    const found = suggestJoins(cube);
    expect(found.map((j) => j.category).sort()).toEqual(["ME", "ME", "WE", "WE"]);
    const lines = chainLines(found.map((j): [string, string] => [j.from, j.into])).join(String.fromCharCode(10));
    const { races } = queueByRace(cube, lines);
    const brugge = races.filter((r) => /brugge/i.test(r.name));
    expect(brugge.map((r) => [r.category, Object.keys(r.editions).length]).sort()).toEqual([["ME", 4], ["WE", 3]]);
    expect(races.some((r) => /Bredene/.test(r.name))).toBe(true); // an unrelated race stays on its own
  });
  it("a name that an earlier line already joined is reported as joined, not as missing", () => {
    const cube = queue(comp(1, "Alpha Grand Prix", 2021), comp(2, "Alpha Grand Prix Open", 2022), comp(3, "Alpha Grand Prix Open Belgium", 2023));
    const NL = String.fromCharCode(10);
    const { aliasReport, races } = queueByRace(cube, ["Alpha Grand Prix Open = Alpha Grand Prix", "Alpha Grand Prix Open = Alpha Grand Prix Open Belgium"].join(NL));
    expect(aliasReport[1]).toContain("already joined by an earlier line");
    expect(races.length).toBeGreaterThan(0);
  });
  it("stays fast on a big queue: hundreds of pairs, found in a moment (it once took 14 seconds)", () => {
    const many: ReturnType<typeof comp>[] = [];
    for (let i = 0; i < 700; i++) {
      many.push(comp(i * 2 + 1, "Grand Prix Number " + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)) + " Classic", 2026));
      many.push(comp(i * 2 + 2, "Sponsor " + (i % 7) + " Grand Prix Number " + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)) + " Classic", 2025));
    }
    const cube = queue(...many);
    const started = Date.now();
    const found = suggestJoins(cube);
    expect(found.length).toBeGreaterThan(600);
    expect(Date.now() - started).toBeLessThan(3000);
    const imported = Date.now();
    queue(...many); // the import itself, too
    expect(Date.now() - imported).toBeLessThan(1500);
  });
  it("says which events are missing and which only wait for the next page of their table", () => {
    const cube = queue(comp(1, "Stage Tour", 2026));
    const events = [{ id: 1, name: "Stage 1: Stage Classification" }, { id: 2, name: "Stage 2: Stage Classification" }, { id: 3, name: "Final Classification: General Classification" }, { id: 4, name: "Stage 1: Stage Points Classification" }];
    addCapture(cube, { format: "racethreads-capture/1", competitionEvents: [{ competitionId: 1, events }] });
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ rank: i + 1, rider: "R" + i, team: "T", age: 25, nation: "BEL", result: "x", points: 5 }));
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [
      { competitionId: 1, eventId: 1, heading: "x", totalRows: 40, rows: rows(5) }, // stage 1: the table went on past the points: complete
      { competitionId: 1, eventId: 2, heading: "x", totalRows: 40, rows: rows(40) }, // stage 2: every row scored, the next page is not read
    ] });
    const line = queueStatus(cube)[0]!;
    expect(line.missingEvents.map((e) => e.id)).toEqual([3]); // the final classification; the jersey event is not counted
    expect(line.waitingEvents.map((e) => e.id)).toEqual([2]);
    expect(line).toMatchObject({ eventsKnown: 3, eventsCaptured: 2, eventsComplete: 1 });
  });
  it("a race has an internal name (the core name) and keeps every name UCI used as an external name, with its years", () => {
    const cube = queue(
      comp(1, "Oxyclean Classic Brugge-De Panne", 2021), comp(2, "MINERVA CLASSIC BRUGGE - DE PANNE", 2022), comp(3, "Classic Brugge-De Panne", 2023), comp(4, "Classic Brugge-De Panne", 2024),
      comp(5, "Classic Brugge-De Panne", 2023, "WE"),
    );
    const NL = String.fromCharCode(10);
    const aliases = ["Oxyclean Classic Brugge-De Panne = MINERVA CLASSIC BRUGGE - DE PANNE = Classic Brugge-De Panne"].join(NL);
    const races = buildRaces(cube, aliases);
    expect(races).toHaveLength(2); // the men's race (four editions, three names) and the women's
    const men = races.find((r) => r.category === "ME")!;
    expect(men.name).toBe("Classic Brugge-De Panne"); // the shortest name without sponsors
    expect(men.slug).toBe("classic-brugge-de-panne");
    expect(men.names.map((n) => [n.name, n.years.join("/")])).toEqual([["Oxyclean Classic Brugge-De Panne", "2021"], ["MINERVA CLASSIC BRUGGE - DE PANNE", "2022"], ["Classic Brugge-De Panne", "2023/2024"]]);
    expect(men.years).toEqual([2021, 2022, 2023, 2024]);
    // the women's race has the same internal name, apart by category and slug
    const women = races.find((r) => r.category === "WE")!;
    expect(women.name).toBe("Classic Brugge-De Panne");
    expect(women.slug).toBe("classic-brugge-de-panne-women");
    // a rename line (any external name = internal name) sets the internal name
    const renamed = buildRaces(cube, aliases, "MINERVA CLASSIC BRUGGE - DE PANNE = Brugge-De Panne");
    expect(renamed.find((r) => r.category === "ME")!.name).toBe("Brugge-De Panne");
    expect(renamed.find((r) => r.category === "WE")!.name).toBe("Classic Brugge-De Panne");
  });
  it("a competition listed twice in a year under the same name still belongs to its race", () => {
    const cube = queue(comp(1, "National Road Championships - India", 2024, "WE"), comp(2, "National Road Championships - India", 2024, "WE"), comp(3, "National Road Championships - India", 2025, "WE"));
    const races = buildRaces(cube);
    expect(races).toHaveLength(1);
    expect(races[0]!.uciIds.sort()).toEqual([1, 2, 3]);
    const db = openDatabase(SQL);
    saveCube(db, cube);
    expect(db.exec("SELECT COUNT(*) FROM queue_race WHERE race_id IS NULL")[0]!.values[0]![0]).toBe(0);
  });
  it("knows a time trial from a road race by its name; IRR is a road race", () => {
    expect(raceKind("National Road Championships - Austria")).toBe("road");
    expect(raceKind("National Road Championships - Guam (IRR)")).toBe("road");
    expect(raceKind("National Road Championships - Austria (ITT)")).toBe("tt");
    expect(raceKind("National Road Championships - Honduras - ITT")).toBe("tt");
    expect(raceKind("National Road Championships - Chile ITT (WE)")).toBe("tt");
    expect(raceKind("Campeonato Nacional Contrarreloj")).toBe("road"); // a word we do not know stays road: joins are reviewed anyway
    expect(raceKind("Championnat de France Contre la Montre")).toBe("tt");
    expect(raceKind("Caribbean Elite Road Cycling Championships - ME ITT")).toBe("tt");
    expect(raceKind("World Championships Team Time Trial")).toBe("ttt");
    expect(raceKind("European Championships Mixed Team Relay")).toBe("relay");
  });
  it("never suggests or joins a time trial with the road race of the same name, even from a saved line", () => {
    const cube = queue(
      comp(1, "National Road Championships - Austria", 2021), comp(2, "National Road Championships - Austria (ITT)", 2023), comp(3, "National Road Championships - Austria (IRR)", 2024),
      comp(4, "National Road Championships - Oman", 2021), comp(5, "National Road Championships - Oman (IRR)", 2022),
    );
    const found = suggestJoins(cube);
    // the IRR version is a road race and joins the plain name; the ITT version is left alone
    expect(found.map((j) => j.fromName + " -> " + j.intoName).sort()).toEqual([
      "National Road Championships - Austria (IRR) -> National Road Championships - Austria",
      "National Road Championships - Oman (IRR) -> National Road Championships - Oman",
    ]);
    // a line saved earlier that joins them anyway is refused, and says why
    const { races, aliasReport } = queueByRace(cube, "National Road Championships - Austria (ITT) = National Road Championships - Austria");
    expect(races.filter((r) => /Austria/.test(r.name))).toHaveLength(3);
    expect(aliasReport[0]).toContain("not joined: one is a time trial and the other a road race");
  });
  it("two races never share an internal name inside a category", () => {
    const cube = queue(comp(1, "Alpha Classic", 2026), comp(2, "Alpha Classic Open", 2026));
    const races = buildRaces(cube, "", "Alpha Classic Open = Alpha Classic");
    expect(new Set(races.map((r) => r.name)).size).toBe(2);
    expect(new Set(races.map((r) => r.slug)).size).toBe(2);
  });
  it("the races are in the database, every edition and result points to its race, and a race keeps its id", () => {
    const cube = queue(comp(1, "Boucles de la Mayenne", 2022), comp(2, "Boucles de la Mayenne - Crédit Mutuel", 2025), comp(3, "Other Race Here", 2025));
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [{ competitionId: 2, eventId: 9, heading: "x", totalRows: 40, rows: [{ rank: 1, rider: "A B", team: "T", age: 30, nation: "FRA", result: "x", points: 5 }] }] });
    const db = openDatabase(SQL);
    saveCube(db, cube);
    setKv(db, "racealiases", "Boucles de la Mayenne - Crédit Mutuel = Boucles de la Mayenne");
    writeRaces(db, cube);
    const one = (sql: string) => db.exec(sql)[0]?.values[0]?.[0];
    expect(one("SELECT COUNT(*) FROM race")).toBe(2);
    expect(one("SELECT name FROM race WHERE name LIKE 'Boucles%'")).toBe("Boucles de la Mayenne");
    expect(one("SELECT COUNT(*) FROM race_name n JOIN race r ON r.race_id = n.race_id WHERE r.name LIKE 'Boucles%'")).toBe(2); // two external names
    expect(one("SELECT COUNT(DISTINCT race_id) FROM queue_race WHERE name LIKE 'Boucles%'")).toBe(1); // both editions: one race
    expect(one("SELECT race_name FROM v_results LIMIT 1")).toBe("Boucles de la Mayenne");
    const id = one("SELECT race_id FROM race WHERE name LIKE 'Boucles%'");
    saveCube(db, cube); // saving again keeps the id
    expect(one("SELECT race_id FROM race WHERE name LIKE 'Boucles%'")).toBe(id);
    // renaming changes the internal name, not the id and not the external names
    setKv(db, "racenames", "Boucles de la Mayenne = Mayenne Tour");
    writeRaces(db, cube);
    expect(one("SELECT name FROM race WHERE race_id = " + id)).toBe("Mayenne Tour");
    expect(one("SELECT COUNT(*) FROM race_name WHERE race_id = " + id)).toBe(2);
  });
  it("a Grand Tour is counted as its stages plus the general classification, whatever else DataRide lists for each stage", () => {
    // the names DataRide really lists for a 21-stage race (Giro d'Italia 2026): 165 events, 22 of them count
    const events: { id: number; name: string }[] = [];
    let id = 1;
    for (let stage = 1; stage <= 21; stage++) {
      for (const kind of ["Stage Classification", "Stage Points Classification", "Stage Youth Classification", "Stage Mountain Classification"]) events.push({ id: id++, name: "Stage " + stage + ": " + kind });
      if (stage < 21) for (const kind of ["Stage General Classification", "Overall Points Classification", "Overall Mountain Classification", "Overall Youth Classification"]) events.push({ id: id++, name: "Stage " + stage + ": " + kind });
    }
    for (const kind of ["General Classification", "Points Classification", "Mountain Classification", "Youth Classification"]) events.push({ id: id++, name: "Final Classification: " + kind });
    expect(events.filter((e) => isScoringEvent(e.name))).toHaveLength(22);
    const cube = queue(comp(1, "Giro d'Italia", 2026));
    addCapture(cube, { format: "racethreads-capture/1", competitionEvents: [{ competitionId: 1, events }] });
    expect(queueStatus(cube)[0]).toMatchObject({ eventsKnown: 22, eventsCaptured: 0, eventsComplete: 0 });
  });
  it("a longer line joins every name before the last into the last, in any order", () => {
    const cube = queue(comp(1, "Alpha Grand Prix", 2021), comp(2, "Alpha Grand Prix Open", 2022), comp(3, "Alpha GP Open Belgium", 2023), comp(4, "Alpha GP of Belgium", 2024));
    const line = "Alpha Grand Prix = Alpha Grand Prix Open = Alpha GP Open Belgium = Alpha GP of Belgium";
    expect(parseRaceAliases(line)).toEqual([["Alpha Grand Prix", "Alpha GP of Belgium"], ["Alpha Grand Prix Open", "Alpha GP of Belgium"], ["Alpha GP Open Belgium", "Alpha GP of Belgium"]]);
    const { races, aliasReport } = queueByRace(cube, line);
    expect(races).toHaveLength(1);
    expect(Object.keys(races[0]!.editions).sort()).toEqual(["2021", "2022", "2023", "2024"]);
    expect(aliasReport.every((r) => r.endsWith("joined"))).toBe(true);
  });
  it("accepted pairs that continue one another are written as one long line, whatever their order", () => {
    expect(chainLines([["A", "B"], ["B", "C"], ["X", "Y"]])).toEqual(["A = B = C", "X = Y"]);
    expect(chainLines([["B", "C"], ["A", "B"]])).toEqual(["B = A = C"]); // the order inside a line does not matter, the last name is the one it continues as
    expect(chainLines([["A", "C"], ["B", "C"]])).toEqual(["A = B = C"]);
    expect(chainLines([["A", "B"], ["B", "A"]])).toEqual(["A = B", "B = A"]); // a loop is not lost
    const cube = queue(comp(1, "Kuurne Alpha Race", 2021), comp(2, "Kuurne Alpha Race Open", 2022), comp(3, "Kuurne Alpha Race Open Belgium", 2023));
    const found = suggestJoins(cube);
    expect(found).toHaveLength(2);
    const lines = chainLines(found.map((j): [string, string] => [j.from, j.into]));
    expect(lines).toHaveLength(1); // one line for the one race, however many names it had
    expect(queueByRace(cube, lines.join(String.fromCharCode(10))).races).toHaveLength(1);
  });
  it("joins what an alias line says, and ignores an alias that would put two editions in one year", () => {
    const cube = queue(comp(1, "Kuurne Brussels Kuurne", 2026), comp(2, "Kuurne-Brussel-Kuurne", 2025), comp(3, "Omloop Nieuwsblad Old", 2026), comp(4, "Omloop Het Nieuwsblad Elite", 2025));
    const NL = String.fromCharCode(10);
    const aliases = ["# names that changed", "Omloop Nieuwsblad Old = Omloop Het Nieuwsblad Elite", "Kuurne Brussels Kuurne = Kuurne-Brussel-Kuurne"].join(NL);
    expect(queueByRace(cube, aliases).races).toHaveLength(2);
    expect(parseRaceAliases(["a = b", "", "# note", "no equals", " c=d "].join(NL))).toEqual([["a", "b"], ["c", "d"]]);
    const clash = queue(comp(5, "Race One", 2026), comp(6, "Race Two", 2026));
    expect(queueByRace(clash, "Race One = Race Two").races).toHaveLength(2);
  });
});

describe("DataRide captures in the cube", () => {
  function captured(): Cube {
    const cube = emptyCube();
    const list = readCompetitionList(doc(LIST));
    addCapture(cube, { format: "racethreads-capture/1", competitions: list });
    addCapture(cube, { format: "racethreads-capture/1", competitionEvents: [{ competitionId: 77536, events: [{ id: 374263, name: "General Classification" }] }] });
    const e = readEventResults(doc(EVENT), "/iframe/EventResults/374263", "?competitionId=77536&disciplineId=10")!;
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [e] });
    return cube;
  }
  it("builds the queue, then ticks the event off", () => {
    const cube = captured();
    expect(cube.queue!.map((q) => q.name)).toContain("Giro del Veneto");
    const line = queueStatus(cube).find((l) => l.uciId === 77536)!;
    expect(line).toMatchObject({ class: "1.Pro", captured: true, rows: 3, eventsKnown: 1, eventsCaptured: 1, eventsComplete: 1 });
    const race = cube.raceResults![0]!;
    expect(race).toMatchObject({ uciId: 77536, year: 2026, name: "Giro del Veneto", class: "1.Pro" });
    expect(race.classifications[0]).toMatchObject({ label: "General Classification", eventId: 374263 });
  });
  it("a second page of the same event adds rows instead of replacing them", () => {
    const cube = captured();
    const next = { competitionId: 77536, eventId: 374263, heading: "x", totalRows: 40, rows: [{ rank: 41, rider: "LATE Rider", team: "T", age: 30, nation: "ITA", result: "x", points: 4 }] };
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [next] });
    expect(cube.raceResults![0]!.classifications[0]!.rows.map((r) => r.rank)).toEqual([1, 2, 3, 41]);
  });
  it("a full page of scoring rows keeps the race open until the next page is captured", () => {
    const cube = emptyCube();
    addCapture(cube, { format: "racethreads-capture/1", competitions: readCompetitionList(doc(LIST)) });
    addCapture(cube, { format: "racethreads-capture/1", competitionEvents: [{ competitionId: 77536, events: [{ id: 1, name: "General Classification" }, { id: 2, name: "Points Classification" }] }] });
    const full = (from: number) => Array.from({ length: 40 }, (_, i) => ({ rank: from + i, rider: "R" + (from + i), team: "T", age: 25, nation: "ITA", result: "x", points: 5 }));
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [{ competitionId: 77536, eventId: 1, heading: "x", totalRows: 40, rows: full(1) }] });
    expect(queueStatus(cube).find((l) => l.uciId === 77536)).toMatchObject({ eventsKnown: 1, eventsCaptured: 1, eventsComplete: 0 });
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [{ competitionId: 77536, eventId: 1, heading: "x", totalRows: 80, rows: full(41).slice(0, 5) }] });
    expect(queueStatus(cube).find((l) => l.uciId === 77536)).toMatchObject({ eventsKnown: 1, eventsCaptured: 1, eventsComplete: 1 });
  });
  it("a one-day race needs no event list: its single event is enough", () => {
    const cube = emptyCube();
    addCapture(cube, { format: "racethreads-capture/1", competitions: readCompetitionList(doc(LIST)) });
    const e = readEventResults(doc(EVENT), "/iframe/EventResults/374263", "?competitionId=77536&disciplineId=10")!;
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [e] });
    expect(queueStatus(cube).find((l) => l.uciId === 77536)).toMatchObject({ eventsKnown: 1, eventsComplete: 1 });
    // a stage race (several days) still waits for its event list
    const stage = { competitionId: 76415, eventId: 9, heading: "x", totalRows: 40, rows: [{ rank: 1, rider: "A", team: "T", age: 20, nation: "ITA", result: "x", points: 5 }] };
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [stage] });
    expect(queueStatus(cube).find((l) => l.uciId === 76415)).toMatchObject({ eventsKnown: 0 });
  });
  it("results captured for events the competition page did not list still count", () => {
    const cube = emptyCube();
    addCapture(cube, { format: "racethreads-capture/1", competitions: readCompetitionList(doc(LIST)) });
    addCapture(cube, { format: "racethreads-capture/1", competitionEvents: [{ competitionId: 76415, events: [{ id: 1, name: "Stage 5: Stage Classification" }] }] });
    const e = (id: number, n: number) => ({ competitionId: 76415, eventId: id, heading: "Tour", totalRows: n + 10, rows: Array.from({ length: n }, (_, i) => ({ rank: i + 1, rider: "R" + i, team: "T", age: 20, nation: "ITA", result: "x", points: 5 })) });
    addCapture(cube, { format: "racethreads-capture/1", eventResults: [e(1, 5), e(2, 5), e(3, 5)] });
    expect(queueStatus(cube).find((l) => l.uciId === 76415)).toMatchObject({ eventsKnown: 3, eventsCaptured: 3, eventsComplete: 3 });
  });
  it("men's and women's races of the list stay apart in the queue by race", () => {
    const { races } = queueByRace(captured());
    expect(races.find((r) => r.name === "Veneto Women")!.category).toBe("WE");
    expect(races.find((r) => r.name === "Giro del Veneto")!.category).toBe("ME");
  });
  it("survives the database", () => {
    const db = openDatabase(SQL);
    saveCube(db, captured());
    const back = loadCube(db);
    expect(queueStatus(back).find((l) => l.uciId === 77536)).toMatchObject({ class: "1.Pro", eventsKnown: 1, eventsCaptured: 1 });
    expect(back.raceResults![0]!.classifications[0]!.eventId).toBe(374263);
  });
});
