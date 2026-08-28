# Moodle-MCP: Complete Technical Breakdown

This document describes every major system in the repository as implemented today, for architectural scrutiny by Poke AI or any other auditor.

---

## 1. System purpose and design constraints

### 1.1 What this project is

A **local MCP (Model Context Protocol) server** that exposes a **single persistent Chromium browser** to a remote AI agent (Poke) via HTTP. The browser is used to navigate a school's **Moodle** website without Moodle Web Services or API credentials.

### 1.2 What this project is not

| Not present | Confirmed |
|---|---|
| Embedded LLM / reasoning model | No OpenAI, Anthropic, or other AI calls anywhere |
| Autonomous browser agent | No planning, goal decomposition, or decision logic |
| Moodle API / Web Services integration | No `core_*` API wrappers |
| Moodle-specific MCP tools | No `get_assignments()`, `get_courses()`, etc. |
| SSO/MFA/CAPTCHA automation | Manual login only via `npm run setup` |
| Credential storage | No username/password in code, `.env`, or logs |
| Tunnel implementation | Poke tunnel is a separate external process |
| Multi-user server | Single local user, single browser profile |

### 1.3 Agent boundary

**Poke is the sole reasoning layer.** The MCP server is a deterministic executor of browser primitives. When a user asks "What assignments are due this week?", Poke must:

1. Call `browser_navigate`
2. Call `browser_read`
3. Reason about the returned structured text
4. Call `browser_click` / further navigations as needed
5. Synthesize an answer

The MCP never interprets user intent or selects tools autonomously.

---

## 2. End-to-end architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                         POKE (cloud)                            │
│              Reasoning agent — only AI in the stack             │
└────────────────────────────┬────────────────────────────────────┘
                             │ MCP JSON-RPC over HTTPS
                             │ (via Poke secure tunnel)
┌────────────────────────────▼────────────────────────────────────┐
│              npx poke tunnel http://127.0.0.1:3000/mcp          │
│              Separate process — not part of this repo           │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP to localhost
┌────────────────────────────▼────────────────────────────────────┐
│  HTTP MCP Server  (src/server/http.ts)                          │
│  Endpoint: http://127.0.0.1:3000/mcp                            │
│  Transport: MCP SDK Streamable HTTP (stateful sessions)         │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  MCP Tool Layer  (src/tools/index.ts)                           │
│  9 generic browser_* tools — Zod-validated inputs               │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  BrowserManager singleton  (src/browser/manager.ts)             │
│  Single Playwright persistent Chromium context                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Persistent Chromium profile  (./browser-profile by default)      │
│  cookies · localStorage · sessionStorage · IndexedDB            │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼────────────────────────────────────┐
│                     Moodle (school website)                       │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Runtime processes (production)

| Process | Command | Role |
|---|---|---|
| MCP HTTP server | `npm start` → `tsx src/index.ts` | Serves MCP on localhost:3000 |
| Poke tunnel | `npx poke@latest tunnel http://127.0.0.1:3000/mcp -n "Moodle"` | Bridges Poke cloud ↔ local MCP |
| Setup (one-time / re-auth) | `npm run setup` → `tsx src/setup.ts` | Headed Chromium for manual login |

These are **three independent processes**. The MCP server does not spawn or manage the tunnel.

---

## 3. Source code structure

```text
src/
├── index.ts              Entry point — starts HTTP MCP server
├── setup.ts              Manual login flow (headed Chromium)
├── config/
│   └── index.ts          Environment variable loading and resolution
├── server/
│   ├── index.ts          McpServer factory (registers tools)
│   └── http.ts           Streamable HTTP transport + Express app
├── tools/
│   └── index.ts          All 9 browser_* MCP tool registrations
└── browser/
    ├── manager.ts        Playwright lifecycle + tool execution
    ├── reader.ts         Page content extraction + element registry
    ├── session.ts        Moodle login/session expiry detection
    ├── errors.ts         Typed error codes
    └── logger.ts         Safe stderr logging

test/
├── browser-layer.test.ts Playwright integration tests (local HTML fixture)
├── http-mcp.test.ts      MCP client connects and lists tools
└── fixtures/
    └── moodle-test.html  Moodle-like test page
```

