# x-mcp

[![npm version](https://img.shields.io/npm/v/@realaman90/x-mcp)](https://www.npmjs.com/package/@realaman90/x-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

MCP server for X/Twitter API — give Claude (or any MCP client) the ability to search, read, post, like, retweet, follow, bookmark, and more.

**27 tools total**: 8 read-only (Bearer token) + 19 write/advanced-read (OAuth 1.0a).

## Why

- Search and analyze tweets without leaving your AI workflow
- Post, reply, quote-tweet, and run polls directly from Claude
- Like, retweet, follow, bookmark, block, mute — all from your terminal
- Works with Claude Code, Claude Desktop, Codex, or any MCP client
- OAuth credentials optional — runs read-only with just a Bearer token

## Tools

### Always available (Bearer token only) — 8 tools

| Tool | Description |
|------|-------------|
| `search_tweets` | Search recent tweets (last 7 days) with full query operators |
| `get_user_profile` | Get user profile by username (bio, followers, etc.) |
| `get_user_tweets` | Get a user's recent tweets by user ID |
| `get_tweet_replies` | Get replies to a specific tweet |
| `get_tweet` | Get a single tweet with full details and metrics |
| `get_user_followers` | Get a user's followers |
| `get_user_following` | Get who a user is following |
| `get_liking_users` | Get users who liked a tweet |

### Requires OAuth 1.0a — 19 tools (auto-registered when credentials present)

| Tool | Description |
|------|-------------|
| `get_my_profile` | Get your own profile |
| `get_user_mentions` | Get tweets mentioning a user |
| `get_quote_tweets` | Get quote tweets of a tweet |
| `get_bookmarks` | Get your bookmarked tweets |
| `get_trending_topics` | Get trending topics by location |
| `create_post` | Post a tweet (text, reply, quote, poll) |
| `delete_post` | Delete your own tweet |
| `like_post` / `unlike_post` | Like or unlike a tweet |
| `repost` / `unrepost` | Retweet or undo retweet |
| `follow_user` / `unfollow_user` | Follow or unfollow a user |
| `bookmark_post` / `unbookmark_post` | Bookmark or remove bookmark |
| `block_user` / `unblock_user` | Block or unblock a user |
| `mute_user` / `unmute_user` | Mute or unmute a user |

## Quick Start

### 1. Get X API credentials

1. Go to [developer.x.com](https://developer.x.com) → **Developer Portal** → **Projects & Apps**
2. Create a **Project** and an **App** inside it
3. Go to **Keys and Tokens**:
   - Copy the **Bearer Token** (required)
   - Copy the **API Key** and **API Secret** (for write access)
   - Generate and copy the **Access Token** and **Access Token Secret** (for write access)

> **Read-only mode**: Only the Bearer Token is required. The 8 read tools work without OAuth.

### 2. Add to Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "x": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@realaman90/x-mcp"],
      "env": {
        "X_BEARER_TOKEN": "your-bearer-token",
        "X_API_KEY": "your-api-key",
        "X_API_SECRET": "your-api-secret",
        "X_ACCESS_TOKEN": "your-access-token",
        "X_ACCESS_TOKEN_SECRET": "your-access-token-secret"
      }
    }
  }
}
```

Or add to **Claude Desktop**: **Settings** → **Developer** → **Edit Config** → same block.

> Omit the `X_API_KEY`/`X_API_SECRET`/`X_ACCESS_TOKEN`/`X_ACCESS_TOKEN_SECRET` lines for read-only mode.

### 3. Restart Claude and test

```
Search X for "AI agents" in English, no retweets
```

```
Post a tweet: "Hello from Claude!"
```

## Team Setup (sharing your app with others)

If you want a colleague to use your X app but post from **their own account**:

### App owner (one-time)

1. In [X Developer Portal](https://developer.x.com) → your app → **Authentication Settings**:
   - App permissions: **Read and write**
   - Type of App: **Web App, Automated App or Bot**
   - Callback URL: `http://localhost:3456/callback`
2. Share your **API Key**, **API Secret**, and **Bearer Token** with your colleague

### Colleague (one-time)

```bash
npx @realaman90/x-mcp --setup
```

Or if running from source:

```bash
X_API_KEY=<app_api_key> X_API_SECRET=<app_api_secret> node setup.js
```

This will:
1. Open your browser to X's authorization page
2. You log in with **your** X account and click "Authorize"
3. Print your personal **Access Token** and **Access Token Secret**
4. Add those to your Claude config — done. Tokens never expire.

## Usage Examples

### Search tweets
```
"AI video" lang:en -is:retweet           # English tweets about AI video
from:elonmusk has:media                   # Elon's tweets with media
#buildinpublic -is:reply                  # Hashtag, original tweets only
```

### Post and engage
```
Post a tweet: "Shipping a new feature today 🚀"
Reply to tweet 1234567890 saying "Great thread!"
Like tweet 1234567890
Retweet the latest tweet from @username
```

### Chain tools
1. `get_user_profile` → get user ID from username
2. `get_user_tweets` → get their recent tweets
3. `like_post` → like a specific tweet
4. `create_post` → reply to it

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `X_BEARER_TOKEN` | Yes | Bearer token for read-only API access |
| `X_API_KEY` | For write | OAuth 1.0a consumer key (API Key) |
| `X_API_SECRET` | For write | OAuth 1.0a consumer secret (API Secret) |
| `X_ACCESS_TOKEN` | For write | OAuth 1.0a access token (per-user) |
| `X_ACCESS_TOKEN_SECRET` | For write | OAuth 1.0a access token secret (per-user) |

## Requirements

- **Node.js 18+** (for native `fetch`)
- **X API access** — [Get it here](https://developer.x.com)

## How It Works

Single-file MCP server (~430 lines). No build step, no config files, zero extra dependencies. Uses Node.js built-in `crypto` for OAuth signing.

```
Claude ↔ stdio ↔ x-mcp ↔ X API v1.1/v2
                    ↑
          Bearer (read) + OAuth 1.0a (write)
```

## Contributing

Contributions welcome! Feel free to open issues or submit PRs.

1. Fork the repo
2. Create your branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push and open a Pull Request

## Author

Built by [@amanrawatamg](https://x.com/amanrawatamg)

## License

MIT
