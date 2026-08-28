# Moodle Browser MCP

A small **Model Context Protocol (MCP)** server that lets **Poke AI** explore your school's **Moodle** site through a real **Chromium** browser — without Moodle Web Services or API tokens.

```
Poke AI → MCP server → Playwright → Chromium → Moodle
```

Poke remains the only reasoning agent. This server exposes generic browser primitives (`browser_navigate`, `browser_read`, `browser_click`, …). It does **not** embed an LLM or make Moodle-specific decisions for you.

## Features

- Persistent Chromium profile (`MOODLE_BROWSER_PROFILE`) for cookies, `localStorage`, and session state
- Manual headed login setup (`npm run setup`) for SSO/MFA — no automation of security controls
- Token-efficient `browser_read` output with numbered element references
- Session expiry detection with a clear `SESSION_EXPIRED` error
- Generic browser tools suitable for dashboards, courses, assignments, announcements, and downloads
- Read-oriented by default (no assignment submission, messaging, or deletions)

## Requirements

- Node.js 18+
- npm

## Quick start

### 1. Install

```bash
git clone https://github.com/windshifter1/Moodle-MCP.git
cd Moodle-MCP
npm install
```

`npm install` also installs the Chromium browser via Playwright.

### 2. Configure environment

Copy the example env file and edit it:

```bash
cp .env.example .env
```

Important variables:

| Variable | Description |
| --- | --- |
| `MOODLE_URL` | Your school's Moodle base URL, e.g. `https://moodle.school.edu.au` |
| `MOODLE_BROWSER_PROFILE` | Directory for the persistent browser profile (default: `./browser-profile`) |
| `MOODLE_DOWNLOAD_DIR` | Where downloaded files are saved (default: `./downloads`) |
| `MOODLE_BROWSER_HEADLESS` | `true` for MCP server (default), `false` to show the browser while debugging |
| `MOODLE_LOGIN_URL_PATTERNS` | URL fragments that indicate a login page (default: `/login/index.php,/login/`) |
| `MOODLE_MCP_DEBUG` | Enable safe debug logs (`true` / `false`) |

### 3. Manual login setup

Run the setup command to open Chromium in **headed** mode using the persistent profile:

```bash
npm run setup
```

1. Complete your school login manually, including SSO and MFA.
2. When finished, return to the terminal and press **Enter**.
3. The profile is saved for later MCP sessions.

Do **not** attempt to automate or bypass SSO, MFA, CAPTCHA, or other security controls.

### 4. Start the MCP server

```bash
npm start
```

The server communicates over **stdio** (standard MCP transport).

## Configure in Poke

Add a custom MCP server in Poke's integration settings. Example configuration:

```json
{
  "mcpServers": {
    "moodle-browser": {
      "command": "npm",
      "args": ["start"],
      "cwd": "/absolute/path/to/Moodle-MCP",
      "env": {
        "MOODLE_URL": "https://moodle.school.edu.au",
        "MOODLE_BROWSER_PROFILE": "/absolute/path/to/Moodle-MCP/browser-profile"
      }
    }
  }
}
```

Alternatively, run the compiled entry directly:

```json
{
  "command": "npx",
  "args": ["tsx", "src/index.ts"],
  "cwd": "/absolute/path/to/Moodle-MCP"
}
```

Restart Poke after changing MCP settings.

## Available tools

| Tool | Purpose |
| --- | --- |
| `browser_navigate` | Open a URL (absolute or relative to `MOODLE_URL`) |
| `browser_read` | Return structured page content with numbered refs |
| `browser_click` | Click an element by ref from `browser_read` |
| `browser_type` | Type into an input/textarea by ref |
| `browser_press` | Press keyboard keys (`Enter`, `Tab`, `Escape`, …) |
| `browser_back` | Go back one page |
| `browser_wait` | Wait for selectors, network idle, or time |
| `browser_screenshot` | Capture a PNG screenshot |
| `browser_download` | Download a file via ref or direct URL |

### Example Poke workflow

User: *"What assignments do I have due this week?"*

Poke can:

1. `browser_navigate` → Moodle dashboard
2. `browser_read` → inspect courses, links, timeline text
3. `browser_click` → open relevant courses or calendar pages
4. Repeat read/navigate as needed
5. Answer the user from page content

Example `browser_read` output:

```text
PAGE: Moodle Dashboard
URL: https://moodle.example.edu/my/

HEADINGS:
* My courses
* Timeline

LINKS:
[1] Chemistry → /course/view.php?id=123
[2] English → /course/view.php?id=456

BUTTONS:
[3] Calendar

TEXT:
...
```

Then Poke can call `browser_click` with `ref: 1`.

## Session expiry

If Moodle redirects to a login page, tools return:

```text
SESSION_EXPIRED: Moodle session has expired. Please run the browser login setup again (`npm run setup`).
```

Run `npm run setup` again to re-authenticate manually.

## Error codes

| Code | Meaning |
| --- | --- |
| `SESSION_EXPIRED` | Login required again |
| `ELEMENT_NOT_FOUND` | Ref not found; run `browser_read` again |
| `NAVIGATION_FAILED` | Page could not be loaded |
| `DOWNLOAD_FAILED` | File download failed |
| `INVALID_ARGUMENT` | Missing/invalid tool input |
| `OPERATION_FAILED` | Unexpected browser error |

Secrets (passwords, cookies, tokens) are never included in tool output or logs.

## Development

Run browser-layer tests against a local HTML fixture (no Moodle required):

```bash
npm run test:browser
```

Build TypeScript:

```bash
npm run build
```

Enable debug logging:

```bash
MOODLE_MCP_DEBUG=true npm start
```

## Project structure

```text
src/
  config/          Environment configuration
  browser/         Playwright manager, page reader, session checks
  tools/           MCP tool registrations
  server/          MCP server factory
  index.ts         MCP stdio entrypoint
  setup.ts         Manual login setup
test/
  fixtures/        Local Moodle-like test page
  browser-layer.test.ts
```

## Security notes

- Credentials are **never** stored in this repository or hard-coded.
- The MCP server is intentionally read-oriented.
- Destructive actions (submissions, deletions, messaging) are not implemented in v1.
- Use a dedicated browser profile directory; it contains session state.

## License

ISC
