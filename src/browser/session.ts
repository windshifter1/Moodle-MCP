import type { Page } from "playwright";
import { config } from "../config/index.js";
import { BrowserError } from "./errors.js";

const USERNAME_SELECTORS = ['input[name="username"]', "input#username"];
const PASSWORD_SELECTORS = [
  'input[name="password"]',
  "input#password",
  'input[type="password"]',
];

const LOGIN_SUBMIT_SELECTORS = [
  'button[type="submit"]:has-text("Log in")',
  'input[type="submit"][value*="Log in" i]',
];

export type AuthenticationDiagnostics = {
  currentUrl: string;
  pageTitle: string;
  resolvedBrowserProfilePath: string;
  loginUrlPatternMatched: string | null;
  urlLooksLikeLogin: boolean;
  pageLooksLikeLogin: boolean;
  matchedLoginFieldSelectors: string[];
  matchedLoginButton: boolean;
  wouldReportSessionExpired: boolean;
};

function urlLooksLikeLogin(url: string): string | null {
  const lower = url.toLowerCase();
  for (const pattern of config.loginUrlPatterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }

  return null;
}

async function findMatchingSelectors(
  page: Page,
  selectors: string[],
): Promise<string[]> {
  const matched: string[] = [];

  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      matched.push(selector);
    }
  }

  return matched;
}

async function pageLooksLikeLogin(page: Page): Promise<{
  looksLikeLogin: boolean;
  matchedLoginFieldSelectors: string[];
  matchedLoginButton: boolean;
}> {
  const title = (await page.title()).toLowerCase();
  const titleLooksLikeLogin =
    title.includes("log in") || title.includes("login");

  const matchedUsername = await findMatchingSelectors(page, USERNAME_SELECTORS);
  const matchedPassword = await findMatchingSelectors(page, PASSWORD_SELECTORS);
  const matchedSubmit = await findMatchingSelectors(page, LOGIN_SUBMIT_SELECTORS);
  const matchedLoginButton =
    (await page.getByRole("button", { name: /log in/i }).count()) > 0;

  const matchedLoginFieldSelectors = [...matchedUsername, ...matchedPassword];
  const hasCredentialForm =
    matchedUsername.length > 0 && matchedPassword.length > 0;

  const looksLikeLogin =
    hasCredentialForm &&
    (titleLooksLikeLogin || matchedLoginButton || matchedSubmit.length > 0);

  return {
    looksLikeLogin,
    matchedLoginFieldSelectors,
    matchedLoginButton,
  };
}

export async function diagnoseAuthenticationState(
  page: Page,
  profilePath: string = config.browserProfile,
): Promise<AuthenticationDiagnostics> {
  const currentUrl = page.url();
  const loginUrlPatternMatched = urlLooksLikeLogin(currentUrl);
  const loginPageSignals = await pageLooksLikeLogin(page);

  return {
    currentUrl,
    pageTitle: await page.title(),
    resolvedBrowserProfilePath: profilePath,
    loginUrlPatternMatched,
    urlLooksLikeLogin: loginUrlPatternMatched !== null,
    pageLooksLikeLogin: loginPageSignals.looksLikeLogin,
    matchedLoginFieldSelectors: loginPageSignals.matchedLoginFieldSelectors,
    matchedLoginButton: loginPageSignals.matchedLoginButton,
    wouldReportSessionExpired:
      loginUrlPatternMatched !== null && loginPageSignals.looksLikeLogin,
  };
}

export async function assertAuthenticated(
  page: Page,
  profilePath: string = config.browserProfile,
): Promise<void> {
  const diagnostics = await diagnoseAuthenticationState(page, profilePath);

  if (diagnostics.wouldReportSessionExpired) {
    throw new BrowserError(
      "SESSION_EXPIRED",
      "Moodle session has expired. Please run the browser login setup again (`npm run setup`).",
    );
  }
}

export async function isLoginPage(page: Page): Promise<boolean> {
  const diagnostics = await diagnoseAuthenticationState(page);
  return diagnostics.wouldReportSessionExpired;
}
