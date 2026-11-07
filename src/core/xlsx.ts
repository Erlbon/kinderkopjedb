/**
 * Just enough of the .xlsx format to read the first sheet of a plain export (such as the UCI calendar) as rows of text.
 * An .xlsx file is a zip archive of XML files; the zip is read here and inflated with the platform's DecompressionStream,
 * so no library is needed in the browser or in Node.
 */

const u16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u32 = (b: Uint8Array, i: number) => (u16(b, i) | (u16(b, i + 2) << 16)) >>> 0;

/** The files in a zip archive, by name, each read when asked for. */
export function zipEntries(bytes: Uint8Array): Map<string, () => Promise<Uint8Array>> {
  // the end-of-central-directory record is in the last 64 KB (after an optional comment)
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip file");
  const count = u16(bytes, end + 10);
  let p = u32(bytes, end + 16);
  const out = new Map<string, () => Promise<Uint8Array>>();
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error("damaged zip file");
    const method = u16(bytes, p + 10);
    const size = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const data = bytes.subarray(start, start + size);
    out.set(name, async () => {
      if (method === 0) return data;
      if (method !== 8) throw new Error(name + ": a zip packing method this reader does not know (" + method + ")");
      const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()]!;
  });
}

/** The text of every <t> inside a piece of XML, joined (a rich-text cell or shared string is split into runs). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join("");

/** "C" -> 2, "AA" -> 26: the column of a cell reference such as C12. */
function column(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The first sheet of an .xlsx file as rows of text cells (empty cells as ""). */
export async function readXlsxRows(bytes: Uint8Array): Promise<string[][]> {
  const files = zipEntries(bytes);
  const read = async (name: string) => new TextDecoder().decode(await files.get(name)!());
  const sheetName = [...files.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new Error("no sheet in this file");
  const sharedName = [...files.keys()].find((n) => /^xl\/sharedStrings\.xml$/i.test(n));
  const shared = sharedName ? [...(await read(sharedName)).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!)) : [];
  const rows: string[][] = [];
  for (const row of (await read(sheetName)).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const body = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([a-zA-Z]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const value = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? texts(body) : v !== undefined ? decodeXml(v) : "";
      const at = ref ? column(ref) : cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = value;
    }
    rows.push(cells);
  }
  return rows;
}
