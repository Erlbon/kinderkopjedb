import { type FoundPost, matchEdition } from "../../../../src/core/thread-match.ts";
import { Endpoint, type EditionEntry, type EditionsRsp, type PostsReq, type PostsRsp, type SearchReq, type SearchRsp } from "../shared/api.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rowsEl = $<HTMLTableSectionElement>("rows");
const statusEl = $<HTMLSpanElement>("status");
const outEl = $<HTMLTextAreaElement>("out");
const runBtn = $<HTMLButtonElement>("run");
const copyBtn = $<HTMLButtonElement>("copy");
const subEl = $<HTMLInputElement>("sub");

let editions: EditionEntry[] = [];
const results: SearchRsp[] = [];

const TIME_LIMIT_MS = 45_000; // a request that has not answered by then is given up (a run once hung on one)

async function getJsonOnce<T>(url: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIME_LIMIT_MS);
  try {
    const rsp = await fetch(url, { ...init, signal: ctl.signal, headers: { Accept: "application/json", "Content-Type": "application/json" } });
    if (!rsp.ok) throw new Error(`HTTP ${rsp.status}: ${(await rsp.text().catch(() => "")).slice(0, 300)}`);
    return (await rsp.json()) as T;
  } catch (err) {
    if (ctl.signal.aborted) throw new Error("no answer in " + TIME_LIMIT_MS / 1000 + " s");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** One retry after a short pause: Reddit sometimes refuses a burst of searches. */
async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    return await getJsonOnce<T>(url, init);
  } catch {
    await new Promise((r) => setTimeout(r, 3000));
    return getJsonOnce<T>(url, init);
  }
}

function el(tag: string, text = "", cls = ""): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function label(e: EditionEntry): string {
  return e.year + " " + e.name + " (" + e.class + ")";
}

function expected(e: EditionEntry): number {
  return e.stages?.length || 1;
}

function drawRow(i: number, r?: SearchRsp, error?: string): void {
  const e = editions[i]!;
  const tr = document.createElement("tr");
  const name = el("td");
  name.append(el("div", label(e)));
  if (r?.match.threads.length) {
    const d = document.createElement("details");
    d.append(el("summary", "threads"));
    for (const t of r.match.threads) {
      const a = el("a", t.post.title) as HTMLAnchorElement;
      a.href = "https://www.reddit.com" + t.post.permalink;
      a.target = "_blank";
      const line = el("div");
      line.append(a);
      if (t.note) line.append(el("span", " (" + t.note + ")", "miss"));
      d.append(line);
    }
    name.append(d);
  }
  // when something is missing: the race threads the search found that did not match, to see why
  if (r && (r.match.missingRace || r.match.missingStages.length) && r.match.otherTitles.length) {
    const d = document.createElement("details");
    d.append(el("summary", r.match.otherTitles.length + " other race threads in the search"));
    for (const o of r.match.otherTitles) d.append(el("div", o.createdAt.slice(0, 10) + " " + o.title));
    name.append(d);
  }
  tr.append(name);
  if (error) {
    tr.append(el("td", "error", "miss"), el("td", error, "miss"), el("td"));
  } else if (!r) {
    tr.append(el("td", "…"), el("td", "of " + expected(e)), el("td"));
  } else {
    const m = r.match;
    const stageThreads = m.threads.filter((t) => t.kind === "stage").length;
    const found = e.stages?.length ? stageThreads + " of " + expected(e) : m.missingRace ? "0 of 1" : "1 of 1";
    const missing = e.stages?.length ? m.missingStages.join(", ") : m.missingRace ? "race" : "";
    const extra = m.threads.length - (e.stages?.length ? stageThreads : m.missingRace ? 0 : 1);
    tr.append(
      el("td", found + (extra > 0 ? " +" + extra + " other" : ""), missing ? "n miss" : "n ok"),
      el("td", missing + (m.outsideDates.length ? " (" + m.outsideDates.length + " outside the dates)" : ""), "miss"),
      el("td", r.queries.map((q) => q.query + ": " + q.posts).join("; ")),
    );
  }
  const old = rowsEl.children[i];
  if (old) old.replaceWith(tr);
  else rowsEl.append(tr);
}

