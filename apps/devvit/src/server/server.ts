import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { type Post, reddit } from "@devvit/web/server";
import type { PartialJsonValue, UiResponse } from "@devvit/web/shared";
import { type FoundPost, editionQueries, matchEdition } from "../../../../src/core/thread-match.ts";
import {
  Endpoint,
  EndpointMethod,
  type EditionEntry,
  type EditionsRsp,
  type ErrorRsp,
  type PostsReq,
  type PostsRsp,
  type SearchReq,
  type SearchRsp,
} from "../shared/api.ts";
import editionsJson from "../shared/editions.json";

const editions = editionsJson as EditionEntry[];

/** Per query. A Grand Tour has 21+ race threads plus other posts that mention the race. */
const SEARCH_LIMIT = 250;

type AnyRsp = EditionsRsp | SearchRsp | PostsRsp | UiResponse | ErrorRsp;

export async function onReq(reqMsg: IncomingMessage, rspMsg: ServerResponse): Promise<void> {
  try {
    await route(reqMsg, rspMsg);
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`;
    console.error(msg);
    writeJson<ErrorRsp>(500, { error: msg, status: 500 }, rspMsg);
  }
}

async function route(reqMsg: IncomingMessage, rspMsg: ServerResponse): Promise<void> {
  const endpoint = reqMsg.url?.slice(1) as Endpoint;
  const method = EndpointMethod[endpoint];

  let rsp: AnyRsp;
  if (method !== reqMsg.method) {
    rsp = { error: "not found", status: 404 };
  } else {
    switch (endpoint) {
      case Endpoint.Editions:
        rsp = { editions };
        break;
      case Endpoint.Search:
        rsp = await routeSearch(await readJson<SearchReq>(reqMsg));
        break;
      case Endpoint.Posts:
        rsp = await routePosts(await readJson<PostsReq>(reqMsg));
        break;
      case Endpoint.OnMenuNewPost:
        rsp = await routeMenuNewPost();
        break;
      default:
        endpoint satisfies never;
        rsp = { error: "not found", status: 404 };
        break;
    }
  }

  writeJson<PartialJsonValue>("status" in rsp ? rsp.status : 200, rsp as PartialJsonValue, rspMsg);
}

/** One edition: run its searches, then match what came back. */
async function routeSearch(req: SearchReq): Promise<SearchRsp | ErrorRsp> {
  const edition = editions[req.index];
  if (!edition) return { error: "no edition " + req.index, status: 400 };
  const subredditName = req.subreddit.replace(/^\/?r\//i, "").trim() || "peloton";
  const queries: SearchRsp["queries"] = [];
  const posts: FoundPost[] = [];
  for (const query of editionQueries(edition)) {
    const found = await reddit.searchPosts({ query, subredditName, sort: "relevance", timeframe: "all", limit: SEARCH_LIMIT, pageSize: 100 }).all();
    queries.push({ query, posts: found.length });
    for (const p of found) posts.push(toFound(p));
  }
  return { edition, queries, match: matchEdition(edition, posts) };
}

function toFound(p: Post): FoundPost {
  return { id: p.id, title: p.title, createdAt: p.createdAt.toISOString(), permalink: p.permalink, author: p.authorName, body: p.body };
}

/** Posts by id, for the threads the second pass found without their text (at most 50 per call). */
async function routePosts(req: PostsReq): Promise<PostsRsp | ErrorRsp> {
  const ids = (req.ids ?? []).filter((id) => /^t3_[a-z0-9]+$/i.test(id)).slice(0, 50);
  const posts: FoundPost[] = [];
  for (const id of ids) posts.push(toFound(await reddit.getPostById(id as `t3_${string}`)));
  return { posts };
}

async function routeMenuNewPost(): Promise<UiResponse> {
  const post = await reddit.submitCustomPost({ title: "KinderkopjeDB thread finder", entry: "default" });
  return {
    showToast: { text: `Post ${post.id} created.`, appearance: "success" },
    navigateTo: post.url,
  };
}

async function readJson<T>(reqMsg: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  reqMsg.on("data", (chunk) => chunks.push(chunk));
  await once(reqMsg, "end");
  return JSON.parse(`${Buffer.concat(chunks)}`);
}

function writeJson<T extends PartialJsonValue>(status: number, json: Readonly<T>, rsp: ServerResponse): void {
  const body = JSON.stringify(json);
  rsp.writeHead(status, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json",
  });
  rsp.end(body);
}
