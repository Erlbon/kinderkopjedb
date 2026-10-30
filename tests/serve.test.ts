import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// the offline server, started for real in a temporary folder
const dir = mkdtempSync(join(tmpdir(), "kinderkopjedb-serve-"));
copyFileSync(new URL("../tools/serve.mjs", import.meta.url), join(dir, "serve.mjs"));
writeFileSync(join(dir, "index.html"), "<p>hi</p>");
writeFileSync(join(dir, "favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
writeFileSync(join(dir, "x.sqlite"), "SQLite");
writeFileSync(join(dir, "x.md"), "# x");
const port = 18000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, [join(dir, "serve.mjs"), String(port)], { cwd: dir, stdio: "pipe" });
afterAll(async () => {
  const gone = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await gone; // the folder is locked while the server runs in it
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function type(path: string): Promise<string | null> {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch("http://127.0.0.1:" + port + path);
      return r.headers.get("content-type");
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("the server did not start");
}

describe("the offline server", () => {
  it("serves the logo and the downloads with types a browser accepts", async () => {
    expect(await type("/favicon.svg")).toBe("image/svg+xml");
    expect(await type("/x.sqlite")).toBe("application/vnd.sqlite3");
    expect(await type("/x.md")).toContain("text/markdown");
    expect(await type("/")).toContain("text/html");
  });
});