**Language/runtime:** TypeScript on Node.js 18+, ESM modules (`"type": "module"`).

**Key dependencies:**

| Package | Version | Role |
|---|---|---|
| `@modelcontextprotocol/sdk` | ^1.30.0 | MCP server, Streamable HTTP transport, client (tests) |
| `playwright` | ^1.57.0 | Chromium automation |
| `zod` | ^4.4.3 | Tool input schema validation |
| `dotenv` | ^17.2.3 | `.env` file loading |
| `tsx` | dev | Direct TypeScript execution (no build step required to run) |

Express is used **indirectly** via the MCP SDK's `createMcpExpressApp()`. It is a transitive dependency of `@modelcontextprotocol/sdk`, not a direct project dependency.

---

## 4. Configuration system

**File:** `src/config/index.ts`

Loaded once at module import via `dotenv.config()`. All values are read from `process.env` with documented defaults.

| Variable | Default | Purpose |
|---|---|---|
| `MOODLE_URL` | `""` (empty) | Base URL for relative navigation and setup |
| `MOODLE_BROWSER_PROFILE` | `./browser-profile` | Playwright persistent profile directory |
| `MOODLE_DOWNLOAD_DIR` | `./downloads` | File download destination |
| `MOODLE_BROWSER_HEADLESS` | `true` | Headless Chromium during MCP operation |
| `MOODLE_BROWSER_TIMEOUT` | `30000` | Playwright default timeout (ms) |
| `MOODLE_MAX_TEXT_LENGTH` | `8000` | Max chars in `browser_read` TEXT section |
| `MOODLE_LOGIN_URL_PATTERNS` | `/login/index.php,/login/` | URL fragments indicating login pages |
| `MOODLE_MCP_DEBUG` / `DEBUG` | `false` | Enable sanitized debug logging |
| `MCP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_PORT` | `3000` | HTTP bind port |

**Hardcoded (not configurable):**

- `mcpPath`: `/mcp`
- `serverName`: `moodle-browser-mcp`
- `serverVersion`: `1.0.0`

**Path resolution:** Relative paths in env vars are resolved against `process.cwd()`. Absolute paths are used as-is.

**Not stored in config:** passwords, tokens, API keys, cookies, or any authentication secrets.

---

## 5. HTTP MCP transport layer

**File:** `src/server/http.ts`

### 5.1 Protocol

Uses the official MCP SDK **Streamable HTTP** transport (`StreamableHTTPServerTransport`), not a custom protocol. This is the current MCP-spec transport that supports:

- JSON-RPC over HTTP POST
- SSE streaming over HTTP GET (for server-initiated messages)
- Session management via `mcp-session-id` header
- Session termination via HTTP DELETE

### 5.2 HTTP server setup

```typescript
const app = createMcpExpressApp({ host });
```

`createMcpExpressApp` (from MCP SDK) provides:

- `express.json()` body parser
- DNS rebinding protection middleware when host is `127.0.0.1`, `localhost`, or `::1`

The server binds with:

```typescript
app.listen(requestedPort, host)
```

Default: `127.0.0.1:3000`.

### 5.3 Routes

| Method | Path | Handler |
|---|---|---|
| `POST` | `/mcp` | JSON-RPC requests (initialize, tools/call, etc.) |
| `GET` | `/mcp` | SSE stream for active session |
| `DELETE` | `/mcp` | Session termination |

No other HTTP endpoints exist. No health check, no static files, no admin UI.

### 5.4 Session model (stateful)

The server maintains an in-memory map:

```typescript
const transports: Record<string, StreamableTransport> = {};
```

**New session flow (POST without `mcp-session-id`):**

