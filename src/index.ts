import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { info } from "./browser/logger.js";
import { browserManager } from "./browser/manager.js";
import { createServer } from "./server/index.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  process.on("SIGINT", async () => {
    await browserManager.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await browserManager.close();
    process.exit(0);
  });

  await server.connect(transport);
  info("Moodle Browser MCP server running on stdio");
}

main().catch(async (error) => {
  console.error("Failed to start MCP server:", error instanceof Error ? error.message : error);
  await browserManager.close();
  process.exit(1);
});
