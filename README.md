# Moodle Browser MCP for Poke

This project lets **Poke AI** explore your school's **Moodle** website through a real browser on your Windows PC.

You do **not** need Moodle API access. Poke uses generic browser tools to navigate Moodle the same way you would in Chromium.

## How it works

```text
Poke
  ↓
Poke secure tunnel
  ↓
http://127.0.0.1:3000/mcp
  ↓
Streamable HTTP MCP server (this project)
  ↓
Playwright
  ↓
persistent Chromium profile
  ↓
Moodle
```

Poke is the only AI agent. This MCP server does **not** contain another AI model and does **not** decide what you want from Moodle. It only exposes browser actions like navigate, read, click, and download.

---

## Prerequisites

You need **Node.js** and **npm** installed on your Windows PC.

### 1. Install Node.js

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** Windows installer
3. Run the installer and accept the defaults

### 2. Verify Node.js and npm

Open **PowerShell** and run:

```powershell
node --version
npm --version
```

You should see version numbers (for example `v22.x.x` and `10.x.x`).

### 3. Git (only if cloning)

If you plan to clone the repository with Git, install Git from [https://git-scm.com/download/win](https://git-scm.com/download/win).

Downloading the repository as a ZIP file also works.

---

## Getting the project

### Option A: Clone with Git

```powershell
git clone https://github.com/windshifter1/Moodle-MCP.git
cd Moodle-MCP
```

### Option B: Download ZIP

1. Download the repository ZIP from GitHub
2. Extract it to a folder such as `C:\Users\YourName\Moodle-MCP`
3. Open PowerShell in that folder

In PowerShell, you can open the folder like this:

```powershell
cd C:\Users\YourName\Moodle-MCP
```

---

## Install dependencies

Run these commands in PowerShell from the project folder:

```powershell
npm install
npx playwright install chromium
```

Notes:

- `npm install` installs the project packages
- `npx playwright install chromium` downloads the Chromium browser Playwright uses
- You only need to run these again after updating the project

---

## Configure Moodle

### 1. Create your `.env` file

```powershell
copy .env.example .env
```

### 2. Edit `.env`

Open `.env` in Notepad and set your school's Moodle URL:

```env
MOODLE_URL=https://your-school-moodle-url.example
MOODLE_BROWSER_PROFILE=./browser-profile
MCP_HOST=127.0.0.1
MCP_PORT=3000
```

Important:

- Put your real Moodle website address in `MOODLE_URL`
- Do **not** put your Moodle password in `.env`
- Do **not** put any authentication token in `.env`

The MCP server listens on `127.0.0.1` (your PC only) by default.

---

## First login (one-time setup)

Before Poke can use Moodle, you must log in manually once so the browser profile is saved locally.

Run:

```powershell
npm run setup
```

What happens:

1. Chromium opens in a normal visible browser window
2. If `MOODLE_URL` is set, it opens your Moodle site
3. Log in the normal way, including WA DoE SSO and MFA if your school uses them
4. When you are fully logged in and can see Moodle, return to PowerShell
5. Press **Enter**

Your authenticated browser state is saved in the `browser-profile` folder on your PC.

Do **not** try to automate or bypass SSO, MFA, CAPTCHA, or other security controls.

---

## Daily use

You need **two PowerShell windows** open while Poke needs Moodle access.

Your PC must stay on, connected to the internet, and running both processes.

Cursor does **not** need to be open.

### Terminal 1: start the MCP server

```powershell
cd C:\Users\YourName\Moodle-MCP
npm start
```

Successful startup looks like:

```text
Moodle MCP server running
MCP endpoint: http://127.0.0.1:3000/mcp
```

Leave this window open.

### Terminal 2: start the Poke tunnel

Open a second PowerShell window:

```powershell
cd C:\Users\YourName\Moodle-MCP
npx poke@latest tunnel http://127.0.0.1:3000 -n "Moodle"
```

This creates a secure tunnel from Poke to the MCP server running on your PC.

The server exposes MCP on both `/` and `/mcp`, so either of these tunnel commands can work:

```powershell
npx poke@latest tunnel http://127.0.0.1:3000 -n "Moodle"
npx poke@latest tunnel http://127.0.0.1:3000/mcp -n "Moodle"
```

The tunnel command is separate from the MCP server. This project does **not** start the tunnel for you.

Follow the output from the `poke tunnel` command for any connection or registration steps shown by Poke.

---

## Testing with Poke

Once both processes are running, try asking Poke things like:

- Open my Moodle dashboard and tell me what courses you can see.
- Find my upcoming assignments.
- Find the latest announcement in my Chemistry course.

Poke will decide how to navigate Moodle using the generic browser tools:

- `browser_navigate`
- `browser_read`
- `browser_click`
- `browser_type`
- `browser_press`
- `browser_back`
- `browser_wait`
- `browser_screenshot`
- `browser_download`

---

## Session expiration

If your Moodle login expires, browser tools may return:

```text
SESSION_EXPIRED: Moodle session has expired. Please run the browser login setup again (`npm run setup`).
```

To fix this:

1. Stop the MCP server in Terminal 1 (`Ctrl+C`)
2. Run `npm run setup` again
3. Log into Moodle manually in Chromium
4. Press Enter when finished
5. Start `npm start` and the Poke tunnel again

---

## Troubleshooting

### `node` or `npm` is not recognized

Node.js is not installed correctly, or PowerShell needs to be reopened after installation.

Fix:

1. Reinstall Node.js LTS from [https://nodejs.org](https://nodejs.org)
2. Close and reopen PowerShell
3. Run `node --version` again

### Playwright Chromium is missing

You may see browser launch errors.

Fix:

```powershell
npx playwright install chromium
```

### Port 3000 is already in use

Another program is using port 3000.

Fix options:

1. Close the other program using port 3000
2. Or change `MCP_PORT=3001` in `.env` and use that port in the Poke tunnel command:

```powershell
npx poke@latest tunnel http://127.0.0.1:3001/mcp -n "Moodle"
```

### MCP server will not start

Check:

- You are in the project folder
- `npm install` completed successfully
- `.env` exists and `MOODLE_URL` is set
- No other copy of the server is already running

Try:

```powershell
npm run build
npm start
```

### Poke cannot connect

Check:

- Terminal 1 shows `MCP base URL: http://127.0.0.1:3000/` and `MCP endpoint: http://127.0.0.1:3000/mcp`
- Terminal 2 tunnel command is running
- The tunnel URL uses either the base server URL (`http://127.0.0.1:3000`) or the explicit MCP path (`http://127.0.0.1:3000/mcp`)
- Windows Firewall is not blocking local connections

To inspect MCP handshake requests safely, enable diagnostics:

```powershell
$env:MCP_HTTP_LOG="true"
npm start
```

This logs HTTP method, path, MCP headers, JSON-RPC method, response status, and session creation to stderr. It does not log cookies, passwords, or Moodle page content.

### Tunnel will not start

Check:

- Terminal 1 MCP server is already running
- You have internet access
- You typed the tunnel command exactly:

```powershell
npx poke@latest tunnel http://127.0.0.1:3000 -n "Moodle"
```

### Moodle redirects to login

Your saved browser session expired.

Fix: run `npm run setup` and log in again manually.

### Chromium profile is locked

This usually means another Chromium process is still using the profile.

Fix:

1. Stop `npm start` and `npm run setup` if they are running
2. Close any leftover Chromium windows
3. Start again

### Browser tools cannot find page elements

Moodle pages can change after navigation or load content dynamically.

Ask Poke to:

1. Run `browser_read` again to refresh numbered element references
2. Use `browser_wait` if a page is still loading
3. Navigate step by step instead of assuming page layout

---

## Security

- Moodle credentials are entered only through the normal browser login window during `npm run setup`
- This MCP does **not** store your Moodle username or password
- Authentication cookies and session state stay in the local `browser-profile` folder on your PC
- The MCP server listens on `127.0.0.1` by default (localhost only)
- The Poke tunnel exposes the MCP endpoint to Poke, not your whole filesystem or PowerShell
- Passwords, cookies, tokens, and authentication headers are not written to logs
- Never commit `.env` or `browser-profile/` to Git

---

## Optional settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOODLE_URL` | empty | Your Moodle site URL |
| `MOODLE_BROWSER_PROFILE` | `./browser-profile` | Saved browser login state |
| `MCP_HOST` | `127.0.0.1` | MCP server bind address |
| `MCP_PORT` | `3000` | MCP server port |
| `MOODLE_DOWNLOAD_DIR` | `./downloads` | Downloaded files folder |
| `MOODLE_BROWSER_HEADLESS` | `true` | Hide Chromium while MCP runs |
| `MOODLE_MCP_DEBUG` | `false` | Extra safe debug logging |

---

## Developer commands

```powershell
npm run build
npm run test:browser
npm run test:mcp
npm test
```

---

## License

ISC
