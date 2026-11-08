import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { BrowserManager } from "../src/browser/manager.js";
import {
  diagnoseAuthenticationState,
  isLoginPage,
} from "../src/browser/session.js";
import {
  getStorageStatePath,
  restoreStorageState,
  saveStorageState,
} from "../src/browser/storage-state.js";

async function withAuthServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    const cookies = req.headers.cookie ?? "";
    const hasSession = cookies.includes("moodle_session=valid");

    if (req.url?.startsWith("/login/")) {
      if (hasSession) {
        res.writeHead(302, { Location: "/my/" });
        res.end();
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><head><title>Log in to Moodle</title></head><body>
        <form action="/login/index.php" method="post">
          <input name="username" />
          <input name="password" type="password" />
          <button type="submit">Log in</button>
        </form>
      </body></html>`);
      return;
    }

    if (req.url?.startsWith("/my/")) {
      if (!hasSession) {
        res.writeHead(302, { Location: "/login/index.php" });
        res.end();
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><head><title>Dashboard</title></head><body>
        <h1>My courses</h1>
      </body></html>`);
      return;
    }

    if (req.url === "/auth") {
      res.writeHead(302, {
        Location: "/my/",
        "Set-Cookie": "moodle_session=valid; Path=/; HttpOnly",
      });
      res.end();
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start auth test server");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function testStorageStateRoundTrip(): Promise<void> {
  await withAuthServer(async (baseUrl) => {
    const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "moodle-mcp-auth-"));

    const setup = new BrowserManager({ profilePath: profileDir, headless: true });
    await setup.launch();
    const setupPage = await setup.ensureReady();
    await setupPage.goto(`${baseUrl}/auth`, { waitUntil: "domcontentloaded" });
    await setup.saveSessionState();
    await setup.close();

    const statePath = getStorageStatePath(profileDir);
    await fs.access(statePath);

    const server = new BrowserManager({ profilePath: profileDir, headless: true });
    await server.launch();
    const page = await server.ensureReady();
    await page.goto(`${baseUrl}/my/`, { waitUntil: "domcontentloaded" });

    assert.equal(await isLoginPage(page), false);
    const content = await server.read();
    assert.match(content, /My courses/);

    await server.close();
    await fs.rm(profileDir, { recursive: true, force: true });
  });
}

async function testSetupAndServerShareProfilePath(): Promise<void> {
  const setup = new BrowserManager({ headless: false });
  const server = new BrowserManager({ headless: true });
  assert.equal(setup.getProfilePath(), server.getProfilePath());
}

async function testLoginDetectionAvoidsFalsePositives(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.route("https://moodle.example.edu/my/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!DOCTYPE html><html><head><title>Dashboard</title></head><body>
        <h1>My courses</h1>
        <input type="password" style="display:none" autocomplete="new-password" />
      </body></html>`,
    });
  });
  await page.goto("https://moodle.example.edu/my/");

  const diagnostics = await diagnoseAuthenticationState(page, "/tmp/profile");
  assert.equal(diagnostics.wouldReportSessionExpired, false);
  assert.equal(diagnostics.pageLooksLikeLogin, false);

  await page.route("https://moodle.example.edu/login/index.php**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!DOCTYPE html><html><head><title>Log in to Moodle</title></head><body>
        <form>
          <input name="username" />
          <input name="password" type="password" />
          <button type="submit">Log in</button>
        </form>
      </body></html>`,
    });
  });
  await page.goto("https://moodle.example.edu/login/index.php");

  const loginDiagnostics = await diagnoseAuthenticationState(page, "/tmp/profile");
  assert.equal(loginDiagnostics.wouldReportSessionExpired, true);
  assert.equal(loginDiagnostics.loginUrlPatternMatched, "/login/index.php");

  await browser.close();
}

async function testRestoreStorageStateHelper(): Promise<void> {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "moodle-mcp-restore-"));
  const statePath = getStorageStatePath(profileDir);
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    statePath,
    JSON.stringify({
      cookies: [
        {
          name: "moodle_session",
          value: "valid",
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
    }),
    "utf8",
  );

  await withAuthServer(async (baseUrl) => {
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
    });

    const restored = await restoreStorageState(context, profileDir);
    assert.equal(restored, true);

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${baseUrl}/my/`, { waitUntil: "domcontentloaded" });
    assert.equal(await isLoginPage(page), false);

    await context.close();
  });

  await fs.rm(profileDir, { recursive: true, force: true });
}

async function main(): Promise<void> {
  await testSetupAndServerShareProfilePath();
  await testLoginDetectionAvoidsFalsePositives();
  await testRestoreStorageStateHelper();
  await testStorageStateRoundTrip();
  console.error("Auth persistence tests passed");
}

main().catch((error) => {
  console.error("Auth persistence tests failed:", error);
  process.exit(1);
});
