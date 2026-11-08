import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserManager } from "../src/browser/manager.js";
import { isLoginPage } from "../src/browser/session.js";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "moodle-test.html");

async function withTestServer(
  run: (baseUrl: string) => Promise<void>,
  options?: { includeLoginRoute?: boolean },
): Promise<void> {
  const html = await fs.readFile(fixturePath, "utf8");
  const loginHtml = `<!DOCTYPE html><html><head><title>Log in to Moodle</title></head><body>
    <form action="/login" method="post">
      <input id="username" name="username" />
      <input id="password" name="password" type="password" />
      <button type="submit">Log in</button>
    </form>
  </body></html>`;

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";

    if (options?.includeLoginRoute && url.startsWith("/login/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(loginHtml);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start local test server");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function withTemporaryProfile(run: (manager: BrowserManager) => Promise<void>): Promise<void> {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "moodle-mcp-test-"));

  const manager = new BrowserManager({
    profilePath: profileDir,
    headless: true,
  });

  try {
    await run(manager);
  } finally {
    await manager.close();
    await fs.rm(profileDir, { recursive: true, force: true });
  }
}

async function testReadAndClick(): Promise<void> {
  await withTestServer(async (baseUrl) => {
    await withTemporaryProfile(async (manager) => {
      await manager.navigate(`${baseUrl}/dashboard`);
      await manager.wait({ networkIdle: true, timeoutMs: 2_000 });

      const firstRead = await manager.read();
      assert.match(firstRead, /PAGE: Moodle Dashboard \(Test Fixture\)/);
      assert.match(firstRead, /Chemistry/);
      assert.match(firstRead, /\[(\d+)\].*Chemistry/);

      const chemistryRef = Number(firstRead.match(/\[(\d+)\] Chemistry/)?.[1]);
      assert.ok(Number.isFinite(chemistryRef));

      await manager.click(chemistryRef);
      const afterClickUrl = (await manager.ensureReady()).url();
      assert.match(afterClickUrl, /course\/view\.php\?id=123/);
    });
  });
}

async function testSessionExpiryDetection(): Promise<void> {
  await withTestServer(
    async (baseUrl) => {
      const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "moodle-mcp-login-test-"));
      const context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
      });
      const page = await context.newPage();

      try {
        await page.goto(`${baseUrl}/login/index.php`, { waitUntil: "domcontentloaded" });
        assert.equal(await isLoginPage(page), true);
      } finally {
        await context.close();
        await fs.rm(profileDir, { recursive: true, force: true });
      }
    },
    { includeLoginRoute: true },
  );
}

async function testTypeAndSearch(): Promise<void> {
  await withTestServer(async (baseUrl) => {
    await withTemporaryProfile(async (manager) => {
      await manager.navigate(`${baseUrl}/dashboard`);
      const content = await manager.read();
      const searchRef = Number(content.match(/\[(\d+)\] Search courses/)?.[1]);
      assert.ok(Number.isFinite(searchRef));

      await manager.type(searchRef, "chemistry", true);
      await manager.press("Enter");
    });
  });
}

async function main(): Promise<void> {
  await testReadAndClick();
  await testSessionExpiryDetection();
  await testTypeAndSearch();
  console.error("Browser layer tests passed");
}

main().catch((error) => {
  console.error("Browser layer tests failed:", error);
  process.exit(1);
});