1. Request body is checked with `isInitializeRequest(req.body)` from MCP SDK
2. If valid initialize: create `StreamableHTTPServerTransport` with `sessionIdGenerator: () => randomUUID()`
3. Create a new `McpServer` instance via `createServer()` and `server.connect(transport)`
4. Handle the request; SDK returns session ID in response headers
5. `onsessioninitialized` callback stores transport in the map

**Existing session flow (POST with `mcp-session-id`):**

1. Look up transport in map
2. Delegate to `transport.handleRequest(req, res, req.body)`

**Invalid request (no session ID, not initialize):**

Returns HTTP 400 with JSON-RPC error code `-32000`.

### 5.5 Important architectural properties

| Property | Behavior |
|---|---|
| MCP sessions | One `McpServer` instance per MCP session |
| Browser state | **Shared** across all MCP sessions via `browserManager` singleton |
| Session isolation | MCP protocol state is per-session; browser is global |
| Persistence | Sessions are in-memory only; lost on server restart |
| Auth on HTTP | None — no API keys, no bearer tokens, no OAuth |

### 5.6 Shutdown

On `httpServer.close()`:

1. Close all active MCP transports
2. Close the Node HTTP server
3. Close the Playwright browser via `browserManager.close()`

Triggered by `SIGINT`/`SIGTERM` in `src/index.ts`.

---

## 6. MCP server and tool layer

### 6.1 Server factory

**File:** `src/server/index.ts`

```typescript
export function createServer(): McpServer {
  const server = new McpServer({
    name: "moodle-browser-mcp",
    version: "1.0.0",
  });
  registerBrowserTools(server);
  return server;
}
```

Each MCP session gets its own `McpServer` instance, but all instances register the same tools against the same `browserManager` singleton.

### 6.2 Tool registration

**File:** `src/tools/index.ts`

All tools use `server.registerTool(name, { description, inputSchema }, handler)`.

Input validation is performed by the MCP SDK using Zod schemas **before** the handler runs.

### 6.3 Tool response envelope

Every tool returns MCP content blocks:

```typescript
{ content: [{ type: "text", text: "..." }] }
```

`browser_screenshot` additionally returns:

```typescript
{ content: [
    { type: "text", text: "Screenshot captured ..." },
    { type: "image", data: "<base64>", mimeType: "image/png" }
]}
```

### 6.4 Error handling in tools

Errors are **not thrown to the MCP layer** as exceptions. They are caught and returned as text content:

```text
SESSION_EXPIRED: Moodle session has expired. Please run...
ELEMENT_NOT_FOUND: Could not find the requested element...
NAVIGATION_FAILED: Could not navigate to the requested Moodle page...
```

This means Poke always receives a successful tool call with an error message in the content, unless the MCP transport itself fails.

Wrapper function `runTool()` handles this uniformly.

---

## 7. Complete tool catalog

### 7.1 `browser_navigate`

| | |
|---|---|
| **Input** | `url: string`, `wait_until?: "load" \| "domcontentloaded" \| "networkidle"` |
| **URL resolution** | Absolute URLs used as-is. Relative paths resolved against `MOODLE_URL` via `new URL(url, config.moodleUrl)`. Fails with `INVALID_ARGUMENT` if relative and `MOODLE_URL` unset. |
| **Browser action** | `page.goto(url, { waitUntil, timeout })` |
| **Side effects** | Clears element registry. Checks session auth after navigation. |
| **Success response** | `"Navigated to <current-url>"` |
| **Failure codes** | `NAVIGATION_FAILED`, `SESSION_EXPIRED`, `INVALID_ARGUMENT` |

### 7.2 `browser_read`

| | |
|---|---|
| **Input** | None |
| **Browser action** | Extracts structured page snapshot (see Section 8) |
| **Side effects** | Rebuilds and stores element registry (numbered refs → Playwright Locators) |
| **Success response** | Multi-section text block (PAGE, URL, HEADINGS, LINKS, BUTTONS, INPUTS, IFRAMES, TEXT) |
| **Failure codes** | `SESSION_EXPIRED` |

