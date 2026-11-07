import { CaptureFile, addCapture, readUciCalendar, readXlsxRows } from "../core";
import type { Store } from "./store";

/** A UCI calendar export (.xlsx) into the queue: its elite races, with their dates, until DataRide's take their place. */
async function importCalendar(store: Store, f: File): Promise<string> {
  const cal = readUciCalendar(await readXlsxRows(new Uint8Array(await f.arrayBuffer())));
  const before = store.cube.queue?.length ?? 0;
  const r = addCapture(store.cube, { format: "racethreads-capture/1", competitions: cal.competitions });
  const kept = (store.cube.queue?.length ?? 0) - before;
  return (
    f.name + ": UCI calendar " + (cal.season ?? "") + ", " + cal.competitions.length + " elite races (" + Object.entries(r.categories ?? {}).map(([n, c]) => c + " " + n.toLowerCase()).join(", ") + "), " +
    kept + " new in the queue" + (cal.competitions.length - kept > 0 ? " (the rest were there already)" : "") + "; " + cal.skipped + " junior, under-23 and criterium races left out" +
    (cal.guessed ? "; " + cal.guessed + " had no category in the file, men's or women's read from the name" : "") +
    (cal.unknownCountries.length ? "; countries not known: " + cal.unknownCountries.join(", ") : "")
  );
}

/** Open capture files (made by the bookmarks) into the database, and UCI calendar exports (.xlsx). Returns one line per file. */
export async function importCaptureFiles(store: Store, files: File[]): Promise<string[]> {
  const lines: string[] = [];
  for (const f of files) {
    try {
      if (/\.xlsx$/i.test(f.name)) {
        lines.push(await importCalendar(store, f));
        continue;
      }
      let parsed: CaptureFile;
      try {
        parsed = JSON.parse(await f.text()) as CaptureFile;
      } catch {
        throw new Error("not a capture file (use the bookmark to make one)");
      }
      const r = addCapture(store.cube, parsed);
      lines.push(
        f.name + ": " + r.added + " rankings added, " + r.replaced + " replaced" + (r.competitions ? ", " + r.competitions + " competitions (" + Object.entries(r.categories ?? {}).map(([n, c]) => c + " " + n.toLowerCase()).join(", ") + ")" : "") + (r.events ? ", " + r.events + " event lists" : "") + (r.races ? ", " + r.races + " event results" : "") +
          (r.skipped.length ? ", skipped: " + r.skipped.join("; ") : ""),
      );
    } catch (e) {
      lines.push(f.name + ": " + (e instanceof Error ? e.message : "could not read this file"));
    }
  }
  try {
    await store.saveCube();
  } catch (e) {
    // what was read is on the page, but it is not in the stored database: say so
    lines.push("NOT SAVED to the database: " + (e instanceof Error ? e.message : String(e)));
  }
  return lines;
}
