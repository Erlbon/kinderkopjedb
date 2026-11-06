import type { Edition, EditionMatch, FoundPost } from "../../../../src/core/thread-match.ts";

/** An edition as the finder lists it (from editions.json, written by scripts/thread-editions.mjs). */
export type EditionEntry = Edition & { key: string };

export type ErrorRsp = { error: string; status: number };

export type EditionsRsp = { editions: EditionEntry[] };

/** Search one edition (by its place in the list) in one subreddit. */
export type SearchReq = { index: number; subreddit: string };
export type SearchRsp = {
  edition: EditionEntry;
  queries: { query: string; posts: number }[];
  match: EditionMatch;
};

/** Fetch posts by id (the second pass finds threads in other races' searches, without their text). */
export type PostsReq = { ids: string[] };
export type PostsRsp = { posts: FoundPost[] };

export const Endpoint = {
  Editions: "api/editions",
  Search: "api/search",
  Posts: "api/posts",
  OnMenuNewPost: "internal/on/menu/new-post",
} as const;
export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint];

export const EndpointMethod = {
  [Endpoint.Editions]: "GET",
  [Endpoint.Search]: "POST",
  [Endpoint.Posts]: "POST",
  [Endpoint.OnMenuNewPost]: "POST",
} as const satisfies { [endpoint: string]: "GET" | "POST" };