### 7.3 `browser_click`

| | |
|---|---|
| **Input** | `ref: number` (positive integer from `browser_read`) |
| **Browser action** | Looks up `ElementEntry` in registry, scrolls into view, clicks |
| **Popup handling** | Waits up to 3s for popup event; if popup opens, switches active page to popup |
| **Side effects** | Clears element registry after click |
| **Success response** | `"Clicked [N] <label>. Current URL: <url>"` |
| **Failure codes** | `ELEMENT_NOT_FOUND`, `SESSION_EXPIRED` |

### 7.4 `browser_type`

| | |
|---|---|
| **Input** | `ref: number`, `text: string`, `clear?: boolean` |
| **Browser action** | `locator.fill(text)` if `clear=true`, else `locator.pressSequentially(text)` |
| **Side effects** | None on registry |
| **Success response** | `"Typed into [N] <label>"` |
| **Failure codes** | `ELEMENT_NOT_FOUND`, `SESSION_EXPIRED` |

### 7.5 `browser_press`

| | |
|---|---|
| **Input** | `key: string` (Playwright key name) |
| **Browser action** | `page.keyboard.press(key)` |
| **Side effects** | Waits for `domcontentloaded` (ignores timeout) |
| **Success response** | `"Pressed <key>"` |

### 7.6 `browser_back`

| | |
|---|---|
| **Input** | None |
| **Browser action** | `page.goBack({ waitUntil: "domcontentloaded" })` |
| **Side effects** | Clears element registry |
| **Failure codes** | `NAVIGATION_FAILED` (no history), `SESSION_EXPIRED` |

### 7.7 `browser_wait`

| | |
|---|---|
| **Input** | `selector?: string`, `state?: "attached"\|"detached"\|"visible"\|"hidden"`, `timeout_ms?: number`, `network_idle?: boolean` |
| **Behavior** | If `network_idle`: `page.waitForLoadState("networkidle")`. If `selector`: `page.waitForSelector(...)`. If neither: sleeps `min(timeout, 5000)` ms. Multiple conditions can apply in one call. |
| **Failure** | Playwright timeout → `OPERATION_FAILED` |

### 7.8 `browser_screenshot`

| | |
|---|---|
| **Input** | `full_page?: boolean` |
| **Browser action** | `page.screenshot({ fullPage, type: "png" })` |
| **Response** | Text note + base64 PNG image content block |
| **Security note** | Screenshot may contain sensitive Moodle content visible to Poke |

### 7.9 `browser_download`

| | |
|---|---|
| **Input** | `ref?: number` OR `url?: string` (at least one required) |
| **Via ref** | Clicks element, waits for Playwright `download` event |
| **Via url** | `page.goto(url)` and waits for download event |
| **Save path** | `{downloadDir}/{timestamp}-{suggestedFilename}` |
| **Failure codes** | `ELEMENT_NOT_FOUND`, `DOWNLOAD_FAILED`, `INVALID_ARGUMENT` |

---

## 8. Page reading and element registry

**File:** `src/browser/reader.ts`

### 8.1 Design goal

Return **token-efficient, structured text** that Poke can reason about, plus **numbered element references** for subsequent `click`/`type`/`download` calls.

### 8.2 Extraction pipeline

```text
page.title() + page.url()
    ↓
collectHeadings()     → h1–h6 visible text (max 40)
    ↓
collectRoleElements() → getByRole("link"|"button"|"tab"|"menuitem")
    ↓
collectInputs()       → input, textarea, select (non-hidden, visible)
    ↓
collectIframes()      → iframe title + src (metadata only, no content read)
    ↓
collectVisibleText()  → body.innerText minus script/style/svg (truncated to maxTextLength)
    ↓
Assign refs 1, 2, 3…  → store Playwright Locator objects in memory
```

### 8.3 Locator strategy

Elements are found using **semantic Playwright locators**, not brittle CSS selectors:

- `page.getByRole("link", ...)`
- `page.getByRole("button", ...)`
- Associated `<label>` elements for inputs
- `aria-label`, `placeholder`, `name` attributes as fallbacks

