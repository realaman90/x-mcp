#!/usr/bin/env node

// ─── Setup mode (npx @realaman90/x-mcp --setup) ───────────────────────────────

if (process.argv.includes("--setup")) {
  const { fileURLToPath } = await import("url");
  const { dirname, join } = await import("path");
  const dir = dirname(fileURLToPath(import.meta.url));
  await import(join(dir, "setup.js"));
  process.exit(0);
}

import { createHmac, randomBytes } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Auth config ───────────────────────────────────────────────────────────────

const BEARER_TOKEN = decodeURIComponent(process.env.X_BEARER_TOKEN || "");
if (!BEARER_TOKEN) {
  console.error("X_BEARER_TOKEN environment variable is required");
  process.exit(1);
}

const OAUTH = {
  consumerKey: process.env.X_API_KEY || "",
  consumerSecret: process.env.X_API_SECRET || "",
  token: process.env.X_ACCESS_TOKEN || "",
  tokenSecret: process.env.X_ACCESS_TOKEN_SECRET || "",
};
const HAS_OAUTH = !!(OAUTH.consumerKey && OAUTH.consumerSecret && OAUTH.token && OAUTH.tokenSecret);

// ─── Shared constants ──────────────────────────────────────────────────────────

const TWEET_FIELDS = "created_at,public_metrics,author_id,conversation_id,in_reply_to_user_id,lang";
const USER_FIELDS = "created_at,description,public_metrics,profile_image_url,url,verified";

// ─── Bearer fetch (read-only, no user context) ────────────────────────────────

async function xapi(endpoint, params = {}) {
  const url = new URL(`https://api.x.com/2${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API ${res.status}: ${body}`);
  }
  return res.json();
}

// ─── OAuth 1.0a signing (HMAC-SHA1) ───────────────────────────────────────────

function enc(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function oauthSign(method, url, queryParams = {}) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString("hex");

  const oauthParams = {
    oauth_consumer_key: OAUTH.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: ts,
    oauth_token: OAUTH.token,
    oauth_version: "1.0",
  };

  // Combine oauth params + query params, sort, encode
  const all = { ...oauthParams, ...queryParams };
  const paramStr = Object.keys(all)
    .sort()
    .map(k => `${enc(k)}=${enc(all[k])}`)
    .join("&");

  const baseStr = `${method.toUpperCase()}&${enc(url)}&${enc(paramStr)}`;
  const signingKey = `${enc(OAUTH.consumerSecret)}&${enc(OAUTH.tokenSecret)}`;
  const sig = createHmac("sha1", signingKey).update(baseStr).digest("base64");

  oauthParams.oauth_signature = sig;
  const header = "OAuth " + Object.keys(oauthParams)
    .sort()
    .map(k => `${enc(k)}="${enc(oauthParams[k])}"`)
    .join(", ");

  return header;
}

async function xapiAuth(method, endpoint, body) {
  const isV1 = endpoint.startsWith("/1.1/");
  const base = isV1 ? "https://api.x.com" : "https://api.x.com/2";
  const fullUrl = `${base}${isV1 ? endpoint : endpoint}`;

  // Parse any query params from endpoint for signing
  const urlObj = new URL(fullUrl);
  const queryParams = {};
  for (const [k, v] of urlObj.searchParams) queryParams[k] = v;

  const authHeader = oauthSign(method, urlObj.origin + urlObj.pathname, queryParams);

  const opts = {
    method,
    headers: { Authorization: authHeader },
  };
  if (body && (method === "POST" || method === "PUT")) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(fullUrl, opts);
  // DELETE endpoints return 204 with empty body
  if (res.status === 204) return { success: true };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X API ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Cached authenticated user ID ──────────────────────────────────────────────

let _myUserId = null;
async function getMyUserId() {
  if (_myUserId) return _myUserId;
  const data = await xapiAuth("GET", "/users/me", null);
  _myUserId = data.data.id;
  return _myUserId;
}

// ─── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "x-mcp",
  version: "2.0.0",
});

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

