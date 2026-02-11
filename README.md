# x-mcp

MCP server for X/Twitter API — give Claude (or any MCP client) the ability to search tweets, read profiles, get timelines, and read replies.

**Read-only. No posting, liking, or following. Safe to use with AI agents.**

## Why

- Find engagement opportunities on X without leaving Claude
- Study reply patterns and conversations around any topic
- Research accounts, their content, and audience reactions
- All read-only — no risk of accidental tweets or follows

## Tools

| Tool | Description | X API Endpoint |
|------|-------------|----------------|
| `search_tweets` | Search recent tweets (last 7 days) with full query operators | `GET /2/tweets/search/recent` |
| `get_user_profile` | Get user profile by username (bio, followers, etc.) | `GET /2/users/by/username/{username}` |
| `get_user_tweets` | Get a user's recent tweets by user ID | `GET /2/users/{id}/tweets` |
| `get_tweet_replies` | Get replies to a specific tweet | Search `conversation_id:{id}` |
| `get_tweet` | Get a single tweet with full details and metrics | `GET /2/tweets/{id}` |

## Quick Start

### 1. Get an X API Bearer Token

1. Go to [developer.x.com](https://developer.x.com) and sign in
2. Click **Developer Portal** → **Projects & Apps**
3. Create a new **Project** (any name)
4. Create an **App** inside the project
5. Go to **Keys and Tokens** → generate a **Bearer Token**
6. Copy the token — you'll need it in step 2

> The **Basic** tier ($200/mo pay-per-usage) is sufficient. Free tier works too but has lower rate limits.

### 2. Add to Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "x": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "x-mcp"],
      "env": {
        "X_BEARER_TOKEN": "your-bearer-token"
      }
    }
  }
}
```

### Or add to Claude Desktop

Open **Settings** → **Developer** → **Edit Config** and add the same block above.

### 3. Restart Claude and test

```
Search X for "AI agents" in English, no retweets
```

Claude will use the `search_tweets` tool automatically.

## Usage Examples

### Search tweets
```
"AI video" lang:en -is:retweet           # English tweets about AI video, no RTs
from:elonmusk has:media                   # Elon's tweets with media
#buildinpublic -is:reply                  # Hashtag, original tweets only
"machine learning" has:links min_faves:10 # ML tweets with links, 10+ likes
```

### Chain tools together
1. `get_user_profile` → get user ID from username
2. `get_user_tweets` → get their recent tweets
3. `get_tweet_replies` → see replies on a specific tweet

### Run directly (without Claude)
```bash
X_BEARER_TOKEN="your-token" npx x-mcp
```

## Requirements

- **Node.js 18+** (for native `fetch`)
- **X API Bearer Token** — [Get one here](https://developer.x.com)

## How It Works

Single-file MCP server (~120 lines). No build step, no config files. Reads `X_BEARER_TOKEN` from environment, connects via stdio.

```
Claude ↔ stdio ↔ x-mcp ↔ X API v2
```

## License

MIT