### 8.4 Element registry lifecycle

```typescript
private elementRegistry = new Map<number, ElementEntry>();
```

| Event | Registry state |
|---|---|
| `browser_read` | Rebuilt entirely |
| `browser_navigate` | Cleared |
| `browser_click` | Cleared (page may have changed) |
| `browser_back` | Cleared |
| Server shutdown | Cleared |
| MCP session end | **Not cleared** (browser is shared across sessions) |

**Critical implication for Poke:** refs from a previous `browser_read` become invalid after navigate/click/back. Poke must call `browser_read` again to get fresh refs.

### 8.5 Output format example

```text
PAGE: Moodle Dashboard
URL: https://moodle.school.edu/my/

HEADINGS:
* My courses
* Timeline

LINKS:
[1] Chemistry → /course/view.php?id=123
[2] English → /course/view.php?id=456

BUTTONS:
[3] Calendar

INPUTS:
[4] Search courses (search) placeholder="Search courses"

IFRAMES:
[iframe 1] Activity player → /mod/h5pactivity/view.php?id=99

TEXT:
Welcome back, student. Chemistry worksheet due tomorrow...
```

### 8.6 Known limitations of page reading

| Limitation | Detail |
|---|---|
| iframe content | Not read — only iframe metadata listed |
| Shadow DOM | Not explicitly handled |
| Duplicate link text | May produce ambiguous locators (`.first()` used at click time) |
| Collapsed Moodle sections | Only visible content captured; Poke must click to expand |
| AJAX content | Not auto-waited during read; Poke should use `browser_wait` first |
| Max elements | 80 per group (LINKS, BUTTONS, INPUTS), 40 headings |
| Max text | 8000 chars (configurable) |

---

## 9. Browser manager (Playwright subsystem)

**File:** `src/browser/manager.ts`

### 9.1 Singleton

```typescript
export const browserManager = new BrowserManager();
```

One instance shared by all MCP sessions and all tool calls. This is intentional: Moodle session state must persist across sequential Poke tool calls.

### 9.2 Chromium launch

```typescript
chromium.launchPersistentContext(profilePath, {
  headless: config.headless,        // true during MCP, false during setup
  viewport: { width: 1366, height: 900 },
  acceptDownloads: true,
  downloadsPath: config.downloadDir,
  args: ["--disable-dev-shm-usage"],
});
```

**`launchPersistentContext`** is the key API. It stores all browser state (cookies, localStorage, etc.) in `MOODLE_BROWSER_PROFILE` directory on disk.

### 9.3 Page management

- Active page tracked in `this.page`
- On launch: uses first existing page or creates new one
- On popup click: switches `this.page` to the popup
- `context.on("page")` logs new pages in debug mode but does not auto-switch

### 9.4 Lazy initialization

Browser is **not** launched at server startup. First tool call triggers `ensureReady()` → `launch()`. This means `npm start` does not open Chromium until Poke calls a tool.

### 9.5 Concurrency model

**No locking or queueing.** If Poke sends concurrent tool calls (multiple parallel `tools/call`), they will interleave against the same `Page` object.

**Risk:** race conditions on the single browser page if Poke parallelizes tool calls. The system assumes **sequential** tool invocation, which Poke has confirmed it does.

---

## 10. Authentication and session management

### 10.1 Initial authentication (manual)

**File:** `src/setup.ts`

```text
npm run setup
  → BrowserManager({ headless: false })
  → launch persistent context
  → goto MOODLE_URL (if set)
  → user manually completes SSO/MFA in visible Chromium
  → user presses Enter in terminal
  → manager.close() — profile saved to disk
```

No credentials are read from stdin, `.env`, or any file. The user's interaction with the real browser is the only authentication mechanism.

### 10.2 Session persistence

Authentication state lives in the Playwright profile directory:

