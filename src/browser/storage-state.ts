import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Cookie } from "playwright";
import { debug, info } from "./logger.js";

export const STORAGE_STATE_FILENAME = ".moodle-storage-state.json";

export function getStorageStatePath(profilePath: string): string {
  return path.join(profilePath, STORAGE_STATE_FILENAME);
}

export async function saveStorageState(
  context: BrowserContext,
  profilePath: string,
): Promise<void> {
  const statePath = getStorageStatePath(profilePath);
  await context.storageState({ path: statePath });
  debug("Saved browser storage state for session reuse", {
    profilePath,
    statePath,
  });
}

export async function restoreStorageState(
  context: BrowserContext,
  profilePath: string,
): Promise<boolean> {
  const statePath = getStorageStatePath(profilePath);

  let raw: string;
  try {
    raw = await fs.readFile(statePath, "utf8");
  } catch {
    info(
      `No saved storage state at ${statePath}. Run \`npm run setup\` if Moodle login is required.`,
    );
    return false;
  }

  let parsed: { cookies?: Cookie[] };
  try {
    parsed = JSON.parse(raw) as { cookies?: Cookie[] };
  } catch {
    info(`Saved storage state at ${statePath} is invalid JSON and was ignored.`);
    return false;
  }

  const cookies = parsed.cookies ?? [];
  if (cookies.length === 0) {
    info(`Saved storage state at ${statePath} contains no cookies.`);
    return false;
  }

  await context.addCookies(cookies);
  info(
    `Restored ${cookies.length} cookie(s) from ${statePath} for Moodle session reuse.`,
  );
  return true;
}
