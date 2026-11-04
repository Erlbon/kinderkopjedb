/*
 * KinderkopjeDB: capture helper for UCI DataRide road results (runs as a bookmarklet in YOUR browser).
 *
 * Press it on one of three DataRide pages that you have opened yourself:
 *   1. the list of competitions  (dataride.uci.ch/iframe/Results/10/, pick the season and category with the page's own filters)
 *   2. one competition           (a link in that list: .../CompetitionResults/<id>)
 *   3. one event                 (a link on the competition page: .../EventResults/<id>?competitionId=...)
 * It copies what is on screen into a collection kept in your browser, and keeps only the rows that score points.
 * To save you the clicking it also clicks the page's own controls, one click at a time with a pause, as you would:
 *   - on the list, the "next page" button, until the last page
 *   - on a competition page, the triangle of each closed row (stages, final classification), then the next page
 *   - on an event page, the "next page" button while every row on the page scored points
 * After a competition or a complete event it opens the next missing page of the same race by itself after a short
 * countdown, so you only press the bookmark once per page; "Stay here" stops it. It never goes on to another race.
 * "Get everything for this race" reads all of the race's missing pages in a hidden frame on this page, one page at a time
 * with a pause, as if you opened each one. Nothing here calls DataRide's data service itself: each page loads its own
 * data as it does for you. The Stop button ends it at once. Then download the collection and open it in KinderkopjeDB.
 * The collection is kept in dataride.uci.ch's IndexedDB in your browser (localStorage is too small for a season).
 *
 * Reading the pages is done by src/core/dataride.ts and the clicking by src/core/autopilot.ts, the code the tests cover;
 * the build bundles them here.
 */
import { expandAll, pageThrough, realEnv, waitFor } from "../src/core/autopilot";
import {
  competitionPagePath,
  eventPagePath,
  hasEventList,
  isComplete,
  isOtherCategory,
  mergeEvents,
  missingJerseyEvents,
  nextPageToOpen,
  pageKind,
  racePages,
  readCompetitionEvents,
  readCompetitionList,
  readEventResults,
} from "../src/core/dataride";