```text
browser-profile/
  ├── Default/
  │   ├── Cookies
  │   ├── Local Storage/
  │   ├── Session Storage/
  │   └── ... (Chromium user data)
```

This directory is gitignored. It contains session cookies equivalent to a logged-in browser.

### 10.3 Session expiry detection

**File:** `src/browser/session.ts`

Called via `assertAuthenticated(page)` before every browser operation.

**Two-condition check (both must be true to trigger `SESSION_EXPIRED`):**

1. **URL check:** current URL contains any pattern from `MOODLE_LOGIN_URL_PATTERNS` (default: `/login/index.php`, `/login/`)
2. **Page content check:** any of:
   - Page title contains "log in" or "login"
   - DOM contains `input[name="username"]`, `input#username`, `input[name="password"]`, etc.
   - A button with role/name matching `/log in/i` exists

**False positive risk:** A Moodle page at a `/login/`-like URL that is not actually a login form will not trigger expiry (both conditions required). A non-login page with username/password fields (e.g., a profile settings page) could theoretically false-positive if the URL also matches a login pattern.

**False negative risk:** Custom school SSO login pages with non-standard URLs and DOM structure may not be detected. The user would see login page content in `browser_read` but not get `SESSION_EXPIRED`.

### 10.4 What is not checked

- Cookie expiration timestamps
- HTTP 401/403 response codes (unless navigation fails)
- Moodle-specific session API endpoints
- Token refresh

---

## 11. Error system

**File:** `src/browser/errors.ts`

| Code | When raised | User-facing message pattern |
|---|---|---|
| `SESSION_EXPIRED` | Login page detected | "Moodle session has expired. Please run... `npm run setup`" |
| `ELEMENT_NOT_FOUND` | Invalid/stale ref, click/type failure | "Could not find the requested element..." |
| `NAVIGATION_FAILED` | `goto`/`goBack` failure, HTTP 4xx/5xx | "Could not navigate to the requested..." |
| `DOWNLOAD_FAILED` | Download event timeout or save failure | "Could not download the requested file." |
| `INVALID_ARGUMENT` | Missing `MOODLE_URL` for relative nav, missing download params | Descriptive message |
| `BROWSER_NOT_READY` | Defined but not currently thrown in code |
| `OPERATION_FAILED` | Catch-all for unexpected errors | Generic message |

Errors are returned as **text content in tool responses**, not as MCP protocol errors. Poke must parse the `CODE: message` prefix.

---

## 12. Logging system

**File:** `src/browser/logger.ts`

- All logs go to **stderr** (`console.error`), never stdout (stdout is unused; HTTP responses go through Express)
- `info()`: always logs (startup messages, Chromium launch)
- `debug()`: only when `MOODLE_MCP_DEBUG=true`
- Sensitive key names matching `/password|cookie|token|authorization|secret|session/i` are redacted to `[REDACTED]`
- String values in debug logs truncated to 500 chars

**What is never logged:**

- Passwords
- Cookie values
- Auth tokens
- Full page content (unless debug accidentally captures URLs)

**What is logged:**

- MCP session IDs (in debug mode)
- Navigation URLs
- Browser profile path
- Chromium launch parameters

---

## 13. Security model and threat surface

### 13.1 Trust boundaries

```text
[Poke cloud]  ←──HTTPS tunnel──→  [localhost:3000]  ←──→  [Chromium]  ←──→  [Moodle]
   untrusted         semi-trusted        trusted           external
```

### 13.2 Localhost binding

Default `MCP_HOST=127.0.0.1` means the MCP endpoint is **not reachable from other machines on the network**. Only processes on the same host (including the Poke tunnel) can connect.

DNS rebinding protection is enabled by the MCP SDK when binding to localhost.

### 13.3 No MCP authentication

The HTTP MCP endpoint has **no API key, no bearer token, no OAuth**. Any process on localhost that can reach port 3000 can:

- List all tools
- Navigate the logged-in browser anywhere
- Read any page the browser can access
- Click any element
- Type into any field
- Download files
- Take screenshots

