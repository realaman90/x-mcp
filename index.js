#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BEARER_TOKEN = decodeURIComponent(process.env.X_BEARER_TOKEN || "");
if (!BEARER_TOKEN) {
  console.error("X_BEARER_TOKEN environment variable is required");
  process.exit(1);
}

const TWEET_FIELDS = "created_at,public_metrics,author_id,conversation_id,in_reply_to_user_id,lang";
const USER_FIELDS = "created_at,description,public_metrics,profile_image_url,url,verified";

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

const server = new McpServer({
  name: "x-mcp",
  version: "1.0.0",
});

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
      query,
      max_results,
      "tweet.fields": TWEET_FIELDS,
      expansions: "author_id",
      "user.fields": "username,name",
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// 2. Get user profile
server.tool(
  "get_user_profile",
  "Get an X/Twitter user's profile by username. Returns bio, follower counts, and account details.",
  {
    username: z.string().describe("X username (without @)"),
  },
  async ({ username }) => {
    const data = await xapi(`/users/by/username/${username}`, {
      "user.fields": USER_FIELDS,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// 5. Get single tweet
server.tool(
  "get_tweet",
  "Get a single tweet by ID with full details including metrics, author info, and conversation context.",
  {
    tweet_id: z.string().describe("Tweet ID"),
  },
  async ({ tweet_id }) => {
    const data = await xapi(`/tweets/${tweet_id}`, {
      "tweet.fields": TWEET_FIELDS,
      expansions: "author_id",
      "user.fields": "username,name",
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
