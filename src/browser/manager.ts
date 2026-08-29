import fs from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type BrowserContext,
  type Download,
  type Page,
} from "playwright";
import { config } from "../config/index.js";
import { BrowserError } from "./errors.js";
import { debug, info } from "./logger.js";
import { type ElementEntry, readPage } from "./reader.js";
import { assertAuthenticated, diagnoseAuthenticationState } from "./session.js";
import { restoreStorageState, saveStorageState } from "./storage-state.js";

export class BrowserManager {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private elementRegistry = new Map<number, ElementEntry>();
  private readonly profilePath: string;
  private readonly headless: boolean;

  constructor(options?: { profilePath?: string; headless?: boolean }) {
    this.profilePath = options?.profilePath ?? config.browserProfile;
    this.headless = options?.headless ?? config.headless;
  }

  async ensureReady(): Promise<Page> {
    if (!this.context) {
      await this.launch();
    }

    if (!this.page || this.page.isClosed()) {
      const pages = this.context!.pages();
      this.page = pages.length > 0 ? pages[0]! : await this.context!.newPage();
    }

    this.page.setDefaultTimeout(config.defaultTimeoutMs);
    return this.page;
  }

  getProfilePath(): string {
    return this.profilePath;
  }

  async saveSessionState(): Promise<void> {
    if (!this.context) {
      return;
    }

    await saveStorageState(this.context, this.profilePath);
  }

