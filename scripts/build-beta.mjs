// Builds the public beta database (a SQLite file anyone can download) from capture files.
//
//   node scripts/build-beta.mjs <capture.json> [more capture files] [--out file] [--note "text"]
//        [--aliases file] [--renames file] [--links file] [--registry file]
//
// The capture files are the ones the bookmark downloads. --aliases, --renames, --links and --registry are text files with
// the join lines, the rename lines, the stored links (JSON) and the race registry (YAML) saved in your browser, if you
// want them in the file; without them the races are not joined and have their default names. The result goes to
// data/public/kinderkopjedb-public.sqlite, which the site build publishes as kinderkopjedb-public.sqlite.
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const files = [];
const opt = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) opt[args[i].slice(2)] = args[++i];
  else files.push(args[i]);
}
if (!files.length) {
  console.error("Usage: node scripts/build-beta.mjs <capture.json> [more files] [--out file] [--note text] [--aliases f] [--renames f] [--links f] [--registry f]");
  process.exit(2);
}
const out = resolve(opt.out ?? "data/public/kinderkopjedb-public.sqlite");

// the tool's own code, bundled for node (packages stay external, so the bundle sits inside the project)
const bundleFile = resolve("scripts/.beta-bundle.mjs");
const bundled = await build({
  stdin: {
    contents: 'export * from "../src/core/index.ts"; export * from "../src/db/index.ts"; export { default as initSqlJs } from "sql.js/dist/sql-wasm-inline.js";',
    resolveDir: resolve("scripts"),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  write: false,
  logLevel: "error",
});
writeFileSync(bundleFile, bundled.outputFiles[0].text);
let tool;
try {
  tool = await import(pathToFileURL(bundleFile).href);
} finally {
  rmSync(bundleFile, { force: true });
}

const SQL = await tool.initSqlJs();
const cube = tool.emptyCube();
for (const f of files) {
  const report = tool.addCapture(cube, JSON.parse(readFileSync(f, "utf8")));
  console.log(f + ": " + (report.competitions ?? 0) + " competitions, " + report.races + " event results" + (report.skipped.length ? ", skipped: " + report.skipped.join("; ") : ""));
}
const db = tool.openDatabase(SQL);
tool.saveCube(db, cube);
for (const [flag, key] of [["aliases", "racealiases"], ["renames", "racenames"], ["links", "racelinks"], ["registry", "registry"]]) {
  if (opt[flag]) tool.setKv(db, key, readFileSync(opt[flag], "utf8"));
}
tool.writeRaces(db, cube);
const bytes = tool.makePublicCopy(SQL, db, opt.note ?? "Built from capture files" + (opt.aliases ? " with the join lines" : " without join lines") + ".");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
const info = tool.publicInfo(tool.openDatabase(SQL, bytes));
console.log("Wrote " + out + " (" + Math.round(bytes.length / 1024) + " KB): " + info.races + " races, " + info.editions + " editions, " + info.results + " results, " + info.firstYear + " to " + info.lastYear + ".");
