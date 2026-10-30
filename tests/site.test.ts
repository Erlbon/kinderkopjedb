import { readFileSync, readdirSync } from "node:fs";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

describe("the site icon", () => {
  it("is a well-formed SVG with the wheel and the four jersey dots", () => {
    const doc = parseHTML(read("src/site/favicon.svg"), "image/svg+xml") as unknown as { document: Document };
    const svg = doc.document.documentElement;
    expect(svg.getAttribute("viewBox")).toBe("0 0 32 32");
    const fills = Array.from(svg.querySelectorAll("circle")).map((c) => c.getAttribute("fill"));
    for (const jersey of ["#ffd23f", "#1fa34a", "#ffffff", "#d6282c"]) expect(fills, jersey).toContain(jersey);
  });
  it("is linked from every page", () => {
    for (const f of readdirSync(new URL("../src/site", import.meta.url)).filter((n) => n.endsWith(".html"))) {
      expect(read("src/site/" + f), f).toContain('<link rel="icon" type="image/svg+xml" href="favicon.svg">');
    }
  });
});

describe("the site headline", () => {
  const brand = (inner: string) => '<header class="brand"><a href="index.html"><img src="favicon.svg" width="36" height="36" alt="">' + inner + "</a></header>";
  it("is the project name with the logo, as the title of the home page and a link back on every other page", () => {
    expect(read("src/site/index.html")).toContain(brand("<h1>KinderkopjeDB - /r/Peloton's Data Collection Project</h1>"));
    for (const f of ["threads", "teams", "collect", "data"]) expect(read("src/site/" + f + ".html"), f).toContain(brand(`<span class="name">KinderkopjeDB - /r/Peloton's Data Collection Project</span>`));
  });
});

describe("the colours", () => {
  it("use orange for buttons, the current tab and links, in both modes", () => {
    const css = read("src/site/app.css");
    for (const orange of ["#d9480f", "#ff8a4c", "#ff6a2b"]) expect(css, orange).toContain(orange);
    expect(css).not.toContain("#0b57d0");
    expect(css).not.toContain("#8ab4f8");
    expect(css).toContain("nav a.active{background:var(--acc);color:var(--on-acc)");
  });
});

describe("the intro page", () => {
  const nav = (active: string) =>
    "<nav>" + [["index", "Intro"], ["threads", "Threads"]].map(([f, t]) => '<a ' + (f === active ? 'class="active" ' : "") + 'href="' + f + '.html">' + t + "</a>").join("") + "<a";
  it("is the front page and the first tab on every page", () => {
    for (const f of ["index", "threads", "teams", "collect", "data"]) {
      const html = read("src/site/" + f + ".html");
      expect(html, f).toContain(nav(f));
    }
  });
  it("states the intent, lists the three tasks with their status, and describes the open database", () => {
    const html = read("src/site/index.html");
    expect(html).toContain("AI-assisted hub for collecting information from r/peloton, UCI.org and other sources");
    expect(html).toContain("a small open database of cycling results, about five years back");
    expect(html).toContain("the code here is open source (MIT)");
    // what is built and what is not is said honestly, on the cards
    const doc = parseHTML(html).document as unknown as Document;
    const status = (title: string) => Array.from(doc.querySelectorAll(".card2")).find((c) => c.querySelector("h3")?.textContent === title)?.querySelector(".tag")?.textContent;
    expect(status("Race thread generation")).toBe("Working");
    expect(status("Race statistics")).toBe("Planned");
    expect(status("Team statistics")).toBe("Working");
    expect(status("Open database")).toBe("Beta");
    // the old typos stay out
    for (const typo of ["raison d'etre", "pointshaul", "sql lite", "f.e.", "reddit/r/peloton"]) expect(html, typo).not.toContain(typo);
  });
  it("names the code, the licence, the data credits, and that it is not affiliated with UCI or Reddit", () => {
    const html = read("src/site/index.html");
    expect(html).toContain("https://github.com/Erlbon/kinderkopje");
    expect(html).toContain("https://github.com/Erlbon/kinderkopje/issues");
    for (const text of ["MIT licence", "CC BY-SA 4.0", "Not affiliated", "nothing is uploaded"]) expect(html, text).toContain(text);
  });
  it("says plainly that FirstCycling is deliberately not scraped, and does not mention ProCyclingStats", () => {
    const html = read("src/site/index.html");
    expect(html).toContain("We deliberately do not scrape FirstCycling");
    expect(html).toContain("we will not work around a refusal");
    expect(html.toLowerCase()).not.toContain("procyclingstats");
  });
  it("has the data flow picture with a text alternative, and no banner picture above the text", () => {
    const doc = parseHTML(read("src/site/index.html")).document as unknown as Document;
    expect(doc.querySelector("svg.hero")).toBeNull();
    const svg = doc.querySelector("svg.flow")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.querySelector("title")!.textContent).toBeTruthy();
    expect(svg.querySelector("desc")!.textContent).toContain("SQLite database");
  });
  it("lists its sources in a box with named links", () => {
    const html = read("src/site/index.html");
    const doc = parseHTML(html).document as unknown as Document;
    const links = Array.from(doc.querySelectorAll("#sources + fieldset a"));
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const a of links) {
      expect(a.getAttribute("href"), a.textContent ?? "").toMatch(/^https:\/\//);
      expect((a.textContent ?? "").trim().length).toBeGreaterThan(2);
    }
    expect(doc.querySelector('a[href="#sources"]')).not.toBeNull();
  });
});

describe("cached files", () => {
  it("every page asks for the stylesheet and the script with the build id, so an old copy cannot be paired with a new page", () => {
    for (const f of readdirSync(new URL("../src/site", import.meta.url)).filter((n) => n.endsWith(".html"))) {
      const html = read("src/site/" + f);
      expect(html, f).toContain('href="app.css?v=__BUILD__"');
      if (html.includes("app.js")) expect(html, f).toContain('src="app.js?v=__BUILD__"');
    }
    expect(read("build.mjs")).toContain('split("__BUILD__")');
  });
});
