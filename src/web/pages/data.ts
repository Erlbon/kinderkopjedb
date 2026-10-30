import type { Database } from "sql.js";
import initSqlJs from "sql.js/dist/sql-wasm-inline.js";
import { DICTIONARY, dictionaryMarkdown, makePublicCopy, openDatabase, publicCredits, publicInfo, querySql, SCHEMA_VERSION, schemaVersion } from "../../db";
import { $, copy, download, el } from "../dom";
import type { Store } from "../store";

const EXAMPLES: [string, string][] = [
  [
    "Team points, latest ranking of each season",
    "SELECT season, code, name, rank, points FROM v_team_points WHERE date IN (SELECT MAX(date) FROM team_snapshot GROUP BY season) ORDER BY season DESC, points DESC LIMIT 40",
  ],
  [
    "Top riders by points in the captured races",
    "SELECT rider, team, SUM(points) AS points, COUNT(*) AS results FROM v_results GROUP BY rider, team ORDER BY points DESC LIMIT 40",
  ],
  [
    "Team points from race results (team names as on UCI pages)",
    "SELECT team, SUM(points) AS points, COUNT(DISTINCT uci_id) AS races FROM v_results GROUP BY team ORDER BY points DESC LIMIT 40",
  ],
  ["Races captured", "SELECT year, race, class, COUNT(*) AS point_rows, SUM(points) AS points FROM v_results GROUP BY uci_id ORDER BY year, race"],
  ["Teams that changed code (same UCI id)", "SELECT team_id, group_concat(DISTINCT code) AS codes, group_concat(DISTINCT name) AS names FROM v_team_points GROUP BY team_id HAVING COUNT(DISTINCT code) > 1"],
];