**Mitigation:** localhost binding + user controls what runs on their machine. The Poke tunnel is the intended accessor.

### 13.4 Tunnel exposure

When the user runs `npx poke@latest tunnel http://127.0.0.1:3000/mcp`, the Poke tunnel service can forward MCP requests from Poke cloud to the local server. This exposes the **MCP endpoint only**, not the filesystem or shell.

**What Poke can do through the tunnel:** everything the 9 browser tools allow on the logged-in Moodle session.

**What Poke cannot do:** read arbitrary files, execute shell commands, access other localhost services (unless navigated to in the browser).

### 13.5 Browser action safety

The implementation is **read-oriented by design** but not enforced at the protocol level:

| Action | Available | Notes |
|---|---|---|
| Navigate / read | Yes | Primary use case |
| Click / type | Yes | Needed for search, navigation, expanding sections |
| Download | Yes | Saves to `downloads/` |
| Form submission | Possible | Poke could click submit buttons — not blocked |
| Assignment submission | Possible | Not blocked, but no dedicated tool for it |
| Delete / message / grade change | Possible | If Poke clicks the right buttons — not blocked |

There is **no action allowlist or blocklist** in the MCP. Safety relies on Poke's behavior and the user monitoring what Poke does.

### 13.6 Profile security

The `browser-profile/` directory contains active session cookies. It must be:

- Kept on the local machine
- Not committed to Git (enforced via `.gitignore`)
- Protected by OS filesystem permissions
- Treated as equivalent to a logged-in browser

### 13.7 Screenshot data

`browser_screenshot` returns base64 PNG to Poke over the tunnel. This may contain grades, personal information, or other sensitive Moodle content.

---

## 14. Deployment workflow (exact sequence)

### 14.1 First-time setup

```powershell
npm install                          # installs deps + playwright chromium (postinstall)
npx playwright install chromium      # explicit chromium install (recommended)
copy .env.example .env               # set MOODLE_URL
npm run setup                        # manual login, profile saved
```

### 14.2 Normal operation

**Terminal 1:**

```powershell
npm start
# → "Moodle MCP server running"
# → "MCP endpoint: http://127.0.0.1:3000/mcp"
# → Browser NOT launched yet (lazy)
```

**Terminal 2:**

```powershell
npx poke@latest tunnel http://127.0.0.1:3000/mcp -n "Moodle"
```

**First Poke tool call:**

```text
Poke → tunnel → POST /mcp (initialize) → new MCP session
Poke → tunnel → POST /mcp (tools/call browser_navigate) → Chromium launches → navigates
Poke → tunnel → POST /mcp (tools/call browser_read) → returns page content
... sequential tool calls ...
```

### 14.3 Session re-authentication

```powershell
# Stop npm start (Ctrl+C)
npm run setup    # log in again manually
npm start        # restart MCP
# restart poke tunnel
```

---

## 15. Test coverage

### 15.1 `test/browser-layer.test.ts`

Tests Playwright layer against a local HTTP server serving `moodle-test.html`:

| Test | Verifies |
|---|---|
| `testReadAndClick` | Page read format, ref extraction, click navigation |
| `testSessionExpiryDetection` | Login page detection on `/login/index.php` |
| `testTypeAndSearch` | Input ref resolution and typing |

Uses temporary browser profiles (not the real `browser-profile/`).

### 15.2 `test/http-mcp.test.ts`

| Test | Verifies |
|---|---|
| HTTP server starts on random port | `startMcpHttpServer({ port: 0 })` |
| MCP client connects via Streamable HTTP | `StreamableHTTPClientTransport` + `client.connect()` |
| All 9 tools registered | `tools/list` returns expected tool names |
| Endpoint path | URL ends with `/mcp` |

**Not tested:**

- Actual browser tool execution over HTTP MCP
- Poke tunnel integration
- Real Moodle interaction
- Concurrent tool calls
- Session expiry over HTTP
- Screenshot/download over HTTP
- Long-running sessions
- SSE GET stream behavior

---