(function () {
  // The names below keep the tool's earlier name: collections already saved in your browser, and
  // files already downloaded, must keep working.
  var STORE = "racethreads-capture-uci";
  var SKIP_STORE = "racethreads-capture-uci-skip";
  var FORMAT = "racethreads-capture/1";
  var COUNTDOWN = 5; // seconds before the next page opens by itself
  var FRAME_PAUSE = 1500; // ms between two pages read in the hidden frame
  var stopped = false;
  var timer = null;

  // The collection lives in this site's IndexedDB: localStorage holds only about 5 MB per site, which a season of
  // results outgrows. A collection from an earlier version of the bookmark is moved over from localStorage once.
  // `cache` is the collection in memory; every save writes it out, and `written` waits for the writes so far.
  var DB_NAME = "kinderkopjedb-capture";
  var DB_STORE = "kv";
  var db = null;
  var cache = null;
  var written = Promise.resolve();
  var saveError = "";

  function idb(mode, act) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(DB_STORE, mode);
      var req = act(tx.objectStore(DB_STORE));
      tx.oncomplete = function () {
        resolve(req.result);
      };
      tx.onerror = tx.onabort = function () {
        reject(tx.error || req.error || new Error("the browser's database refused the write"));
      };
    });
  }
  function openDb() {
    return new Promise(function (resolve) {
      if (typeof indexedDB === "undefined") return resolve(null);
      var req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        return resolve(null);
      }
      req.onupgradeneeded = function () {
        req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        resolve(null);
      };
    });
  }
  async function openStore() {
    db = await openDb();
    var old = null;
    try {
      old = JSON.parse(localStorage.getItem(STORE) || "null");
    } catch (e) {}
    if (!db) {
      cache = old;
      return;
    }
    cache = await idb("readonly", function (s) {
      return s.get(STORE);
    });
    if (old && !cache) {
      cache = old;
      await idb("readwrite", function (s) {
        return s.put(old, STORE);
      });
    }
    // the old copy goes once the database holds the collection; it is what filled localStorage up
    if (old && cache) {
      try {
        localStorage.removeItem(STORE);
      } catch (e) {}
    }
  }
  function load() {
    var v = cache;
    if (!v || v.format !== FORMAT) v = { format: FORMAT, source: "dataride.uci.ch" };
    v.competitions = v.competitions || [];
    v.competitionEvents = v.competitionEvents || [];
    v.eventResults = v.eventResults || [];
    cache = v;
    return v;
  }
  function save(c) {
    cache = c;
    if (!db) {
      localStorage.setItem(STORE, JSON.stringify(c));
      return;
    }
    written = written.then(function () {
      return idb("readwrite", function (s) {
        return s.put(c, STORE);
      }).catch(function (e) {
        saveError = "Saving failed: " + (e && e.message ? e.message : e) + ". Download the collection now.";
      });
    });
  }
  function clearCollection() {
    cache = null;
    try {
      localStorage.removeItem(STORE);
    } catch (e) {}
    if (db)
      written = written.then(function () {
        return idb("readwrite", function (s) {
          return s.delete(STORE);
        }).catch(function () {});
      });
  }
  // a new page loads only after the collection is written out: leaving the page could cut a write off
  function openPage(path) {
    written.then(function () {
      location.href = path;
    });
  }
  // pages and races you chose to skip; kept apart from the collection so the capture file stays as it was
  function loadSkips() {
    var v = null;
    try {
      v = JSON.parse(localStorage.getItem(SKIP_STORE) || "null");
    } catch (e) {}
    return { competitions: (v && v.competitions) || [], events: (v && v.events) || [] };
  }
  function skip(kind, id) {
    var s = loadSkips();
    if (s[kind].indexOf(id) < 0) s[kind].push(id);
    localStorage.setItem(SKIP_STORE, JSON.stringify(s));
  }

  var msgEl = null;
  var infoEl = null;
  function counts(c) {
    return "Collection: " + c.competitions.length + " competitions, " + c.competitionEvents.length + " event lists, " + c.eventResults.length + " event results" + (saveError ? ". " + saveError : "");
  }

  // the pages of one competition that are known (from its saved event list) but not captured yet
  function missingFor(c, competitionId) {
    var events = [];
    for (var i = 0; i < c.competitionEvents.length; i++) if (c.competitionEvents[i].competitionId === competitionId) events = c.competitionEvents[i].events;
    var have = c.eventResults.filter(function (r) { return r.competitionId === competitionId; }).map(function (r) { return r.eventId; });
    return missingJerseyEvents(events, have.concat(loadSkips().events));
  }

  // links to the missing pages, for when you want to pick one yourself
  function todoList(box, c, competitionId) {
    var m = missingFor(c, competitionId);
    var line = document.createElement("div");
    line.style.cssText = "margin-top:8px;font-weight:bold";
    line.textContent = m.results.length + " stage / general classification pages, " + m.leader.length + " GC-leader pages and " + m.final.length + " final points / mountain pages are still missing for this race.";
    box.appendChild(line);
    function group(title, list) {
      if (!list.length) return;
      var t = document.createElement("div");
      t.style.cssText = "margin-top:4px;color:#555";
      t.textContent = title;
      box.appendChild(t);
      var wrap = document.createElement("div");
      wrap.style.cssText = "max-height:90px;overflow:auto;line-height:1.6";
      list.forEach(function (e) {
        var a = document.createElement("a");
        a.href = eventPagePath(competitionId, e.id);
        a.textContent = e.name.replace(/: Stage General Classification$/, "").replace(/: Stage Classification$/, "").replace(/^Final Classification: /, "");
        a.style.cssText = "display:inline-block;margin:0 8px 0 0;color:#c2410c";
        wrap.appendChild(a);
      });
      box.appendChild(wrap);
    }
    group("Stage results and general classification (open one, then press the bookmark):", m.results);
    group("Leader after each stage:", m.leader);
    group("End of the race (not every race pays these):", m.final);
  }

  function cancelCountdown() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // running = true shows a Stop button while the bookmark is clicking
  // opts.todo = a competition id to list the missing pages for (and offer "Get everything" for)
  // opts.reread = offer "Open the rows again"; opts.skip = { kind, id, label } offers a skip button
  // opts.next = true counts down to the next missing page and opens it
  function overlay(msg, c, running, opts) {
    cancelCountdown();
    opts = opts || {};
    var old = document.getElementById("kinderkopjedb-overlay");
    if (old) old.remove();
    var box = document.createElement("div");
    box.id = "kinderkopjedb-overlay";
    box.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:99999;background:#fff;color:#111;border:2px solid #ff6a2b;" +
      "border-radius:8px;padding:10px 12px;font:13px system-ui,sans-serif;max-width:400px;box-shadow:0 2px 10px rgba(0,0,0,.3)";
    msgEl = document.createElement("div");
    msgEl.textContent = msg;
    box.appendChild(msgEl);
    infoEl = document.createElement("div");
    infoEl.style.cssText = "margin-top:4px;color:#555";
    infoEl.textContent = counts(c);
    box.appendChild(infoEl);
    if (opts.todo) todoList(box, c, opts.todo);
    function btn(label, fn) {
      var b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "margin:6px 6px 0 0;padding:4px 8px;cursor:pointer";
      b.onclick = fn;
      box.appendChild(b);
      return b;
    }
    if (running) {
      btn("Stop", function () {
        stopped = true;
        msgEl.textContent = "Stopping after the current page ...";
      });
      document.body.appendChild(box);
      return;
    }
    // the suggested next page: always a button to open it, and with opts.next a countdown that opens it by itself
    var next = opts.next || opts.todo ? nextPageToOpen(c, opts.todo, loadSkips()) : undefined;
    if (next) {
      var nextEl = document.createElement("div");
      nextEl.style.cssText = "margin-top:8px;font-weight:bold;color:#c2410c";
      box.appendChild(nextEl);
      var go = function () {
        cancelCountdown();
        nextEl.textContent = "Opening " + next.label + " ...";
        openPage(next.path);
      };
      var still = function () {
        nextEl.textContent = "Next missing page: " + next.label;
      };
      btn("Open the next page", go);
      if (opts.next) {
        var left = COUNTDOWN;
        var show = function () {
          nextEl.textContent = "Opening the next missing page in " + left + " s: " + next.label;
        };
        show();
        timer = setInterval(function () {
          left--;
          if (left > 0) show();
          else go();
        }, 1000);
        var stay = btn("Stay here", function () {
          cancelCountdown();
          still();
          stay.remove();
        });
      } else still();
    } else if (opts.next) {
      var doneEl = document.createElement("div");
      doneEl.style.cssText = "margin-top:8px;font-weight:bold";
      doneEl.textContent = "Nothing is left to open in this race. Open the next race from KinderkopjeDB's queue yourself.";
      box.appendChild(doneEl);
    }
    var pages = opts.todo ? racePages(c, opts.todo, loadSkips().events) : null;
    if (pages && (pages.competitionPage || pages.events.length)) {
      btn("Get everything for this race", function () {
        everything(opts.todo);
      });
    }
    if (opts.skip) {
      btn("Skip this " + opts.skip.label + " and go on", function () {
        skip(opts.skip.kind, opts.skip.id);
        var n = nextPageToOpen(load(), opts.todo, loadSkips());
        if (n) openPage(n.path);
        else overlay("Skipped. Nothing else is left to open.", load(), false);
      });
    }
    btn("Download collection", function () {
      var blob = new Blob([JSON.stringify(load(), null, 1)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "uci-capture.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    btn("Clear collection", function () {
      cancelCountdown();
      if (confirm("Delete everything captured so far?")) {
        clearCollection();
        localStorage.removeItem(SKIP_STORE);
        overlay("Collection cleared.", load(), false);
      }
    });
    if (opts.reread) {
      btn("Open the rows again", function () {
        run(true);
      });
    }
    btn("Close", function () {
      cancelCountdown();
      box.remove();
    });
    document.body.appendChild(box);
  }
  function progress(text, c) {
    if (msgEl) msgEl.textContent = text;
    if (infoEl && c) infoEl.textContent = counts(c);
  }

  // the text of the page's filters, to find "Men Elite" / "Women Elite" in the Category box
  function categoryFilterText() {
    var inputs = document.querySelectorAll(".k-dropdown .k-input, .k-dropdown-wrap .k-input, .k-input");
    for (var i = 0; i < inputs.length; i++) {
      var t = (inputs[i].textContent || "").replace(/\s+/g, " ").trim();
      if (/^(Men|Women)/i.test(t)) return t;
    }
    return "";
  }

  function addEventResult(c, ev) {
    var have = null;
    for (var i = 0; i < c.eventResults.length; i++) if (c.eventResults[i].eventId === ev.eventId) have = c.eventResults[i];
    if (!have) {
      c.eventResults.push(ev);
      return;
    }
    // another page of the same table: add its rows
    var seen = {};
    have.rows.forEach(function (r) {
      seen[r.rank + "|" + r.rider] = r;
    });
    ev.rows.forEach(function (r) {
      seen[r.rank + "|" + r.rider] = r;
    });
    have.rows = Object.keys(seen)
      .map(function (k) {
        return seen[k];
      })
      .sort(function (a, b) {
        return (a.rank || 1e9) - (b.rank || 1e9);
      });
    have.totalRows = Math.max(have.totalRows, ev.totalRows);
    if (ev.heading) have.heading = ev.heading;
    if (ev.date) have.date = ev.date;
  }

  var stop = function () {
    return stopped;
  };

  // open every closed row of a competition page (this one or one in the hidden frame) and save its event list
  async function readCompetitionIn(doc, pathname, c, say) {
    var known = null;
    var opened = 0;
    await pageThrough(doc, realEnv, {
      maxPages: 8,
      pause: 1200,
      stop: stop,
      again: function () {
        return true;
      },
      progress: say,
      read: async function () {
        opened += await expandAll(doc, realEnv, { stop: stop, progress: say });
        var ce = readCompetitionEvents(doc, pathname);
        if (ce && ce.events.length) {
          for (var j = 0; j < c.competitionEvents.length; j++) if (c.competitionEvents[j].competitionId === ce.competitionId) known = c.competitionEvents[j];
          if (known) known.events = mergeEvents(known.events, ce.events);
          else {
            c.competitionEvents.push(ce);
            known = ce;
          }
          save(c);
        }
        return ce;
      },
    });
    return { known: known, opened: opened };
  }

  // read an event page's points (this one or one in the hidden frame), going on to the next page of the table while it scores
  async function readEventIn(doc, pathname, search, c, say) {
    var last = null;
    var pages = await pageThrough(doc, realEnv, {
      maxPages: 4,
      pause: 1200,
      stop: stop,
      again: function (ev) {
        // the next page can hold more points only when every row on this page scored
        return !!ev && ev.rows.length === ev.totalRows;
      },
      progress: say,
      read: function () {
        var ev = readEventResults(doc, pathname, search);
        if (ev && ev.totalRows) {
          addEventResult(c, ev);
          save(c);
          last = ev;
          say("Read " + ev.rows.length + " point-scoring rows of " + ev.totalRows + " ...");
        }
        return ev;
      },
    });
    var all = null;
    if (last) for (var k = 0; k < c.eventResults.length; k++) if (c.eventResults[k].eventId === last.eventId) all = c.eventResults[k];
    return { last: last, all: all, pages: pages };
  }

  // load one DataRide page of this site in a hidden frame and hand its document to `use` once `ready` says it has loaded
  function inFrame(path, ready, use) {
    return new Promise(function (resolve) {
      var f = document.createElement("iframe");
      f.style.cssText = "position:fixed;left:-3000px;top:0;width:1200px;height:900px;visibility:hidden";
      f.onload = async function () {
        var out = null;
        try {
          var doc = f.contentDocument;
          var ok = await waitFor(function () {
            return ready(doc, f.contentWindow.location);
          }, realEnv, 20000, 300);
          if (ok) out = await use(doc, f.contentWindow.location);
        } catch (e) {}
        f.remove();
        resolve(out);
      };
      f.src = path;
      document.body.appendChild(f);
    });
  }

  // read every missing page of one race in the hidden frame: its event list first when it is not known yet
  async function everything(competitionId) {
    stopped = false;
    var c = load();
    var say = function (t) {
      progress(t, c);
    };
    overlay("Getting everything for this race ...", c, true);
    if (racePages(c, competitionId, loadSkips().events).competitionPage) {
      say("Opening the race's competition page ...");
      await inFrame(
        competitionPagePath(competitionId),
        function (doc, loc) {
          var x = readCompetitionEvents(doc, loc.pathname);
          return !!x && x.events.length > 0;
        },
        function (doc, loc) {
          return readCompetitionIn(doc, loc.pathname, c, say);
        },
      );
    }
    var names = {};
    for (var i = 0; i < c.competitionEvents.length; i++)
      if (c.competitionEvents[i].competitionId === competitionId) c.competitionEvents[i].events.forEach(function (x) { names[x.id] = x.name; });
    var todo = racePages(c, competitionId, loadSkips().events).events.map(function (id) {
      return { id: id, name: names[id] || "event " + id };
    });
    var got = 0;
    var failed = [];
    for (var n = 0; n < todo.length && !stopped; n++) {
      var e = todo[n];
      say("Page " + (n + 1) + " of " + todo.length + ": " + e.name + " ...");
      var r = await inFrame(
        eventPagePath(competitionId, e.id),
        function (doc, loc) {
          var ev = readEventResults(doc, loc.pathname, loc.search);
          return !!ev && ev.totalRows > 0;
        },
        function (doc, loc) {
          return readEventIn(doc, loc.pathname, loc.search, c, function () {});
        },
      );
      if (r && r.last) got++;
      else failed.push(e.name);
      if (n + 1 < todo.length && !stopped) await realEnv.sleep(FRAME_PAUSE);
    }
    overlay(
      (stopped ? "Stopped. " : "Done. ") + "Read " + got + " of " + todo.length + " missing pages of this race." +
        (failed.length ? " These did not load and are still missing: " + failed.join(", ") + "." : ""),
      c,
      false,
      { todo: competitionId, next: !stopped && !failed.length },
    );
  }

  async function run(force) {
    stopped = false;
    var c = load();
    var kind = pageKind(location.pathname);
    var say = function (t) {
      progress(t, c);
    };

    if (kind === "list") {
      var filter = categoryFilterText();
      if (isOtherCategory(filter)) {
        overlay("This list is filtered to \"" + filter + "\". Only Men Elite and Women Elite are collected: change the Category filter and press again.", c, false);
        return;
      }
      overlay("Reading the list" + (filter ? " (" + filter + ")" : "") + " ...", c, true);
      var listed = 0;
      var pages = await pageThrough(document, realEnv, {
        maxPages: 80,
        pause: 1200,
        stop: stop,
        again: function () {
          return true;
        },
        progress: function (t) {
          progress(t + " " + listed + " competitions so far.", c);
        },
        read: function () {
          var list = readCompetitionList(document, filter);
          list.forEach(function (x) {
            c.competitions = c.competitions.filter(function (y) {
              return y.id !== x.id;
            });
            c.competitions.push(x);
          });
          listed += list.length;
          save(c);
          progress("Read a page of the list: " + listed + " competitions so far ...", c);
          return list.length;
        },
      });
      overlay(
        (stopped ? "Stopped. " : "Done. ") + "Read " + pages + " page" + (pages === 1 ? "" : "s") + " of the list, " + listed + " competitions" +
          (filter ? " (" + filter + ")" : " (no Category filter found: women's races are told by their names)") +
          ". NEXT: download the collection and open it in KinderkopjeDB, or change the season or category and press again.",
        c,
        false,
      );
      return;
    }

    if (kind === "competition") {
      // a competition whose rows were opened in an earlier press is not opened again: its event list is already saved,
      // so nothing is clicked and the missing pages are listed straight away
      var compId = Number(/CompetitionResults\/(\d+)/i.exec(location.pathname)[1]);
      var saved = null;
      for (var s = 0; s < c.competitionEvents.length; s++) if (c.competitionEvents[s].competitionId === compId) saved = c.competitionEvents[s];
      if (!force && hasEventList(saved)) {
        overlay("This race's event list is already saved, so no rows were opened.", c, false, { todo: compId, reread: true, next: true, skip: { kind: "competitions", id: compId, label: "race" } });
        return;
      }
      overlay("Opening the closed rows of this competition ...", c, true);
      var got = await readCompetitionIn(document, location.pathname, c, say);
      if (!got.known) {
        overlay("No events found on this page. Wait for it to load, then press again, or skip the race.", c, false, { skip: { kind: "competitions", id: compId, label: "race" } });
        return;
      }
      overlay(
        (stopped ? "Stopped. " : "Done. ") + "Opened " + got.opened + " row" + (got.opened === 1 ? "" : "s") + "; " + got.known.events.length + " events known for this competition. " +
          "NEXT: the missing pages open one by one (press the bookmark on each), or get them all at once.",
        c,
        false,
        { todo: compId, next: !stopped, skip: { kind: "competitions", id: compId, label: "race" } },
      );
      return;
    }

    if (kind === "event") {
      var here = Number(/EventResults\/(\d+)/i.exec(location.pathname)[1]);
      var fromComp = Number(/competitionId=(\d+)/i.exec(location.search)?.[1]) || undefined;
      overlay("Reading the results ...", c, true);
      var ev = await readEventIn(document, location.pathname, location.search, c, say);
      if (!ev.last) {
        overlay("No result table found, or it is empty so far. Wait for the results to load, then press again, or skip the page.", c, false, {
          todo: fromComp,
          skip: { kind: "events", id: here, label: "page" },
        });
        return;
      }
      var complete = ev.all && isComplete(ev.all);
      overlay(
        (stopped ? "Stopped. " : "") + "Captured " + (ev.all ? ev.all.rows.length : 0) + " point-scoring rows from " + ev.pages + " page" + (ev.pages === 1 ? "" : "s") + ". " +
          (complete
            ? "This event is complete."
            : "The last page I read still had only scoring rows; press again to go on, or the points may end exactly there."),
        c,
        false,
        { todo: ev.last.competitionId, next: complete && !stopped },
      );
      return;
    }

    overlay("This is not a DataRide results page. Open the competition list (dataride.uci.ch/iframe/Results/10/), a competition or an event first.", c, false);
  }

  // the queue hand-off of earlier versions is gone; drop the work list it kept
  try {
    localStorage.removeItem("racethreads-capture-uci-work");
  } catch (e) {}
  openStore()
    .then(function () {
      return run();
    })
    .catch(function (e) {
      overlay("Stopped by an error: " + (e && e.message ? e.message : e) + ". What was read so far is kept.", load(), false);
    });
})();
