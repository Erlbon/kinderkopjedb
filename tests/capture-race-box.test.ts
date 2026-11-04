import { buildSync } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { competitionPagePath, eventPagePath } from "../src/core";

// the capture bookmark as the build bundles it, run on a fake DataRide page
const bundle = buildSync({ entryPoints: ["tools/capture-uci-race.js"], bundle: true, format: "iife", target: "es2017", write: false, logLevel: "warning" }).outputFiles[0].text;

const collection = {
  format: "racethreads-capture/1",
  competitions: [
    { id: 2, name: "Tour of Guangxi", start: "2026-10-13", end: "2026-10-18", year: 2026, country: "CHN", class: "2.UWT", inProgress: false },
    { id: 8, name: "Il Lombardia", start: "2026-10-10", end: "2026-10-10", year: 2026, country: "ITA", class: "1.UWT", inProgress: false },
  ],
  competitionEvents: [
    {
      competitionId: 2,
      events: [
        { id: 21, name: "Stage 1: Stage Classification" },
        { id: 23, name: "Final Classification: General Classification" },
      ],
    },
  ],
  eventResults: [],
};

const point = (n: string) => `<td class="points" role="gridcell"><span class="uci-points-left">${n}</span><span class="uci-points-right"></span></td>`;
const row = (rank: number, rider: string, pts: string) =>
  `<tr class="k-master-row" role="row"><td class="text-right">${rank}</td><td class="text-right">1</td><td>${rider}</td><td><div class="f32"><div style="padding-left:37px;">BEL </div></div></td><td>SOME TEAM</td><td>25</td><td>1:00:00</td><td></td>${point(pts)}</tr>`;
const EVENT = `<div>IFrame Tour of Guangxi Stage 1 - 13 Oct 2026 Results</div><table><thead><tr><th>Rank</th><th>BIB</th><th>Rider</th><th>Nation</th><th>Team</th><th>Age</th><th>Result</th><th>IRM</th><th>Points</th></tr></thead><tbody>
${row(1, "ONE Rider", "100")}${row(2, "TWO Rider", "50")}${row(30, "LAST Rider", "")}</tbody></table>`;

/** Just enough of IndexedDB for the bookmark: one database, object stores with get / put / delete, and transactions. */
function fakeIndexedDB() {
  const stores = new Map<string, Map<string, unknown>>();
  const later = (f: () => void) => Promise.resolve().then(f);
  const db = {
    createObjectStore: (name: string) => stores.set(name, new Map()),
    transaction: (name: string) => {
      const tx: Record<string, unknown> = { error: null };
      const s = stores.get(name)!;
      const request = (result: () => unknown) => {
        const req: { result?: unknown; error: null } = { error: null };
        later(() => {
          req.result = result();
          later(() => (tx.oncomplete as () => void)?.());
        });
        return req;
      };
      tx.objectStore = () => ({
        get: (k: string) => request(() => structuredClone(s.get(k))),
        put: (v: unknown, k: string) => request(() => void s.set(k, structuredClone(v))),
        delete: (k: string) => request(() => void s.delete(k)),
      });
      return tx;
    },
  };
  let created = false;
  return {
    stores,
    open: () => {
      const req: Record<string, unknown> = { result: db };
      later(() => {
        if (!created) (req.onupgradeneeded as () => void)?.();
        created = true;
        (req.onsuccess as () => void)();
      });
      return req;
    },
  };
}

// a localStorage that refuses anything past `quota` characters, as a full browser store does
function fakeLocalStorage(start: Record<string, string>, quota = Infinity) {
  const store = { ...start };
  return {
    store,
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      const used = Object.entries(store).reduce((n, [key, val]) => (key === k ? n : n + val.length), 0);
      if (used + v.length > quota) throw new Error("Failed to execute 'setItem' on 'Storage': Setting the value of '" + k + "' exceeded the quota.");
      store[k] = v;
    },
    removeItem: (k: string) => delete store[k],
  };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

async function pressBookmark(pathname: string, search = "", o: { body?: string; storage?: ReturnType<typeof fakeLocalStorage>; idb?: ReturnType<typeof fakeIndexedDB> } = {}) {
  const { document } = parseHTML("<!doctype html><html><head></head><body>" + (o.body ?? "") + "</body></html>");
  const localStorage = o.storage ?? fakeLocalStorage({ "racethreads-capture-uci": JSON.stringify(collection) });
  const location = { pathname, search, hash: "", href: "https://dataride.uci.ch" + pathname + search };
  const timers: (() => void)[] = [];
  runInNewContext(bundle, {
    document,
    location,
    localStorage,
    indexedDB: o.idb,
    setTimeout: (f: () => void) => (f(), 0),
    setInterval: (f: () => void) => timers.push(f),
    clearInterval: () => (timers.length = 0),
    Blob: class {},
    URL: { createObjectURL: () => "blob:x" },
    confirm: () => false,
    console,
  });
  await settle();
  const box = () => document.getElementById("kinderkopjedb-overlay")?.textContent ?? "";
  const button = (label: RegExp) => Array.from(document.querySelectorAll("#kinderkopjedb-overlay button")).find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
  return { location, button, box, tick: () => timers.slice().forEach((f) => f()) };
}

