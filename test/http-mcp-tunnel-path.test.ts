import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { normalizeMcpRequestPath } from "../src/server/path-normalize.js";
import { startMcpHttpServer } from "../src/server/http.js";

function assertPathNormalize(
  input: string,
  expectedPath: string,
  expectedPrefix: string | null,
): void {
  const result = normalizeMcpRequestPath(input);
  assert.equal(result.path, expectedPath);
  assert.equal(result.strippedTunnelPrefix, expectedPrefix);
}

async function main(): Promise<void> {
  assertPathNormalize("/", "/", null);
  assertPathNormalize("/mcp", "/mcp", null);
  assertPathNormalize(
    "/2ff4a35e-cd30-40cb-91d0-e4b707286c64",
    "/",
    "2ff4a35e-cd30-40cb-91d0-e4b707286c64",
  );
  assertPathNormalize(
    "/2ff4a35e-cd30-40cb-91d0-e4b707286c64/",
    "/",
    "2ff4a35e-cd30-40cb-91d0-e4b707286c64",
  );
  assertPathNormalize(
    "/2ff4a35e-cd30-40cb-91d0-e4b707286c64/mcp",
    "/mcp",
    "2ff4a35e-cd30-40cb-91d0-e4b707286c64",
  );

  const httpServer = await startMcpHttpServer({
    host: "127.0.0.1",
    port: 0,
    paths: ["/", "/mcp"],
  });

  const rootClient = new Client({
    name: "moodle-mcp-tunnel-path-test",
    version: "1.0.0",
  });

  try {
    const rootTransport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${httpServer.port}/`),
    );
    await rootClient.connect(rootTransport);

    const sessionId = rootTransport.sessionId;
    assert.ok(sessionId, "Expected MCP session id from initialize");

    const toolsOnRoot = await rootClient.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    assert.equal(toolsOnRoot.tools.length, 9);

    const tunnelPathClient = new Client({
      name: "moodle-mcp-tunnel-path-followup",
      version: "1.0.0",
    });
    const tunnelPathTransport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${httpServer.port}/${sessionId}/`),
    );

    await tunnelPathClient.connect(tunnelPathTransport);

    const toolsOnTunnelPath = await tunnelPathClient.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    assert.equal(toolsOnTunnelPath.tools.length, 9);

    const callResult = await tunnelPathClient.request(
      {
        method: "tools/call",
        params: {
          name: "browser_read",
          arguments: {},
        },
      },
      CallToolResultSchema,
    );

    assert.ok(callResult.content.length > 0);

    await tunnelPathClient.close();
    console.error("Tunnel UUID path MCP tests passed");
    console.error(`  root initialize session: ${sessionId}`);
    console.error(`  follow-up URL: http://127.0.0.1:${httpServer.port}/${sessionId}/`);
  } finally {
    await rootClient.close();
    await httpServer.close();
  }
}

main().catch((error) => {
  console.error("Tunnel UUID path MCP tests failed:", error);
  process.exit(1);
});
