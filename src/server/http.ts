import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config/index.js";
import { browserManager } from "../browser/manager.js";
import { debug, info } from "../browser/logger.js";
import { createServer } from "./index.js";

type StreamableTransport = StreamableHTTPServerTransport;

export interface McpHttpServerHandle {
  url: string;
  host: string;
  port: number;
  close: () => Promise<void>;
}

function getMcpEndpoint(host: string, port: number): string {
  return `http://${host}:${port}${config.mcpPath}`;
}

export async function startMcpHttpServer(options?: {
  host?: string;
  port?: number;
}): Promise<McpHttpServerHandle> {
  const host = options?.host ?? config.mcpHost;
  const requestedPort = options?.port ?? config.mcpPort;
  const app = createMcpExpressApp({ host });
  const transports: Record<string, StreamableTransport> = {};

  const handlePost = async (req: Request, res: Response): Promise<void> => {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader)
      ? sessionIdHeader[0]
      : sessionIdHeader;

    try {
      let transport: StreamableTransport | undefined;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport!;
            debug("MCP session initialized", { sessionId: newSessionId });
          },
        });

        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId && transports[closedSessionId]) {
            delete transports[closedSessionId];
            debug("MCP session closed", { sessionId: closedSessionId });
          }
        };

        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(
        "Error handling MCP request:",
        error instanceof Error ? error.message : error,
      );

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  };

  const handleGet = async (req: Request, res: Response): Promise<void> => {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader)
      ? sessionIdHeader[0]
      : sessionIdHeader;

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    await transports[sessionId].handleRequest(req, res);
  };

  const handleDelete = async (req: Request, res: Response): Promise<void> => {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader)
      ? sessionIdHeader[0]
      : sessionIdHeader;

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    await transports[sessionId].handleRequest(req, res);
  };

  app.post(config.mcpPath, handlePost);
  app.get(config.mcpPath, handleGet);
  app.delete(config.mcpPath, handleDelete);

  const httpServer = await new Promise<Server>((resolve, reject) => {
    const server = app.listen(requestedPort, host, () => resolve(server));
    server.on("error", reject);
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine HTTP server address");
  }

  const port = address.port;
  const url = getMcpEndpoint(host, port);

  return {
    url,
    host,
    port,
    close: async () => {
      for (const sessionId of Object.keys(transports)) {
        try {
          await transports[sessionId]?.close();
        } catch (error) {
          console.error(
            `Error closing MCP transport for session ${sessionId}:`,
            error instanceof Error ? error.message : error,
          );
        }
        delete transports[sessionId];
      }

      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });

      await browserManager.close();
    },
  };
}

export function logStartupMessage(url: string): void {
  info("Moodle MCP server running");
  info(`MCP endpoint: ${url}`);
}
