import { config } from "../config/index.js";

const SENSITIVE_KEY_PATTERN =
  /password|cookie|token|authorization|secret|session/i;

function sanitizeValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 500)}…`;
  }

  return value;
}

export function debug(message: string, details?: Record<string, unknown>): void {
  if (!config.debug) {
    return;
  }

  if (!details) {
    console.error(`[moodle-mcp] ${message}`);
    return;
  }

  const safeDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      sanitizeValue(key, value),
    ]),
  );

  console.error(`[moodle-mcp] ${message}`, safeDetails);
}

export function info(message: string): void {
  console.error(`[moodle-mcp] ${message}`);
}
