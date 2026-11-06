import type { Edition, EditionMatch } from "../../../../src/core/thread-match.ts";

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

export const Endpoint = {
  Editions: "api/editions",
  Search: "api/search",
  OnMenuNewPost: "internal/on/menu/new-post",
} as const;
export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint];

export const EndpointMethod = {
  [Endpoint.Editions]: "GET",
  [Endpoint.Search]: "POST",
  [Endpoint.OnMenuNewPost]: "POST",
} as const satisfies { [endpoint: string]: "GET" | "POST" };
