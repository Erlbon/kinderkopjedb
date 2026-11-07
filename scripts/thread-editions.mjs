// Writes the race editions the Devvit thread finder searches for: names, dates and stage dates
// from the public database, plus the names r/peloton uses (data/peloton/reddit-names.yaml).
//
//   node scripts/thread-editions.mjs                       (the test set)
//   node scripts/thread-editions.mjs --races tourfrance,parisnice --years 2023-2025
//   node scripts/thread-editions.mjs --all
//   node scripts/thread-editions.mjs --class UWT --years 2021-2026    (every WorldTour race)
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import initSqlJs from "sql.js";

// --db: another database, such as a full copy saved from the Data page (its queue has dates of races without results)
const DB = process.argv.includes("--db") ? process.argv[process.argv.indexOf("--db") + 1] : "data/public/kinderkopjedb-public.sqlite";
const NAMES = "data/peloton/reddit-names.yaml";
const OUT = "apps/devvit/src/shared/editions.json";
const TEST_RACES = ["stradebianche|ME", "rondevanvlaanderen|ME", "parisnice|ME", "tourfrance|ME"];

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const all = process.argv.includes("--all");
const klass = arg("class"); // "UWT" matches 1.UWT and 2.UWT
const races = all || klass ? undefined : (arg("races")?.split(",").map((k) => (k.includes("|") ? k : k + "|ME")) ?? TEST_RACES);
const [y1, y2] = (arg("years") ?? (all ? "2000-2100" : "2023-2025")).split("-").map(Number);

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(DB));
const redditNames = parse(readFileSync(NAMES, "utf8")) ?? {};

function rows(sql, params = []) {
  const st = db.prepare(sql);
  st.bind(params);
  const out = [];
  while (st.step()) out.push(st.getAsObject());
  st.free();
  return out;
}

// editions with results, plus the queue's: a race whose results are not captured yet still has its dates there
const hasQueue = rows("select count(*) n from sqlite_master where name = 'queue_race'")[0].n > 0;
const editions = [];
for (const r of rows(
  `select rr.uci_id, rr.year, rr.class, rr.start, rr.end, r.key, r.name, r.category
     from race_result rr join race r using (race_id)
    where rr.year between ? and ? and rr.start is not null` +
    (hasQueue
      ? ` union
   select q.uci_id, q.year, q.class, q.start, q.end, r.key, r.name, r.category
     from queue_race q join race r using (race_id)
    where q.year between ? and ? and q.start is not null and q.start <> ''
      and q.uci_id not in (select uci_id from race_result)`
      : "") +
    ` order by 4`,
  hasQueue ? [y1, y2 ?? y1, y1, y2 ?? y1] : [y1, y2 ?? y1],
)) {
  if (races && !races.includes(r.key)) continue;
  if (klass && !String(r.class ?? "").endsWith(klass)) continue;
  const uciNames = rows("select distinct name from race_name where race_id = (select race_id from race where key = ?)", [r.key]).map((n) => n.name);
  const aliases = [...new Set([...(redditNames[r.key] ?? []), ...uciNames])].filter((n) => n !== r.name);
  const stages = new Map();
  for (const c of rows("select label, date from classification where uci_id = ? and date is not null", [r.uci_id])) {
    const m = /^(?:Stage (\d+)|Prologue):/.exec(c.label);
    if (m) stages.set(m[1] === undefined ? 0 : +m[1], c.date);
  }
  const e = { key: r.key, name: r.name, year: r.year, class: r.class, category: r.category, start: r.start, end: r.end };
  if (aliases.length) e.aliases = aliases;
  if (stages.size) e.stages = [...stages].sort((a, b) => a[0] - b[0]).map(([n, date]) => ({ n, date }));
  editions.push(e);
}

writeFileSync(OUT, JSON.stringify(editions, null, 1) + String.fromCharCode(10));
console.log(editions.length + " editions -> " + OUT);
for (const e of editions) console.log("  " + e.year + " " + e.name + (e.stages ? " (" + e.stages.length + " stages)" : ""));
