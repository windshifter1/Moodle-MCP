import type { Page } from "playwright";
import { config } from "../config/index.js";
import { BrowserError } from "./errors.js";

const LOGIN_FIELD_SELECTORS = [
  'input[name="username"]',
  'input#username',
  'input[name="password"]',
  'input#password',
  'input[type="password"]',
  'button[type="submit"]:has-text("Log in")',
  'input[type="submit"][value*="Log in" i]',
];

function urlLooksLikeLogin(url: string): boolean {
  const lower = url.toLowerCase();
  return config.loginUrlPatterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

async function pageLooksLikeLogin(page: Page): Promise<boolean> {
  const title = (await page.title()).toLowerCase();
  if (title.includes("log in") || title.includes("login")) {
    return true;
  }

  for (const selector of LOGIN_FIELD_SELECTORS) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      return true;
    }
  }

  const loginRoleCount = await page.getByRole("button", { name: /log in/i }).count();
  return loginRoleCount > 0;
}

export async function assertAuthenticated(page: Page): Promise<void> {
  const currentUrl = page.url();

  if (urlLooksLikeLogin(currentUrl) && (await pageLooksLikeLogin(page))) {
    throw new BrowserError(
      "SESSION_EXPIRED",
      "Moodle session has expired. Please run the browser login setup again (`npm run setup`).",
    );
  }
}

export async function isLoginPage(page: Page): Promise<boolean> {
  if (urlLooksLikeLogin(page.url())) {
    return pageLooksLikeLogin(page);
  }

  return false;
}