// ═══════════════════════════════════════════════════════════════════════════════
// BEARER-ONLY TOOLS (always registered)
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Search tweets
server.tool(
  "search_tweets",
  "Search recent tweets by keywords, hashtags, or advanced operators. Returns up to 100 tweets from the last 7 days.",
  {
    query: z.string().describe("Search query (supports X search operators like lang:en, -is:retweet, from:username)"),
    max_results: z.number().min(10).max(100).default(10).describe("Number of results (10-100)"),
  },
  async ({ query, max_results }) => {
    const data = await xapi("/tweets/search/recent", {
      query, max_results,
      "tweet.fields": TWEET_FIELDS,
      expansions: "author_id",
      "user.fields": "username,name",
    });
    return ok(data);
  }
);

// 2. Get user profile
server.tool(
  "get_user_profile",
  "Get an X/Twitter user's profile by username. Returns bio, follower counts, and account details.",
  { username: z.string().describe("X username (without @)") },
  async ({ username }) => {
    const data = await xapi(`/users/by/username/${username}`, { "user.fields": USER_FIELDS });
    return ok(data);
  }
);

// 3. Get user's tweets
server.tool(
  "get_user_tweets",
  "Get recent tweets from a specific user by their user ID. Use get_user_profile first to get the ID from a username.",
  {
    user_id: z.string().describe("X user ID (numeric string — get this from get_user_profile)"),
    max_results: z.number().min(5).max(100).default(10).describe("Number of results (5-100)"),
  },
  async ({ user_id, max_results }) => {
    const data = await xapi(`/users/${user_id}/tweets`, {
      max_results,
      "tweet.fields": TWEET_FIELDS,
    });
    return ok(data);
  }
);

// 4. Get tweet replies
server.tool(
  "get_tweet_replies",
  "Get replies to a specific tweet using its conversation ID. Returns recent replies from the last 7 days.",
  {
    tweet_id: z.string().describe("Tweet ID to find replies for (used as conversation_id)"),
    max_results: z.number().min(10).max(100).default(10).describe("Number of results (10-100)"),
  },
  async ({ tweet_id, max_results }) => {
    const data = await xapi("/tweets/search/recent", {
      query: `conversation_id:${tweet_id}`,
      max_results,
      "tweet.fields": TWEET_FIELDS,
      expansions: "author_id",
      "user.fields": "username,name",
    });
    return ok(data);
  }
);

// 5. Get single tweet
server.tool(
  "get_tweet",
  "Get a single tweet by ID with full details including metrics, author info, and conversation context.",
  { tweet_id: z.string().describe("Tweet ID") },
  async ({ tweet_id }) => {
    const data = await xapi(`/tweets/${tweet_id}`, {
      "tweet.fields": TWEET_FIELDS,
      expansions: "author_id",
      "user.fields": "username,name",
    });
    return ok(data);
  }
);

// 6. Get user's followers
server.tool(
  "get_user_followers",
  "Get a list of users who follow the specified user. Use get_user_profile first to get the user ID.",
  {
    user_id: z.string().describe("X user ID (numeric string)"),
    max_results: z.number().min(1).max(1000).default(100).describe("Number of results (1-1000)"),
  },
  async ({ user_id, max_results }) => {
    const data = await xapi(`/users/${user_id}/followers`, {
      max_results,
      "user.fields": USER_FIELDS,
    });
    return ok(data);
  }
);

// 7. Get user's following
server.tool(
  "get_user_following",
  "Get a list of users the specified user is following. Use get_user_profile first to get the user ID.",
  {
    user_id: z.string().describe("X user ID (numeric string)"),
    max_results: z.number().min(1).max(1000).default(100).describe("Number of results (1-1000)"),
  },
  async ({ user_id, max_results }) => {
    const data = await xapi(`/users/${user_id}/following`, {
      max_results,
      "user.fields": USER_FIELDS,
    });
    return ok(data);
  }
);