  async launch(): Promise<void> {
    await fs.mkdir(this.profilePath, { recursive: true });
    await fs.mkdir(config.downloadDir, { recursive: true });

    info(
      `Launching Chromium with persistent profile at ${this.profilePath} (cwd=${process.cwd()}, headless=${this.headless})`,
    );

    this.context = await chromium.launchPersistentContext(this.profilePath, {
      headless: this.headless,
      viewport: { width: 1366, height: 900 },
      acceptDownloads: true,
      downloadsPath: config.downloadDir,
      args: ["--disable-dev-shm-usage"],
    });

    await restoreStorageState(this.context, this.profilePath);

    this.context.setDefaultTimeout(config.defaultTimeoutMs);

    this.context.on("page", (newPage) => {
      debug("New page opened", { url: newPage.url() });
    });

    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0]! : await this.context.newPage();
  }

  async close(): Promise<void> {
    if (this.context) {
      try {
        await saveStorageState(this.context, this.profilePath);
      } catch (error) {
        debug("Could not save browser storage state during shutdown", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await this.context.close();
      this.context = null;
      this.page = null;
      this.elementRegistry.clear();
    }
  }

  private clearRegistry(): void {
    this.elementRegistry.clear();
  }

  private storeRegistry(entries: ElementEntry[]): void {
    this.clearRegistry();
    for (const entry of entries) {
      this.elementRegistry.set(entry.ref, entry);
    }
  }

  getRegistryEntry(ref: number): ElementEntry | undefined {
    return this.elementRegistry.get(ref);
  }

  async navigate(url: string, waitUntil: "load" | "domcontentloaded" | "networkidle" = "domcontentloaded"): Promise<string> {
    const page = await this.ensureReady();
    this.clearRegistry();

    try {
      const response = await page.goto(url, {
        waitUntil,
        timeout: config.defaultTimeoutMs,
      });

      if (!response) {
        throw new BrowserError(
          "NAVIGATION_FAILED",
          `Could not navigate to the requested page: ${url}`,
        );
      }

      if (!response.ok() && response.status() >= 400) {
        throw new BrowserError(
          "NAVIGATION_FAILED",
          `Could not navigate to the requested page (HTTP ${response.status()}): ${url}`,
        );
      }

      await assertAuthenticated(page, this.profilePath);
      await saveStorageState(this.context!, this.profilePath);
      return `Navigated to ${page.url()}`;
    } catch (error) {
      if (error instanceof BrowserError) {
        throw error;
      }

      throw new BrowserError(
        "NAVIGATION_FAILED",
        `Could not navigate to the requested Moodle page: ${url}`,
      );
    }
  }

  async diagnoseAuthentication(): Promise<string> {
    const page = await this.ensureReady();
    const diagnostics = await diagnoseAuthenticationState(page, this.profilePath);
    return JSON.stringify(diagnostics, null, 2);
  }

  async read(): Promise<string> {
    const page = await this.ensureReady();
    await assertAuthenticated(page, this.profilePath);

    const snapshot = await readPage(page);
    this.storeRegistry(snapshot.entries);
    return snapshot.text;
  }

  async click(ref: number): Promise<string> {
    const page = await this.ensureReady();
    await assertAuthenticated(page, this.profilePath);

    const entry = this.elementRegistry.get(ref);
    if (!entry) {
      throw new BrowserError(
        "ELEMENT_NOT_FOUND",
        `Could not find the requested element on the current page. Use browser_read first to refresh element references.`,
      );
    }

    try {
      await entry.locator.scrollIntoViewIfNeeded();
      const popupPromise = page.waitForEvent("popup", { timeout: 3_000 }).catch(() => null);

      await entry.locator.click({ timeout: config.defaultTimeoutMs });
      const popup = await popupPromise;

      if (popup) {
        this.page = popup;
        await popup.waitForLoadState("domcontentloaded");
        debug("Switched to popup page", { url: popup.url() });
      } else {
        await page.waitForLoadState("domcontentloaded");
      }

      this.clearRegistry();
      await assertAuthenticated(await this.ensureReady(), this.profilePath);
      return `Clicked [${ref}] ${entry.label}. Current URL: ${(await this.ensureReady()).url()}`;
    } catch (error) {
      if (error instanceof BrowserError) {
        throw error;
      }

      throw new BrowserError(
        "ELEMENT_NOT_FOUND",
        "Could not find the requested element on the current page.",
      );
    }
  }

  async type(ref: number, text: string, clear = false): Promise<string> {
    const page = await this.ensureReady();
    await assertAuthenticated(page, this.profilePath);

    const entry = this.elementRegistry.get(ref);
    if (!entry) {
      throw new BrowserError(
        "ELEMENT_NOT_FOUND",
        `Could not find the requested input on the current page. Use browser_read first to refresh element references.`,
      );
    }

    try {
      await entry.locator.scrollIntoViewIfNeeded();
      if (clear) {
        await entry.locator.fill(text);
      } else {
        await entry.locator.pressSequentially(text);
      }

      return `Typed into [${ref}] ${entry.label}`;
    } catch {
      throw new BrowserError(
        "ELEMENT_NOT_FOUND",
        "Could not find the requested input on the current page.",
      );
    }
  }

  async press(key: string): Promise<string> {
    const page = await this.ensureReady();
    await assertAuthenticated(page, this.profilePath);
    await page.keyboard.press(key);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    return `Pressed ${key}`;
  }

  async back(): Promise<string> {
    const page = await this.ensureReady();
    await assertAuthenticated(page, this.profilePath);

    const response = await page.goBack({
      waitUntil: "domcontentloaded",
      timeout: config.defaultTimeoutMs,
    });

    if (response === null) {
      throw new BrowserError(
        "NAVIGATION_FAILED",
        "Could not go back; there is no previous page in the browser history.",
      );
    }

    this.clearRegistry();
    await assertAuthenticated(page, this.profilePath);
    return `Went back to ${page.url()}`;
  }

  async wait(options: {
    selector?: string;
    state?: "attached" | "detached" | "visible" | "hidden";
    timeoutMs?: number;
    networkIdle?: boolean;
  }): Promise<string> {
    const page = await this.ensureReady();
    await assertAuthenticated(page, this.profilePath);

    const timeout = options.timeoutMs ?? config.defaultTimeoutMs;

    if (options.networkIdle) {
      await page.waitForLoadState("networkidle", { timeout });
    }

    if (options.selector) {
      await page.waitForSelector(options.selector, {
        state: options.state ?? "visible",
        timeout,
      });
      return `Waited for selector "${options.selector}" (${options.state ?? "visible"})`;
    }

    if (options.networkIdle) {
      return "Waited for network idle";
    }

    await page.waitForTimeout(Math.min(timeout, 5_000));
    return `Waited ${Math.min(timeout, 5_000)}ms`;
  }

  async screenshot(fullPage = false): Promise<{ pngBase64: string; note: string }> {
    const page = await this.ensureReady();
    await assertAuthenticated(page, this.profilePath);

    const buffer = await page.screenshot({ fullPage, type: "png" });
    return {
      pngBase64: buffer.toString("base64"),
      note: `Screenshot captured (${fullPage ? "full page" : "viewport"}) at ${page.url()}`,
    };
  }

  async download(options: { ref?: number; url?: string }): Promise<string> {
    const page = await this.ensureReady();
    await assertAuthenticated(page, this.profilePath);

    let download: Download;

    try {
      if (options.ref !== undefined) {
        const entry = this.elementRegistry.get(options.ref);
        if (!entry) {
          throw new BrowserError(
            "ELEMENT_NOT_FOUND",
            `Could not find download element [${options.ref}] on the current page.`,
          );
        }

        const downloadPromise = page.waitForEvent("download", {
          timeout: config.defaultTimeoutMs,
        });
        await entry.locator.click();
        download = await downloadPromise;
      } else if (options.url) {
        const downloadPromise = page.waitForEvent("download", {
          timeout: config.defaultTimeoutMs,
        });
        await page.goto(options.url, { waitUntil: "domcontentloaded" });
        download = await downloadPromise;
      } else {
        throw new BrowserError(
          "INVALID_ARGUMENT",
          "Provide either ref (from browser_read) or url for browser_download.",
        );
      }

      const suggestedName = download.suggestedFilename();
      const targetPath = path.join(
        config.downloadDir,
        `${Date.now()}-${suggestedName}`,
      );
      await download.saveAs(targetPath);

      return `Downloaded file to ${targetPath}`;
    } catch (error) {
      if (error instanceof BrowserError) {
        throw error;
      }

      throw new BrowserError(
        "DOWNLOAD_FAILED",
        "Could not download the requested file.",
      );
    }
  }
}

export const browserManager = new BrowserManager();
