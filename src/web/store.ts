import type { Database } from "sql.js";
import initSqlJs from "sql.js/dist/sql-wasm-inline.js";
import type { Cube } from "../core";
import { deleteKv, getKv, loadCube, openDatabase, saveCube, setKv, writeRaces } from "../db";

/**
 * The shared store of all pages: one SQLite database kept in the browser (IndexedDB) and exchanged as a
 * .sqlite file. Pages work on the in-memory `cube` and call `saveCube()` after changing it; texts such as the
 * season YAML go through getText/setText.
 */

const IDB_NAME = "pelotonic"; // old name kept on purpose: renaming it would orphan data already saved in the browser
const IDB_STORE = "db";
const IDB_KEY = "main";

interface Saved {
  bytes: Uint8Array;
  version: string;
}

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null); // private window or blocked storage
    }
  });
}

async function readSaved(): Promise<Saved | undefined> {
  const d = await idb();
  if (!d) return undefined;
  return new Promise((resolve) => {
    const req = d.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result as Saved | undefined);
    req.onerror = () => resolve(undefined);
  });
}

async function writeSaved(s: Saved): Promise<boolean> {
  const d = await idb();
  if (!d) return false;
  return new Promise((resolve) => {
    const tx = d.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(s, IDB_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export interface Store {
  readonly db: Database;
  cube: Cube;
  /** false when the browser does not allow IndexedDB: data then lasts for this visit only */
  persistent: boolean;
  version: string;
  saveCube(): Promise<void>;
  getText(key: string): string | undefined;
  setText(key: string, value: string): Promise<void>;
  deleteText(key: string): Promise<void>;
  exportBytes(): Uint8Array;
  /** Replace everything with the contents of a .sqlite file. Throws if it is not a KinderkopjeDB database. */
  importBytes(bytes: Uint8Array): Promise<void>;
  /** Delete everything and start with an empty database. */
  reset(): Promise<void>;
  /** Called when another page or tab saved newer data. */
  onChange(cb: () => void): void;
}

export async function openStore(): Promise<Store> {
  const SQL = await initSqlJs();
  const saved = await readSaved();
  let db = openDatabase(SQL, saved?.bytes);
  let cube = loadCube(db);
  let version = saved?.version ?? "";
  let persistent = true;
  const listeners: (() => void)[] = [];
  let pending: Promise<void> = Promise.resolve();

  let queued = false;
  async function persist(): Promise<void> {
    // quick successive changes share one save; always writes the latest state
    if (!queued) {
      queued = true;
      pending = pending.then(async () => {
        queued = false;
        const bytes = db.export();
        db.exec("PRAGMA foreign_keys = ON"); // export() resets it
        const v = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
        persistent = await writeSaved({ bytes, version: v });
        if (persistent) version = v;
      });
    }
    return pending;
  }

  const store: Store = {
    get db() {
      return db;
    },
    get cube() {
      return cube;
    },
    set cube(c: Cube) {
      cube = c;
    },
    get persistent() {
      return persistent;
    },
    set persistent(p: boolean) {
      persistent = p;
    },
    get version() {
      return version;
    },
    set version(v: string) {
      version = v;
    },
    async saveCube() {
      saveCube(db, cube);
      await persist();
    },
    getText: (key) => getKv(db, key),
    async setText(key, value) {
      setKv(db, key, value);
      if (key === "racealiases" || key === "racenames" || key === "racelinks" || key === "registry") writeRaces(db, cube); // the races follow the join, rename and link lines
      await persist();
    },
    async deleteText(key) {
      deleteKv(db, key);
      await persist();
    },
    exportBytes() {
      const bytes = db.export();
      db.exec("PRAGMA foreign_keys = ON");
      return bytes;
    },
    async importBytes(bytes) {
      const next = openDatabase(SQL, bytes); // throws on a foreign or newer file
      db = next;
      cube = loadCube(db);
      await persist();
    },
    async reset() {
      db = openDatabase(SQL);
      cube = loadCube(db);
      await persist();
    },
    onChange(cb) {
      listeners.push(cb);
    },
  };

  // When another page saved newer data, take it over (a page that comes to the front checks).
  async function checkExternal(): Promise<void> {
    const s = await readSaved();
    if (!s || s.version === version) return;
    db = openDatabase(SQL, s.bytes);
    cube = loadCube(db);
    version = s.version;
    for (const cb of listeners) cb();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkExternal();
  });
  window.addEventListener("focus", () => void checkExternal());

  await migrateFromLocalStorage(store);
  if (!saved) await persist(); // first run: write the empty database so every page sees the same one
  return store;
}

/** Data kept by the earlier single-page version in localStorage moves into the database once. */
async function migrateFromLocalStorage(store: Store): Promise<void> {
  if (store.getText("migrated_localstorage")) return;
  try {
    let any = false;
    const season = localStorage.getItem("rt-season");
    const registry = localStorage.getItem("rt-registry");
    const layout = localStorage.getItem("rt-layout");
    const cubeText = localStorage.getItem("rt-cube");
    if (season) (store.db.run("INSERT OR IGNORE INTO kv(key,value) VALUES ('season', ?)", [season]), (any = true));
    if (registry) (store.db.run("INSERT OR IGNORE INTO kv(key,value) VALUES ('registry', ?)", [registry]), (any = true));
    if (layout) (store.db.run("INSERT OR IGNORE INTO kv(key,value) VALUES ('layout', ?)", [layout]), (any = true));
    if (cubeText && store.cube.teamSnapshots.length === 0) {
      const c = JSON.parse(cubeText) as Cube;
      if (Array.isArray(c.teamSnapshots)) {
        store.cube = c;
        saveCube(store.db, c);
        any = true;
      }
    }
    store.db.run("INSERT OR REPLACE INTO kv(key,value) VALUES ('migrated_localstorage', '1')");
    if (any) await store.setText("migrated_from", "localStorage " + new Date().toISOString());
  } catch {
    /* storage can be blocked; nothing to move then */
  }
}
