import { startMcpHttpServer, logStartupMessage } from "./server/http.js";
import { browserManager } from "./browser/manager.js";
import { info } from "./browser/logger.js";
import { config } from "./config/index.js";

async function shutdown(httpClose: () => Promise<void>): Promise<void> {
  await httpClose();
  await browserManager.close();
  process.exit(0);
}

async function main(): Promise<void> {
  info(
    `MCP server resolved browser profile: ${browserManager.getProfilePath()} (cwd=${process.cwd()})`,
  );
  if (config.moodleUrl) {
    info(`Configured Moodle URL: ${config.moodleUrl}`);
  }

  const httpServer = await startMcpHttpServer();
  logStartupMessage(httpServer);

  process.on("SIGINT", () => {
    void shutdown(httpServer.close);
  });

  process.on("SIGTERM", () => {
    void shutdown(httpServer.close);
  });
}

main().catch(async (error) => {
  console.error(
    "Failed to start MCP server:",
    error instanceof Error ? error.message : error,
  );
  await browserManager.close();
  process.exit(1);
});
