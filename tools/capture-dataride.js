/*
 * KinderkopjeDB: capture helper for UCI DataRide ranking pages (runs as a bookmarklet in YOUR browser).
 *
 * What it does: when you press it on a DataRide ranking page, it copies the rows that are already
 * shown on screen (rank, name, nation, points ...) into a collection kept in your browser. It sends
 * no requests of its own. You choose the season and date with the page's own dropdowns and click
 * through the pages yourself; press it on each page you want. Then download the collection as one
 * file and open it in KinderkopjeDB.
 *
 * Output format "racethreads-capture/1": a list of snapshots, each with the page's context
 * (ranking, season, date, snapshot id) and its rows.
 */
(function () {
  var STORE = "racethreads-capture";
  var FORMAT = "racethreads-capture/1";

  function $(sel) {
    return document.querySelector(sel);
  }
  function text(el) {
    return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim();
  }
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE) || "null");
      if (v && v.format === FORMAT) return v;
    } catch (e) {}
    return { format: FORMAT, source: "dataride.uci.ch", snapshots: [] };
  }
  function save(c) {
    localStorage.setItem(STORE, JSON.stringify(c));
  }

  // "13/10/2026" -> "2026-10-13"
  function isoDate(s) {
    var m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || "");
    if (!m) return "";
    return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  }

  // The page keeps the chosen season and date in dropdown widgets, not in the address.
  function widgetText(id) {
    try {
      var w = window.jQuery("#" + id).data("kendoDropDownList");
      if (w && w.text) return String(w.text());
    } catch (e) {}
    return "";
  }

  function overlay(msg, collection) {
    var old = document.getElementById("kinderkopjedb-overlay");
    if (old) old.remove();
    var box = document.createElement("div");
    box.id = "kinderkopjedb-overlay";
    box.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:99999;background:#fff;color:#111;border:2px solid #ff6a2b;" +
      "border-radius:8px;padding:10px 12px;font:13px system-ui,sans-serif;max-width:340px;box-shadow:0 2px 10px rgba(0,0,0,.3)";
    var p = document.createElement("div");
    p.textContent = msg;
    box.appendChild(p);
    var n = collection ? collection.snapshots.length : 0;
    var info = document.createElement("div");
    info.style.cssText = "margin-top:4px;color:#555";
    info.textContent = "Collection: " + n + " snapshot" + (n === 1 ? "" : "s");
    box.appendChild(info);
    function btn(label, fn) {
      var b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "margin:6px 6px 0 0;padding:4px 8px;cursor:pointer";
      b.onclick = fn;
      box.appendChild(b);
    }
    btn("Download collection", function () {
      var blob = new Blob([JSON.stringify(load(), null, 1)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "dataride-capture.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    btn("Clear collection", function () {
      if (confirm("Delete everything captured so far?")) {
        localStorage.removeItem(STORE);
        overlay("Collection cleared.", load());
      }
    });
    btn("Close", function () {
      box.remove();
    });
    document.body.appendChild(box);
  }

  var grid = $("#object-rankings");
  if (!grid) {
    overlay("No ranking table found on this page. Open a DataRide ranking (RankingDetails) page first.", load());
    return;
  }

  // ---- rows on screen ----
  var rows = [];
  var trs = grid.querySelectorAll("tbody tr[data-uid], tbody tr");
  var seen = {};
  for (var i = 0; i < trs.length; i++) {
    var tr = trs[i];
    if (tr.closest("table") !== grid.querySelector("table[role=grid], table")) continue;
    var tds = tr.children;
    if (!tds || tds.length < 5) continue;
    var rankCell = tds[0].querySelector(".uci-margin-right");
    var rank = parseInt(text(rankCell), 10);
    if (!rank || seen[rank]) continue;
    seen[rank] = true;
    var changeEl = tds[0].querySelectorAll("td")[1];
    var change = text(changeEl); // "+1", "-2" or ""
    var link = tr.querySelector("a[href]");
    var name = text(link) || text(tds[3]);
    var href = link ? link.getAttribute("href") : "";
    var idm = /(?:Team|Rider|Nation)?RankingDetails\/(\d+)/.exec(href || "");
    var cells = [];
    for (var c = 0; c < tds.length; c++) cells.push(text(tds[c]));
    // the last cell is the points, written with a decimal part split by spaces: "30329 .1"
    var points = parseFloat(cells[cells.length - 1].replace(/\s+/g, ""));
    var nation = cells[cells.length - 2];
    var code = (/\(([A-Z0-9]{2,4})\)\s*$/.exec(name) || [])[1] || "";
    rows.push({
      rank: rank,
      change: change,
      name: code ? name.replace(/\s*\([A-Z0-9]{2,4}\)\s*$/, "") : name,
      code: code,
      nation: nation,
      points: points,
      objectId: idm ? Number(idm[1]) : null,
      momentId: Number(cells[1]) || null,
    });
  }

  var hidden = function (id) {
    var e = document.getElementById(id);
    return e ? e.value : "";
  };
  var season = widgetText("seasons") || (/SEASON\s*(\d{4})/.exec(text(document.body)) || [])[1] || "";
  var dateText = widgetText("dates");
  var pageText = text(document.body);
  // The date dropdown says "Most Recent Ranking" until a date is picked. Then use the date printed in the
  // box of the ranking being shown (Individual, Team or Nation), not just the first date on the page.
  var boxName = { 1: "Individual", 2: "Team", 3: "Nation" }[Number(hidden("fixedRankingTypeId"))] || "";
  var rd = new RegExp((boxName ? boxName + " Ranking\\s*" : "") + "Ranking Date\\s*(\\d{1,2}/\\d{1,2}/\\d{4})").exec(pageText);
  var date = isoDate(dateText) || (rd ? isoDate(rd[1]) : "");

  if (!rows.length) {
    overlay("The table is empty or not loaded yet. Wait for it to load and press again.", load());
    return;
  }

  var ctx = {
    rankingId: Number(hidden("fixedRankingId")) || null,
    rankingTypeId: Number(hidden("fixedRankingTypeId")) || null, // 1 rider, 2 team, 3 nation (as seen on the page)
    categoryId: Number(hidden("fixedCategoryId")) || null,
    disciplineId: Number(hidden("fixedDisciplineId")) || null,
    raceTypeId: Number(hidden("fixedRaceTypeId")) || 0,
    momentId: rows[0].momentId,
    season: season,
    date: date,
  };

  // "1 - 40 of 214 items"
  var tm = /(\d+)\s*-\s*(\d+)\s*of\s*(\d+)\s*items/.exec(pageText);
  var total = tm ? Number(tm[3]) : null;

  var c = load();
  var key = [ctx.rankingTypeId, ctx.rankingId, ctx.categoryId, ctx.momentId].join(":");
  var snap = null;
  for (var s = 0; s < c.snapshots.length; s++) if (c.snapshots[s].key === key) snap = c.snapshots[s];
  if (!snap) {
    snap = Object.assign({ key: key, total: total, capturedAt: new Date().toISOString(), rows: [] }, ctx);
    c.snapshots.push(snap);
  }
  snap.total = total || snap.total;
  var byRank = {};
  for (var r = 0; r < snap.rows.length; r++) byRank[snap.rows[r].rank] = snap.rows[r];
  for (var k = 0; k < rows.length; k++) byRank[rows[k].rank] = rows[k];
  snap.rows = Object.keys(byRank)
    .map(function (x) {
      return byRank[x];
    })
    .sort(function (a, b) {
      return a.rank - b.rank;
    });
  snap.complete = !!snap.total && snap.rows.length >= snap.total;
  save(c);

  overlay(
    "Captured " + rows.length + " rows. Season " + (ctx.season || "?") + ", date " + (ctx.date || "?") +
      ". This snapshot: " + snap.rows.length + (snap.total ? " of " + snap.total : "") +
      (snap.complete ? " (complete)" : " (go to the next page and press again)"),
    c,
  );
})();