// 8. Get users who liked a tweet
server.tool(
  "get_liking_users",
  "Get a list of users who liked a specific tweet.",
  {
    tweet_id: z.string().describe("Tweet ID"),
    max_results: z.number().min(1).max(100).default(100).describe("Number of results (1-100)"),
  },
  async ({ tweet_id, max_results }) => {
    const data = await xapi(`/tweets/${tweet_id}/liking_users`, {
      max_results,
      "user.fields": USER_FIELDS,
    });
    return ok(data);
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// OAUTH TOOLS (only registered when OAuth credentials are present)
// ═══════════════════════════════════════════════════════════════════════════════

if (HAS_OAUTH) {

  // ─── OAuth Read Tools ──────────────────────────────────────────────────────

  // 9. Get my profile
  server.tool(
    "get_my_profile",
    "Get the authenticated user's own profile. Requires OAuth — returns your user ID, bio, metrics, etc.",
    {},
    async () => {
      const data = await xapiAuth("GET", "/users/me?user.fields=" + encodeURIComponent(USER_FIELDS), null);
      return ok(data);
    }
  );

  // 10. Get user mentions
  server.tool(
    "get_user_mentions",
    "Get recent tweets mentioning a specific user. Requires OAuth for user-context access.",
    {
      user_id: z.string().describe("X user ID (numeric string)"),
      max_results: z.number().min(5).max(100).default(10).describe("Number of results (5-100)"),
    },
    async ({ user_id, max_results }) => {
      const data = await xapiAuth("GET",
        `/users/${user_id}/mentions?max_results=${max_results}&tweet.fields=${encodeURIComponent(TWEET_FIELDS)}&expansions=author_id&user.fields=${encodeURIComponent("username,name")}`,
        null
      );
      return ok(data);
    }
  );

  // 11. Get quote tweets
  server.tool(
    "get_quote_tweets",
    "Get tweets that quote a specific tweet. Requires OAuth for user-context access.",
    {
      tweet_id: z.string().describe("Tweet ID"),
      max_results: z.number().min(10).max(100).default(10).describe("Number of results (10-100)"),
    },
    async ({ tweet_id, max_results }) => {
      const data = await xapiAuth("GET",
        `/tweets/${tweet_id}/quote_tweets?max_results=${max_results}&tweet.fields=${encodeURIComponent(TWEET_FIELDS)}&expansions=author_id&user.fields=${encodeURIComponent("username,name")}`,
        null
      );
      return ok(data);
    }
  );

  // 12. Get bookmarks
  server.tool(
    "get_bookmarks",
    "Get the authenticated user's bookmarked tweets. Bearer token is explicitly forbidden for this endpoint.",
    {
      max_results: z.number().min(1).max(100).default(20).describe("Number of results (1-100)"),
    },
    async ({ max_results }) => {
      const myId = await getMyUserId();
      const data = await xapiAuth("GET",
        `/users/${myId}/bookmarks?max_results=${max_results}&tweet.fields=${encodeURIComponent(TWEET_FIELDS)}&expansions=author_id&user.fields=${encodeURIComponent("username,name")}`,
        null
      );
      return ok(data);
    }
  );

  // 13. Get trending topics
  server.tool(
    "get_trending_topics",
    "Get current trending topics for a location. Uses v1.1 API. Default WOEID 1 = worldwide, 23424977 = US.",
    {
      woeid: z.number().default(1).describe("Where On Earth ID (1=worldwide, 23424977=US, 23424975=UK)"),
    },
    async ({ woeid }) => {
      const data = await xapiAuth("GET", `/1.1/trends/place.json?id=${woeid}`, null);
      return ok(data);
    }
  );

  // ─── OAuth Write Tools ─────────────────────────────────────────────────────

  // 14. Create post (most complex write tool)
  server.tool(
    "create_post",
    "Create a new tweet/post on X. Supports text, replies, quote tweets, and polls. Max 280 characters for text.",
    {
      text: z.string().max(280).describe("Tweet text (max 280 characters)"),
      reply_to: z.string().optional().describe("Tweet ID to reply to (makes this a reply)"),
      quote_tweet_id: z.string().optional().describe("Tweet ID to quote (makes this a quote tweet)"),
      poll_options: z.array(z.string()).min(2).max(4).optional().describe("Poll options (2-4 choices). Creates a poll attached to the tweet."),
      poll_duration_minutes: z.number().min(5).max(10080).optional().describe("Poll duration in minutes (5-10080, default 1440 = 24h). Only used with poll_options."),
    },
    async ({ text, reply_to, quote_tweet_id, poll_options, poll_duration_minutes }) => {
      const body = { text };
      if (reply_to) body.reply = { in_reply_to_tweet_id: reply_to };
      if (quote_tweet_id) body.quote_tweet_id = quote_tweet_id;
      if (poll_options) {
        body.poll = {
          options: poll_options,
          duration_minutes: poll_duration_minutes || 1440,
        };
      }
      const data = await xapiAuth("POST", "/tweets", body);
      return ok(data);
    }
  );

  // 15. Delete post
  server.tool(
    "delete_post",
    "Delete one of your own tweets by ID. This action is irreversible.",
    { tweet_id: z.string().describe("Tweet ID to delete (must be your own tweet)") },
    async ({ tweet_id }) => {
      const data = await xapiAuth("DELETE", `/tweets/${tweet_id}`, null);
      return ok(data);
    }
  );

  // 16-27. Toggle tools (like/unlike, repost/unrepost, etc.)
  const toggleTools = [
    ["like_post",       "Like a tweet",                         "POST",   (me) => `/users/${me}/likes`,                "tweet_id", (id) => ({ tweet_id: id })],
    ["unlike_post",     "Unlike a previously liked tweet",      "DELETE", (me) => `/users/${me}/likes/${"{id}"}`,      "tweet_id", null],
    ["repost",          "Repost (retweet) a tweet",             "POST",   (me) => `/users/${me}/retweets`,             "tweet_id", (id) => ({ tweet_id: id })],
    ["unrepost",        "Undo a repost (unretweet)",            "DELETE", (me) => `/users/${me}/retweets/${"{id}"}`,   "tweet_id", null],
    ["follow_user",     "Follow a user",                        "POST",   (me) => `/users/${me}/following`,            "target_user_id", (id) => ({ target_user_id: id })],
    ["unfollow_user",   "Unfollow a user",                      "DELETE", (me) => `/users/${me}/following/${"{id}"}`,  "target_user_id", null],
    ["bookmark_post",   "Bookmark a tweet",                     "POST",   (me) => `/users/${me}/bookmarks`,            "tweet_id", (id) => ({ tweet_id: id })],
    ["unbookmark_post", "Remove a tweet from bookmarks",        "DELETE", (me) => `/users/${me}/bookmarks/${"{id}"}`,  "tweet_id", null],
    ["block_user",      "Block a user",                         "POST",   (me) => `/users/${me}/blocking`,             "target_user_id", (id) => ({ target_user_id: id })],
    ["unblock_user",    "Unblock a user",                       "DELETE", (me) => `/users/${me}/blocking/${"{id}"}`,   "target_user_id", null],
    ["mute_user",       "Mute a user",                          "POST",   (me) => `/users/${me}/muting`,              "target_user_id", (id) => ({ target_user_id: id })],
    ["unmute_user",     "Unmute a user",                        "DELETE", (me) => `/users/${me}/muting/${"{id}"}`,     "target_user_id", null],
  ];

  for (const [name, desc, method, pathFn, paramName, bodyFn] of toggleTools) {
    const paramDesc = paramName === "tweet_id" ? "Tweet ID" : "Target user ID (numeric string)";
    server.tool(
      name,
      desc,
      { [paramName]: z.string().describe(paramDesc) },
      async (input) => {
        const myId = await getMyUserId();
        const id = input[paramName];
        const path = pathFn(myId).replace("{id}", id);
        const body = bodyFn ? bodyFn(id) : null;
        const data = await xapiAuth(method, path, body);
        return ok(data);
      }
    );
  }
}

// ─── Start server ──────────────────────────────────────────────────────────────

if (!HAS_OAUTH) {
  console.error("OAuth credentials not found — running with 8 read-only tools (Bearer token only)");
  console.error("Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET for full 27-tool access");
}

const transport = new StdioServerTransport();
await server.connect(transport);
