import { startMcpHttpServer, logStartupMessage } from "./server/http.js";
import { browserManager } from "./browser/manager.js";

async function shutdown(httpClose: () => Promise<void>): Promise<void> {
  await httpClose();
  process.exit(0);
}

async function main(): Promise<void> {
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
