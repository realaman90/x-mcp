#!/usr/bin/env node

/**
 * One-time OAuth 1.0a setup for x-mcp.
 *
 * Run this when a new user wants to connect their X account to your app.
 * It opens a browser, user clicks "Authorize", and you get their Access Token/Secret.
 *
 * Prerequisites:
 *   - X_API_KEY and X_API_SECRET env vars set (app's Consumer Key/Secret)
 *   - App callback URL set to http://localhost:3456/callback in X Developer Portal
 *
 * Usage:
 *   X_API_KEY=... X_API_SECRET=... node setup.js
 */

import { createHmac, randomBytes } from "crypto";
import { createServer } from "http";

const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const BEARER_TOKEN = process.env.X_BEARER_TOKEN;

if (!API_KEY || !API_SECRET) {
  console.error("\n  Missing env vars. Run with:\n");
  console.error("  X_BEARER_TOKEN=... X_API_KEY=... X_API_SECRET=... node setup.js\n");
  console.error("  (X_BEARER_TOKEN is optional here but needed for the MCP server)\n");
  process.exit(1);
}

const CALLBACK_URL = "http://localhost:3456/callback";

// ─── OAuth 1.0a helpers ────────────────────────────────────────────────────────

function enc(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function sign(method, url, params, tokenSecret = "") {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString("hex");

  const oauthParams = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: ts,
    oauth_version: "1.0",
    ...params,
  };

  const all = { ...oauthParams };
  const paramStr = Object.keys(all).sort().map(k => `${enc(k)}=${enc(all[k])}`).join("&");
  const baseStr = `${method}&${enc(url)}&${enc(paramStr)}`;
  const signingKey = `${enc(API_SECRET)}&${enc(tokenSecret)}`;
  const sig = createHmac("sha1", signingKey).update(baseStr).digest("base64");

  oauthParams.oauth_signature = sig;
  return "OAuth " + Object.keys(oauthParams).sort().map(k => `${enc(k)}="${enc(oauthParams[k])}"`).join(", ");
}

// ─── Step 1: Get request token ─────────────────────────────────────────────────

console.log("\n  🔑 x-mcp OAuth Setup\n");
console.log("  Step 1/3: Requesting temporary token...");

const reqTokenUrl = "https://api.x.com/oauth/request_token";
const reqTokenAuth = sign("POST", reqTokenUrl, { oauth_callback: CALLBACK_URL });

const reqTokenRes = await fetch(reqTokenUrl, {
  method: "POST",
  headers: { Authorization: reqTokenAuth },
});

if (!reqTokenRes.ok) {
  const body = await reqTokenRes.text();
  console.error(`\n  ❌ Failed to get request token: ${reqTokenRes.status}\n  ${body}`);
  console.error("\n  Make sure your callback URL is set to http://localhost:3456/callback in X Developer Portal");
  process.exit(1);
}

const reqTokenBody = await reqTokenRes.text();
const reqTokenParams = new URLSearchParams(reqTokenBody);
const oauthToken = reqTokenParams.get("oauth_token");
const oauthTokenSecret = reqTokenParams.get("oauth_token_secret");

// ─── Step 2: User authorizes in browser ────────────────────────────────────────

const authorizeUrl = `https://api.x.com/oauth/authorize?oauth_token=${oauthToken}`;

console.log("  Step 2/3: Opening browser for authorization...\n");
console.log(`  If browser doesn't open, visit:\n  ${authorizeUrl}\n`);

// Open browser cross-platform
const { exec } = await import("child_process");
const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
exec(`${openCmd} "${authorizeUrl}"`);

// ─── Step 3: Wait for callback, exchange for access token ──────────────────────

const verifier = await new Promise((resolve, reject) => {
  const srv = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost:3456");
    if (url.pathname === "/callback") {
      const v = url.searchParams.get("oauth_verifier");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="background:#000;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h1>✅ Authorized!</h1>
            <p>You can close this tab and return to your terminal.</p>
          </div>
        </body></html>
      `);
      srv.close();
      resolve(v);
    }
  });
  srv.listen(3456, () => {
    console.log("  Waiting for authorization (listening on port 3456)...\n");
  });
  srv.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.error("  ❌ Port 3456 is in use. Close whatever is using it and try again.");
      process.exit(1);
    }
    reject(e);
  });
  // Timeout after 5 minutes
  setTimeout(() => { srv.close(); reject(new Error("Timeout — no authorization received after 5 minutes")); }, 300000);
});

console.log("  Step 3/3: Exchanging for access token...");

const accessTokenUrl = "https://api.x.com/oauth/access_token";
const accessAuth = sign("POST", accessTokenUrl, {
  oauth_token: oauthToken,
  oauth_verifier: verifier,
}, oauthTokenSecret);

const accessRes = await fetch(accessTokenUrl, {
  method: "POST",
  headers: { Authorization: accessAuth },
});

if (!accessRes.ok) {
  const body = await accessRes.text();
  console.error(`\n  ❌ Failed to get access token: ${accessRes.status}\n  ${body}`);
  process.exit(1);
}

const accessBody = await accessRes.text();
const accessParams = new URLSearchParams(accessBody);
const accessToken = accessParams.get("oauth_token");
const accessTokenSecret = accessParams.get("oauth_token_secret");
const screenName = accessParams.get("screen_name");
const userId = accessParams.get("user_id");

console.log(`\n  ✅ Success! Authorized as @${screenName} (ID: ${userId})\n`);
console.log("  ─────────────────────────────────────────────────");
console.log("  Add these to your Claude config env:\n");
console.log(`  X_BEARER_TOKEN=${BEARER_TOKEN || "<ask your app owner for this>"}`);
console.log(`  X_API_KEY=${API_KEY}`);
console.log(`  X_API_SECRET=${API_SECRET}`);
console.log(`  X_ACCESS_TOKEN=${accessToken}`);
console.log(`  X_ACCESS_TOKEN_SECRET=${accessTokenSecret}`);
if (!BEARER_TOKEN) {
  console.log("\n  ⚠️  X_BEARER_TOKEN was not provided. Ask your app owner for it.");
}
console.log("\n  ─────────────────────────────────────────────────");
console.log("  These tokens don't expire. Store them securely.\n");
