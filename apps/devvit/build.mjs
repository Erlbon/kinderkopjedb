// Builds the post page (public/finder.js) and the server (dist/server/index.js).
// `node build.mjs --watch` keeps both up to date (devvit playtest runs it).
import * as esbuild from "esbuild";

const common = { bundle: true, logLevel: "warning", target: "es2023" };
const builds = [
  { ...common, entryPoints: ["src/client/finder.ts"], outdir: "public", format: "esm", platform: "browser" },
  { ...common, entryPoints: ["src/server/index.ts"], outdir: "dist/server", format: "cjs", platform: "node" },
];

if (process.argv.includes("--watch")) {
  for (const b of builds) await (await esbuild.context(b)).watch();
  console.log("watching src/ and ../../src/core");
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