## 16. Known limitations and gaps (for auditor attention)

| # | Limitation | Severity | Detail |
|---|---|---|---|
| 1 | No tool call serialization | Medium | Concurrent Poke calls can race on single Page |
| 2 | No MCP auth | Medium | Any localhost process can control the browser |
| 3 | No action restrictions | Medium | Poke can click submit/delete if it chooses to |
| 4 | iframe content unread | Low | Poke sees iframe metadata only |
| 5 | Stale refs after navigation | Low | By design; Poke must re-read |
| 6 | Session expiry heuristics | Medium | Custom SSO pages may not trigger `SESSION_EXPIRED` |
| 7 | Profile lock conflicts | Low | Running `setup` and `start` simultaneously will fail |
| 8 | Single browser tab | Low | Only one active page; popups are handled |
| 9 | In-memory MCP sessions | Low | Server restart drops MCP sessions (browser profile persists) |
| 10 | `BROWSER_NOT_READY` unused | Info | Error code defined but never thrown |
| 11 | No rate limiting | Low | Unlimited tool calls |
| 12 | Screenshot sensitivity | Medium | Visual data sent to Poke over tunnel |
| 13 | Download path disclosure | Low | Tool response includes full local file path |
| 14 | `browser_wait` fallback sleep | Info | Sleeps up to 5s if no selector/network_idle specified |

---

## 17. Explicit non-goals (verified absent from codebase)

Searched across all `src/` files — confirmed **not present**:

- `openai`, `anthropic`, `gemini`, `llm`, `gpt`, `claude` — no AI SDKs
- `fetch()` to Moodle API endpoints — no REST/WS API calls
- `get_assignments`, `get_courses`, or any Moodle-specific tool names
- Password reading from env or files (only `MOODLE_URL` and paths)
- CAPTCHA solving, SSO automation, MFA automation
- `child_process.exec`, shell commands
- File system access tools (read_file, write_file, etc.)
- Database, vector store, embeddings, RAG
- Stdio transport (removed; was in initial version, now HTTP only)

---

## 18. Dependency graph (module imports)

```text
src/index.ts
  └── src/server/http.ts
        ├── @modelcontextprotocol/sdk/server/express.js
        ├── @modelcontextprotocol/sdk/server/streamableHttp.js
        ├── @modelcontextprotocol/sdk/types.js
        ├── src/server/index.ts
        │     ├── @modelcontextprotocol/sdk/server/mcp.js
        │     └── src/tools/index.ts
        │           ├── src/browser/manager.ts  (singleton)
        │           │     ├── playwright
        │           │     ├── src/browser/reader.ts
        │           │     ├── src/browser/session.ts
        │           │     ├── src/browser/errors.ts
        │           │     └── src/browser/logger.ts
        │           └── src/config/index.ts
        └── src/browser/manager.ts (for shutdown)

src/setup.ts
  └── src/browser/manager.ts (separate instance, not singleton)
```

---

## 19. Summary for Poke AI self-check

When evaluating whether this MCP is safe and suitable to drive:

1. **You (Poke) are the agent.** This server provides 9 deterministic browser primitives. It will never plan, interpret, or decide on your behalf.

2. **Sequential tool calls are assumed.** The browser is a single shared Page with no locking.

3. **Re-read after navigation.** Element refs from `browser_read` are invalidated by `browser_navigate`, `browser_click`, and `browser_back`.

4. **Session state is in the local Chromium profile.** If you get `SESSION_EXPIRED`, the user must re-run `npm run setup` — you cannot log in programmatically.

5. **The tunnel exposes browser control, not filesystem/shell.** But within the browser, you have full interaction capability on the logged-in Moodle session.

6. **No Moodle API shortcuts exist.** Every piece of information must be obtained by navigating and reading the UI.

7. **Screenshots may contain sensitive data.** Use `browser_screenshot` judiciously.

8. **The MCP HTTP endpoint is unauthenticated on localhost.** This is by design for the Poke tunnel architecture.
