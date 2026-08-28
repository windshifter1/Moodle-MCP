import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config/index.js";
import { type BrowserManager, browserManager } from "../browser/manager.js";
import { BrowserError, isBrowserError } from "../browser/errors.js";

function resolveNavigationUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  if (!config.moodleUrl) {
    throw new BrowserError(
      "INVALID_ARGUMENT",
      "Relative URL provided but MOODLE_URL is not configured in the environment.",
    );
  }

  return new URL(url, config.moodleUrl).toString();
}

function toolText(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
  };
}

function toolError(error: unknown) {
  if (isBrowserError(error)) {
    return toolText(error.toToolMessage());
  }

  const message =
    error instanceof Error ? error.message : "An unexpected browser error occurred.";
  return toolText(`OPERATION_FAILED: ${message}`);
}

function isScreenshotResult(value: unknown): value is { pngBase64: string; note: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "pngBase64" in value &&
    "note" in value &&
    typeof (value as { pngBase64: unknown }).pngBase64 === "string" &&
    typeof (value as { note: unknown }).note === "string"
  );
}

async function runTool<T>(operation: () => Promise<T>): Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> }> {
  try {
    const result = await operation();

    if (isScreenshotResult(result)) {
      return {
        content: [
          { type: "text", text: result.note },
          {
            type: "image",
            data: result.pngBase64,
            mimeType: "image/png",
          },
        ],
      };
    }

    return toolText(String(result));
  } catch (error) {
    return toolError(error);
  }
}

export function registerBrowserTools(
  server: McpServer,
  manager: BrowserManager = browserManager,
): void {
  server.registerTool(
    "browser_navigate",
    {
      description:
        "Navigate the logged-in Moodle browser to a URL. Accepts absolute URLs or site-relative paths.",
      inputSchema: {
        url: z.string().describe("Absolute URL or path such as /my/courses.php"),
        wait_until: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .optional()
          .describe("When to consider navigation complete"),
      },
    },
    async ({ url, wait_until }) =>
      runTool(async () => {
        const resolvedUrl = resolveNavigationUrl(url);
        return manager.navigate(resolvedUrl, wait_until ?? "domcontentloaded");
      }),
  );

  server.registerTool(
    "browser_read",
    {
      description:
        "Return token-efficient structured content for the current page, including numbered references for links, buttons, and inputs.",
      inputSchema: {},
    },
    async () => runTool(() => manager.read()),
  );

  server.registerTool(
    "browser_click",
    {
      description:
        "Click a visible element using its numbered reference from browser_read (for example, 3).",
      inputSchema: {
        ref: z.number().int().positive().describe("Element reference number from browser_read"),
      },
    },
    async ({ ref }) => runTool(() => manager.click(ref)),
  );

  server.registerTool(
    "browser_type",
    {
      description: "Type text into an input/textarea referenced by browser_read.",
      inputSchema: {
        ref: z.number().int().positive().describe("Input reference number from browser_read"),
        text: z.string().describe("Text to type"),
        clear: z
          .boolean()
          .optional()
          .describe("If true, replace existing field contents instead of appending"),
      },
    },
    async ({ ref, text, clear }) => runTool(() => manager.type(ref, text, clear ?? false)),
  );

  server.registerTool(
    "browser_press",
    {
      description: "Press a keyboard key such as Enter, Escape, Tab, ArrowDown, etc.",
      inputSchema: {
        key: z.string().describe("Key name understood by Playwright, e.g. Enter, Escape, Tab"),
      },
    },
    async ({ key }) => runTool(() => manager.press(key)),
  );

  server.registerTool(
    "browser_back",
    {
      description: "Go back one page in browser history.",
      inputSchema: {},
    },
    async () => runTool(() => manager.back()),
  );

  server.registerTool(
    "browser_wait",
    {
      description:
        "Wait for navigation, network idle, or a selector to reach a desired state.",
      inputSchema: {
        selector: z.string().optional().describe("CSS selector to wait for"),
        state: z
          .enum(["attached", "detached", "visible", "hidden"])
          .optional()
          .describe("Selector state to wait for"),
        timeout_ms: z.number().int().positive().optional().describe("Timeout in milliseconds"),
        network_idle: z
          .boolean()
          .optional()
          .describe("Wait for network idle if true"),
      },
    },
    async ({ selector, state, timeout_ms, network_idle }) =>
      runTool(() =>
        manager.wait({
          selector,
          state,
          timeoutMs: timeout_ms,
          networkIdle: network_idle,
        }),
      ),
  );

  server.registerTool(
    "browser_screenshot",
    {
      description: "Capture a PNG screenshot of the current page for visual inspection.",
      inputSchema: {
        full_page: z
          .boolean()
          .optional()
          .describe("Capture the full scrollable page instead of just the viewport"),
      },
    },
    async ({ full_page }) => runTool(() => manager.screenshot(full_page ?? false)),
  );

  server.registerTool(
    "browser_download",
    {
      description:
        "Download a file by clicking a numbered link/button or navigating directly to a file URL.",
      inputSchema: {
        ref: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Reference number from browser_read that triggers a download"),
        url: z.string().optional().describe("Direct file URL to download"),
      },
    },
    async ({ ref, url }) => {
      if (ref === undefined && !url) {
        return toolText(
          "INVALID_ARGUMENT: Provide either ref (from browser_read) or url for browser_download.",
        );
      }

      return runTool(() => manager.download({ ref, url }));
    },
  );
}

// Re-export for tests that need to assert error formatting.
export { BrowserError };