export function initData(store: Store): void {
  const box = $<HTMLTextAreaElement>("sqlbox");
  /** the public dataset, once loaded: the SQL box then asks it instead of the visitor's own database */
  let publicDb: Database | undefined;

  function runSql(sql?: string): void {
    if (sql !== undefined) box.value = sql;
    const out = $("sqlout");
    out.replaceChildren();
    try {
      const r = querySql(publicDb ?? store.db, box.value);
      if (!r.columns.length) {
        out.append(el("div", { class: "mut", textContent: "No rows." }));
        return;
      }
      const table = el("table", { class: "queue" });
      table.append(el("tr", {}, ...r.columns.map((c) => el("th", { textContent: c }))));
      for (const row of r.rows.slice(0, 500)) table.append(el("tr", {}, ...row.map((v) => el("td", { textContent: v === null ? "" : String(v) }))));
      out.append(table, el("div", { class: "mut", textContent: r.rows.length + " rows" + (r.rows.length > 500 ? " (first 500 shown)" : "") }));
    } catch (err) {
      out.append(el("div", { class: "err", textContent: err instanceof Error ? err.message : String(err) }));
    }
  }

  /** The overview of tables and fields: what each means, how they link, with a first question for each. */
  function drawDictionary(): void {
    const root = $("dict");
    root.replaceChildren();
    // views first: they are the easy way in
    const docs = [...DICTIONARY].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "view" ? -1 : 1));
    for (const d of docs) {
      let n = 0;
      try {
        n = Number(store.db.exec("SELECT COUNT(*) FROM " + d.name)[0]!.values[0]![0]);
      } catch {
        /* the overview is still useful when a count fails */
      }
      const info = store.db.exec("PRAGMA table_info(" + d.name + ")")[0]?.values ?? [];
      const type = new Map(info.map((r) => [r[1] as string, String(r[2] ?? "").toLowerCase()]));
      const isKey = new Map(info.map((r) => [r[1] as string, Number(r[5]) > 0]));

      const table = el("table", { class: "queue" });
      table.append(el("tr", {}, el("th", { textContent: "Field" }), el("th", { textContent: "Type" }), el("th", { textContent: "Meaning" })));
      for (const c of d.columns) {
        table.append(
          el("tr", {}, el("td", {}, el("code", { textContent: c.name + (isKey.get(c.name) ? " (key)" : "") })), el("td", { textContent: type.get(c.name) ?? "" }), el("td", { textContent: c.meaning })),
        );
      }
      const first = el("button", { textContent: "Show the first 20 rows" });
      first.onclick = () => {
        runSql("SELECT * FROM " + d.name + " LIMIT 20");
        $("sqlbox").scrollIntoView({ behavior: "smooth", block: "center" });
      };
      const example = el("button", { textContent: d.example.title, title: d.example.sql });
      example.onclick = () => {
        runSql(d.example.sql);
        $("sqlbox").scrollIntoView({ behavior: "smooth", block: "center" });
      };
      const details = el(
        "details",
        {},
        el("summary", {}, el("strong", { textContent: d.name }), el("span", { class: "mut", textContent: "  " + d.kind + ", " + n + " rows: " + d.summary })),
        table,
      );
      if (d.links) details.append(el("p", { class: "mut", textContent: "Links: " + d.links }));
      details.append(el("div", { class: "row" }, first, el("span", { class: "mut", textContent: "or ask:" }), example));
      details.open = d.kind === "view";
      root.append(details);
    }
  }

  function info(): void {
    const count = (t: string) => Number(store.db.exec("SELECT COUNT(*) FROM " + t)[0]!.values[0]![0]);
    const rows = [
      ["Team rankings (dates)", count("team_snapshot")],
      ["Team ranking rows", count("team_rank")],
      ["Race results", count("race_result")],
      ["Result rows (points only)", count("result_row")],
      ["Races in the queue", count("queue_race")],
      ["Saved texts (season, registry, layout ...)", count("kv")],
    ];
    const boxInfo = $("dbinfo");
    boxInfo.replaceChildren();
    for (const [label, n] of rows) boxInfo.append(el("div", { textContent: label + ": " + n }));
    boxInfo.append(
      el("div", { textContent: "Schema version " + schemaVersion(store.db) + " (this tool: " + SCHEMA_VERSION + "). File size about " + Math.round(store.exportBytes().length / 1024) + " KB." }),
      el("div", {
        class: store.persistent ? "mut" : "warn",
        textContent: store.persistent
          ? "Kept in this browser (IndexedDB). Use Save database to keep a copy or pass it on."
          : "This browser does not allow saving: the data lasts for this visit only. Use Save database before you close the page.",
      }),
    );
    drawDictionary();
  }

  $("dbexport").onclick = () => download("kinderkopjedb.sqlite", store.exportBytes(), "application/vnd.sqlite3");
  $<HTMLInputElement>("dbimport").onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (!confirm("Replace everything in this browser with the contents of " + f.name + "?")) return;
    try {
      await store.importBytes(new Uint8Array(await f.arrayBuffer()));
      $("dbmsg").textContent = "Opened " + f.name + ".";
      info();
    } catch (err) {
      $("dbmsg").textContent = "Could not open that file: " + (err instanceof Error ? err.message : String(err));
    }
  };
  $("dbreset").onclick = async () => {
    if (!confirm("Delete ALL data (rankings, race results, queue, season and registry texts) from this browser? Save a copy first if you may need it.")) return;
    await store.reset();
    $("dbmsg").textContent = "Everything was deleted.";
    info();
  };
  const mdButton = $<HTMLButtonElement>("dictmd");
  mdButton.onclick = () => copy(dictionaryMarkdown(), mdButton);

  // the SQL box (read-only)
  const ex = $("sqlexamples");
  for (const [label, sql] of EXAMPLES) {
    const b = el("button", { textContent: label });
    b.onclick = () => {
      box.value = sql;
    };
    ex.append(b);
  }
  $("sqlrun").onclick = () => runSql();

  // the public beta database
  const describe = (i: ReturnType<typeof publicInfo>) =>
    i.races + " races, " + i.editions + " editions and " + i.results + " results" + (i.firstYear ? ", " + i.firstYear + " to " + i.lastYear : "") + (i.made ? ", built " + i.made : "") + ".";
  $("pubsave").onclick = async () => {
    const SQL = await initSqlJs();
    const bytes = makePublicCopy(SQL, store.db, "Made from the collector's own database, with its joins, names and links.");
    download("kinderkopjedb-public.sqlite", bytes, "application/vnd.sqlite3");
    $("pubmsg").textContent =
      "Saved: " + describe(publicInfo(openDatabase(SQL, bytes))) + " Put the file at data/public/kinderkopjedb-public.sqlite in the project and publish; saved texts, the queue and contributor names are not in it.";
  };
  // is a beta file published on this site?
  void (async () => {
    const status = $("pubstatus");
    try {
      const res = await fetch("kinderkopjedb-public.sqlite", { method: "HEAD" });
      if (!res.ok) throw new Error("none");
      const size = Number(res.headers.get("content-length") ?? 0);
      status.textContent = "A beta file is published" + (size ? " (" + (size / 1048576).toFixed(1) + " MB)" : "") + ". Press Search it here to see what it holds.";
    } catch {
      status.textContent = "No beta file is published on this site yet.";
      $("publink").style.display = "none";
    }
  })();
  $("pubload").onclick = async () => {
    const msg = $("pubmsg");
    msg.textContent = "Loading the beta database ...";
    try {
      const res = await fetch("kinderkopjedb-public.sqlite");
      if (!res.ok) throw new Error(res.status === 404 ? "no beta file has been published on this site yet" : "HTTP " + res.status);
      const SQL = await initSqlJs();
      publicDb = openDatabase(SQL, new Uint8Array(await res.arrayBuffer()));
      const info = publicInfo(publicDb);
      msg.textContent = "Loaded: " + describe(info) + " The SQL box below now asks the beta database. " + (info.note ?? "") + " " + (publicCredits(publicDb) ?? "");
      $("pubstatus").textContent = "Beta database: " + describe(info);
      which.textContent = "the beta database (reload the page to go back to my database)";
      $("sqlbox").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      publicDb = undefined;
      msg.textContent = "Could not load it: " + (err instanceof Error ? err.message : String(err));
    }
  };
  const which = $("sqlwhich");
  $("pubload").onclick = async () => {
    const msg = $("pubmsg");
    msg.textContent = "Loading the public dataset ...";
    try {
      const res = await fetch("kinderkopjedb-public.sqlite");
      if (!res.ok) throw new Error(res.status === 404 ? "no public dataset has been published on this site yet" : "HTTP " + res.status);
      const SQL = await initSqlJs();
      publicDb = openDatabase(SQL, new Uint8Array(await res.arrayBuffer()));
      const n = Number(publicDb.exec("SELECT COUNT(*) FROM result_row")[0]!.values[0]![0]);
      msg.textContent = "Loaded: " + n + " result rows. The SQL box below now asks the public dataset. " + (publicCredits(publicDb) ?? "");
      which.textContent = "the public dataset (reload the page to go back to my database)";
      $("sqlbox").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      publicDb = undefined;
      msg.textContent = "Could not load it: " + (err instanceof Error ? err.message : String(err));
    }
  };

  store.onChange(info);
  info();
}
