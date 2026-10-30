import { buildSync } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { competitionPagePath, eventPagePath } from "../src/core";

// the capture bookmark as the build bundles it, run on a fake DataRide page
const bundle = buildSync({ entryPoints: ["tools/capture-uci-race.js"], bundle: true, format: "iife", target: "es2017", write: false, logLevel: "warning" }).outputFiles[0].text;

const collection = {
  format: "racethreads-capture/1",
  competitions: [{ id: 2, name: "Tour of Guangxi", start: "2026-10-13", end: "2026-10-18", year: 2026, country: "CHN", class: "2.UWT", inProgress: false }],
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

async function pressBookmark(pathname: string, search = "") {
  const { document } = parseHTML("<!doctype html><html><head></head><body></body></html>");
  const store: Record<string, string> = { "racethreads-capture-uci": JSON.stringify(collection) };
  const location = { pathname, search, href: "https://dataride.uci.ch" + pathname + search };
  const timers: (() => void)[] = [];
  runInNewContext(bundle, {
    document,
    location,
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v), removeItem: (k: string) => delete store[k] },
    setTimeout: (f: () => void) => (f(), 0),
    setInterval: (f: () => void) => timers.push(f),
    clearInterval: () => (timers.length = 0),
    Blob: class {},
    URL: { createObjectURL: () => "blob:x" },
    confirm: () => false,
    console,
  });
  await new Promise((r) => setTimeout(r, 50));
  const button = (label: RegExp) => Array.from(document.querySelectorAll("#kinderkopjedb-overlay button")).find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
  return { location, button, tick: () => timers.slice().forEach((f) => f()) };
}

describe("the capture bookmark's box", () => {
  it("keeps a button to the suggested next page after the countdown is stopped", async () => {
    const page = await pressBookmark("/iframe/CompetitionResults/2");
    page.button(/Stay here/)!.click();
    for (let i = 0; i < 10; i++) page.tick();
    expect(page.location.href).toContain("/CompetitionResults/2");
    const open = page.button(/Open the next page/);
    expect(open).toBeDefined();
    open!.click();
    expect(page.location.href).toBe(eventPagePath(2, 23));
  });

  it("offers the next page also when this page could not be read", async () => {
    const page = await pressBookmark("/iframe/EventResults/21", "?competitionId=2&disciplineId=10");
    page.button(/Open the next page/)!.click();
    expect(page.location.href).toBe(eventPagePath(2, 23));
  });

  it("still opens the next page by itself after the collection is downloaded", async () => {
    const page = await pressBookmark("/iframe/CompetitionResults/2");
    page.button(/Download/)!.click();
    for (let i = 0; i < 10; i++) page.tick();
    expect(page.location.href).toBe(eventPagePath(2, 23));
  });

  it("goes to the race's competition page when its events are not known yet", async () => {
    const page = await pressBookmark("/iframe/EventResults/99", "?competitionId=5&disciplineId=10");
    page.button(/Open the next page/)!.click();
    expect(page.location.href).toBe(competitionPagePath(5));
  });
});