describe("the capture bookmark's box", () => {
  it("keeps a button to the suggested next page after the countdown is stopped", async () => {
    const page = await pressBookmark("/iframe/CompetitionResults/2");
    page.button(/Stay here/)!.click();
    for (let i = 0; i < 10; i++) page.tick();
    await settle();
    expect(page.location.href).toContain("/CompetitionResults/2");
    const open = page.button(/Open the next page/);
    expect(open).toBeDefined();
    open!.click();
    await settle();
    expect(page.location.href).toBe(eventPagePath(2, 23));
  });

  it("offers the next page also when this page could not be read", async () => {
    const page = await pressBookmark("/iframe/EventResults/21", "?competitionId=2&disciplineId=10");
    page.button(/Open the next page/)!.click();
    await settle();
    expect(page.location.href).toBe(eventPagePath(2, 23));
  });

  it("still opens the next page by itself after the collection is downloaded", async () => {
    const page = await pressBookmark("/iframe/CompetitionResults/2");
    page.button(/Download/)!.click();
    for (let i = 0; i < 10; i++) page.tick();
    await settle();
    expect(page.location.href).toBe(eventPagePath(2, 23));
  });

  it("never goes on to another race when this one is done", async () => {
    // event 23 is the race's last page: it has no table here, so it is skipped, and nothing else is opened
    const storage = fakeLocalStorage({ "racethreads-capture-uci": JSON.stringify(collection), "racethreads-capture-uci-skip": JSON.stringify({ competitions: [], events: [21] }) });
    const page = await pressBookmark("/iframe/EventResults/23", "?competitionId=2&disciplineId=10", { storage });
    page.button(/Skip this page/)!.click();
    await settle();
    expect(page.location.href).toContain("/EventResults/23");
    expect(page.box()).toContain("Nothing else is left to open");
  });

  it("drops the queue's work list that earlier versions kept", async () => {
    const storage = fakeLocalStorage({ "racethreads-capture-uci": JSON.stringify(collection), "racethreads-capture-uci-work": "[]" });
    await pressBookmark("/iframe/CompetitionResults/2", "", { storage });
    expect(storage.store["racethreads-capture-uci-work"]).toBeUndefined();
  });

  it("goes to the race's competition page when its events are not known yet", async () => {
    const page = await pressBookmark("/iframe/EventResults/99", "?competitionId=5&disciplineId=10");
    page.button(/Open the next page/)!.click();
    await settle();
    expect(page.location.href).toBe(competitionPagePath(5));
  });
});

describe("where the capture bookmark keeps the collection", () => {
  it("moves a collection from localStorage into IndexedDB, and frees localStorage", async () => {
    const idb = fakeIndexedDB();
    const storage = fakeLocalStorage({ "racethreads-capture-uci": JSON.stringify(collection) });
    const page = await pressBookmark("/iframe/CompetitionResults/2", "", { storage, idb });
    expect(storage.store["racethreads-capture-uci"]).toBeUndefined();
    expect(idb.stores.get("kv")!.get("racethreads-capture-uci")).toEqual(collection);
    expect(page.box()).toContain("2 competitions");
  });

  it("captures a page when localStorage is full", async () => {
    const idb = fakeIndexedDB();
    // the browser's store is full: any write to localStorage fails, as in the user's report
    const storage = fakeLocalStorage({ "racethreads-capture-uci": JSON.stringify(collection) }, JSON.stringify(collection).length);
    const page = await pressBookmark("/iframe/EventResults/21", "?competitionId=2&disciplineId=10", { body: EVENT, storage, idb });
    expect(page.box()).not.toContain("error");
    expect(page.box()).toContain("Captured 2 point-scoring rows");
    const saved = idb.stores.get("kv")!.get("racethreads-capture-uci") as { eventResults: { eventId: number; rows: unknown[] }[] };
    expect(saved.eventResults.map((e) => [e.eventId, e.rows.length])).toEqual([[21, 2]]);
    // and the next press finds it there
    const again = await pressBookmark("/iframe/CompetitionResults/2", "", { storage, idb });
    expect(again.box()).toContain("1 event results");
  });

  it("opens the next page only after the collection is written", async () => {
    const idb = fakeIndexedDB();
    const page = await pressBookmark("/iframe/EventResults/21", "?competitionId=2&disciplineId=10", { body: EVENT, idb });
    for (let i = 0; i < 10; i++) page.tick();
    await settle();
    expect(page.location.href).toBe(eventPagePath(2, 23));
    expect((idb.stores.get("kv")!.get("racethreads-capture-uci") as { eventResults: unknown[] }).eventResults).toHaveLength(1);
  });
});
