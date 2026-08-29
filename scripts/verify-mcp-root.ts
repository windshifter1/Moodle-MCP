import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = process.env.MCP_VERIFY_URL ?? "http://127.0.0.1:3000/";
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
  const client = new Client({
    name: "moodle-mcp-live-verify",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(new URL(BASE_URL));

  try {
    await client.connect(transport);
    assert.ok(transport.sessionId, "Expected session ID after initialize");

    const toolsResult = await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    assert.equal(toolsResult.tools.length, EXPECTED_TOOLS.length);

    const callResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "browser_read",
          arguments: {},
        },
      },
      CallToolResultSchema,
    );

    assert.ok(callResult.content.length > 0, "Expected browser_read content");

    console.error(`Live MCP verification passed against ${BASE_URL}`);
    console.error(`  session: ${transport.sessionId}`);
    console.error(`  tools: ${toolsResult.tools.length}`);
    console.error(`  browser_read: ok`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Live MCP verification failed against ${BASE_URL}`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
