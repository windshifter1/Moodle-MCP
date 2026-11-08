import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { startMcpHttpServer } from "../src/server/http.js";

const EXPECTED_TOOLS = [
  "browser_navigate",
  "browser_auth_diagnose",
  "browser_read",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_back",
  "browser_wait",
  "browser_screenshot",
  "browser_download",
];

async function assertFullHandshake(url: string): Promise<void> {
  const client = new Client({
    name: "moodle-mcp-http-test",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(new URL(url));

  try {
    await client.connect(transport);

    assert.ok(
      transport.sessionId,
      `Expected MCP session ID after initialize at ${url}`,
    );

    const toolsResult = await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );

    const toolNames = toolsResult.tools.map((tool) => tool.name).sort();
    assert.equal(toolNames.length, EXPECTED_TOOLS.length);

    for (const expectedTool of EXPECTED_TOOLS) {
      assert.ok(
        toolNames.includes(expectedTool),
        `Expected tool missing at ${url}: ${expectedTool}`,
      );
    }

  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const httpServer = await startMcpHttpServer({
    host: "127.0.0.1",
    port: 0,
    paths: ["/", "/mcp"],
  });

  try {
    const rootUrl = `http://127.0.0.1:${httpServer.port}/`;
    const mcpUrl = `http://127.0.0.1:${httpServer.port}/mcp`;

    await assertFullHandshake(rootUrl);
    await assertFullHandshake(mcpUrl);

    console.error("HTTP MCP handshake tests passed");
    console.error(`  root URL: ${rootUrl}`);
    console.error(`  /mcp URL: ${mcpUrl}`);
    console.error(`  session + initialize + notifications/initialized + tools/list verified`);
  } finally {
    await httpServer.close();
  }
}

main().catch((error) => {
  console.error("HTTP MCP handshake tests failed:", error);
  process.exit(1);
});
