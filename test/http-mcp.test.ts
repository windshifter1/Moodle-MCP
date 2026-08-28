import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { startMcpHttpServer } from "../src/server/http.js";

const EXPECTED_TOOLS = [
  "browser_navigate",
  "browser_read",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_back",
  "browser_wait",
  "browser_screenshot",
  "browser_download",
];

async function main(): Promise<void> {
  const httpServer = await startMcpHttpServer({ host: "127.0.0.1", port: 0 });
  const client = new Client({
    name: "moodle-mcp-http-test",
    version: "1.0.0",
  });

  try {
    const transport = new StreamableHTTPClientTransport(new URL(httpServer.url));
    await client.connect(transport);

    const toolsResult = await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );

    const toolNames = toolsResult.tools.map((tool) => tool.name).sort();
    for (const expectedTool of EXPECTED_TOOLS) {
      assert.ok(
        toolNames.includes(expectedTool),
        `Expected tool missing: ${expectedTool}`,
      );
    }

    assert.equal(httpServer.url.endsWith("/mcp"), true);
    console.error(`HTTP MCP smoke test passed (${httpServer.url})`);
  } finally {
    await client.close();
    await httpServer.close();
  }
}

main().catch((error) => {
  console.error("HTTP MCP smoke test failed:", error);
  process.exit(1);
});
