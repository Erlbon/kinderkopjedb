// Builds the site into dist/: four pages that share app.js (with SQLite inside) and app.css.
import { build, buildSync } from "esbuild";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
let sha = "dev";
try {
  sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {
  /* not a git checkout (e.g. a source zip) */
}
const version = "v" + pkg.version + " (" + sha + ")";

// clear the folder's contents, not the folder: a server or a terminal may be sitting in it (Windows refuses to delete that)
mkdirSync("dist", { recursive: true });
for (const f of readdirSync("dist")) rmSync("dist/" + f, { recursive: true, force: true });

// the app: one bundle, SQLite (WebAssembly inlined) included, so pages also open without a network
await build({
  entryPoints: ["src/web/app.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "RT",
  target: "es2020",
  platform: "browser",
  external: ["node:*"], // sql.js only touches these under Node
  loader: { ".yaml": "text" },
  outfile: "dist/app.js",
  logLevel: "warning",
});

// the capture helpers as bookmarklet links
// bundled, because the race bookmark shares its page-reading code with the saved-page reader
const bookmarklet = (file) => {
  const out = buildSync({ entryPoints: [file], bundle: true, minify: true, write: false, format: "iife", target: "es2017", logLevel: "warning" });
  return "javascript:" + encodeURIComponent(out.outputFiles[0].text);
};
const links = {
  __BOOKMARKLET_HREF__: bookmarklet("tools/capture-dataride.js"),
  __BOOKMARKLET_RACE_HREF__: bookmarklet("tools/capture-uci-race.js"),
};

for (const f of readdirSync("src/site").filter((n) => n.endsWith(".html"))) {
  let html = readFileSync("src/site/" + f, "utf8").split("__VERSION__").join(version).split("__BUILD__").join(sha);
  for (const [k, v] of Object.entries(links)) html = html.split(k).join(v);
  writeFileSync("dist/" + f, html);
}
copyFileSync("src/site/app.css", "dist/app.css");
copyFileSync("src/site/favicon.svg", "dist/favicon.svg");

// the data overview as downloadable files, written from the same text the Data page shows
const dict = await build({ entryPoints: ["src/db/dictionary.ts"], bundle: true, format: "esm", platform: "node", write: false, logLevel: "warning" });
const overview = await import("data:text/javascript;base64," + Buffer.from(dict.outputFiles[0].text).toString("base64"));
writeFileSync("dist/kinderkopjedb-data-overview.html", overview.dictionaryHtml(overview.DICTIONARY, version));
writeFileSync("dist/kinderkopjedb-data-overview.md", overview.dictionaryMarkdown(overview.DICTIONARY));
writeFileSync("dist/kinderkopjedb-data-overview.json", overview.dictionaryJson(overview.DICTIONARY, version));

// the public dataset, when one has been saved into the repository (Data page: Save a public copy)
if (existsSync("data/public/kinderkopjedb-public.sqlite")) copyFileSync("data/public/kinderkopjedb-public.sqlite", "dist/kinderkopjedb-public.sqlite");

// to run the site from a folder: node serve.mjs (or start.cmd on Windows)
copyFileSync("tools/serve.mjs", "dist/serve.mjs");
writeFileSync("dist/start.cmd", "@echo off\r\nnode serve.mjs\r\n");
writeFileSync(
  "dist/README.txt",
  [
    "KinderkopjeDB " + version,
    "",
    "Run:  node serve.mjs   (or double-click start.cmd). Then open http://localhost:8765 in your browser.",
    "The pages keep their data in a SQLite database in your browser; save a copy from the Data page.",
    "",
  ].join("\n"),
);

console.log("dist/ built " + version + ": " + readdirSync("dist").join(", "));
