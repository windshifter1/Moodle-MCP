import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/index.js";
import { registerBrowserTools } from "../tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  registerBrowserTools(server);

  return server;
}