async function runAll(): Promise<void> {
  runBtn.disabled = true;
  copyBtn.disabled = true;
  results.length = 0;
  const subreddit = subEl.value;
  for (let i = 0; i < editions.length; i++) {
    statusEl.textContent = "Searching " + (i + 1) + " of " + editions.length + ": " + label(editions[i]!);
    try {
      const req: SearchReq = { index: i, subreddit };
      const r = await getJson<SearchRsp>(Endpoint.Search, { method: "POST", body: JSON.stringify(req) });
      results.push(r);
      drawRow(i, r);
    } catch (err) {
      drawRow(i, undefined, err instanceof Error ? err.message : String(err));
    }
  }
  await secondPass();
  const threads = results.reduce((n, r) => n + r.match.threads.length, 0);
  const want = editions.reduce((n, e) => n + expected(e), 0);
  statusEl.textContent = "Done: " + threads + " threads found, " + want + " expected (stages and one-day races).";
  outEl.value = JSON.stringify({ subreddit, searched: new Date().toISOString(), results }, null, 1);
  runBtn.disabled = false;
  copyBtn.disabled = false;
}

const misses = (r: SearchRsp) => r.match.missingRace || r.match.missingStages.length > 0;

/**
 * A thread often turns up in another race's search (the 2026 Dauphiné, renamed, came back in the
 * Tour de France search). Match every edition with something missing against all race threads that
 * any search returned, then fetch the text of the threads found that way.
 */
async function secondPass(): Promise<void> {
  const pool = new Map<string, FoundPost>();
  for (const r of results) {
    for (const t of r.match.threads) pool.set(t.post.id, t.post);
    for (const p of r.match.outsideDates) pool.set(p.id, p);
    for (const o of r.match.otherTitles) if (!pool.has(o.id)) pool.set(o.id, { id: o.id, title: o.title, createdAt: o.createdAt, permalink: o.permalink });
  }
  const posts = [...pool.values()];
  let gained = 0;
  for (const r of results) {
    if (!misses(r)) continue;
    const m = matchEdition(r.edition, posts);
    const before = r.match.threads.length;
    if (m.threads.length <= before) continue;
    statusEl.textContent = "Second pass: " + label(r.edition);
    // the posts that came from another search as a title only: fetch their text
    const need = m.threads.filter((t) => t.post.body === undefined).map((t) => t.post.id);
    for (let i = 0; i < need.length; i += 10) {
      try {
        const req: PostsReq = { ids: need.slice(i, i + 10) };
        const got = await getJson<PostsRsp>(Endpoint.Posts, { method: "POST", body: JSON.stringify(req) });
        for (const p of got.posts) {
          const t = m.threads.find((x) => x.post.id === p.id);
          if (t) t.post = p;
        }
      } catch (err) {
        console.error(err);
      }
    }
    gained += m.threads.length - before;
    r.match = m;
    drawRow(editions.indexOf(r.edition), r);
  }
  if (gained) statusEl.textContent = "Second pass found " + gained + " more threads.";
}

async function copy(): Promise<void> {
  outEl.select();
  try {
    await navigator.clipboard.writeText(outEl.value);
    statusEl.textContent = "Copied " + outEl.value.length + " characters.";
  } catch {
    // the post's frame may not get the clipboard: the text is selected, Ctrl+C copies it
    statusEl.textContent = "Selected: press Ctrl+C to copy.";
  }
}

async function init(): Promise<void> {
  runBtn.addEventListener("click", () => void runAll());
  copyBtn.addEventListener("click", () => void copy());
  try {
    editions = (await getJson<EditionsRsp>(Endpoint.Editions)).editions;
    editions.forEach((_, i) => drawRow(i));
    statusEl.textContent = editions.length + " editions ready.";
  } catch (err) {
    statusEl.textContent = "Could not load the editions: " + (err instanceof Error ? err.message : String(err));
  }
}

void init();
