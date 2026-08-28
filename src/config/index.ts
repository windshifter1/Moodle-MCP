import dotenv from "dotenv";
import os from "node:os";
import path from "node:path";

dotenv.config();

function resolvePath(value: string | undefined, fallback: string): string {
  const chosen = value?.trim() || fallback;
  return path.isAbsolute(chosen) ? chosen : path.resolve(process.cwd(), chosen);
}

export const config = {
  moodleUrl: process.env.MOODLE_URL?.trim() ?? "",
  browserProfile: resolvePath(
    process.env.MOODLE_BROWSER_PROFILE,
    path.join(process.cwd(), "browser-profile"),
  ),
  downloadDir: resolvePath(
    process.env.MOODLE_DOWNLOAD_DIR,
    path.join(process.cwd(), "downloads"),
  ),
  headless: process.env.MOODLE_BROWSER_HEADLESS !== "false",
  debug:
    process.env.MOODLE_MCP_DEBUG === "true" ||
    process.env.DEBUG === "true",
  defaultTimeoutMs: Number.parseInt(
    process.env.MOODLE_BROWSER_TIMEOUT ?? "30000",
    10,
  ),
  maxTextLength: Number.parseInt(
    process.env.MOODLE_MAX_TEXT_LENGTH ?? "8000",
    10,
  ),
  loginUrlPatterns: (process.env.MOODLE_LOGIN_URL_PATTERNS ??
    "/login/index.php,/login/")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean),
  mcpHost: process.env.MCP_HOST?.trim() || "127.0.0.1",
  mcpPort: Number.parseInt(process.env.MCP_PORT ?? "3000", 10),
  mcpPath: "/mcp",
  serverName: "moodle-browser-mcp",
  serverVersion: "1.0.0",
} as const;

export function getMcpEndpoint(
  host: string = config.mcpHost,
  port: number = config.mcpPort,
): string {
  return `http://${host}:${port}${config.mcpPath}`;
}
