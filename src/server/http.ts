import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config, getMcpBaseUrl, getMcpEndpoint } from "../config/index.js";
import { browserManager } from "../browser/manager.js";
import { debug, info } from "../browser/logger.js";
import {
  beginMcpRequestLog,
  finishMcpRequestLog,
  logHttpRequest,
  shouldLogMcpHttp,
} from "./mcp-diagnostics.js";
import { normalizeMcpRequestPath } from "./path-normalize.js";
import { createServer } from "./index.js";

type StreamableTransport = StreamableHTTPServerTransport;

export interface McpHttpServerHandle {
  url: string;
  baseUrl: string;
  host: string;
  port: number;
  paths: string[];
  close: () => Promise<void>;
}

export async function startMcpHttpServer(options?: {
  host?: string;
  port?: number;
  paths?: string[];
}): Promise<McpHttpServerHandle> {
  const host = options?.host ?? config.mcpHost;
  const requestedPort = options?.port ?? config.mcpPort;
  const paths = options?.paths ?? [...config.mcpPaths];
  const app = createMcpExpressApp({ host });
  const transports: Record<string, StreamableTransport> = {};

  app.use((req, res, next) => {
    logHttpRequest(req, res);

    const originalPath = req.path;
    const { path: normalizedPath, strippedTunnelPrefix } =
      normalizeMcpRequestPath(originalPath);

    req.mcpOriginalPath = originalPath;
    req.mcpStrippedTunnelPrefix = strippedTunnelPrefix;

    if (strippedTunnelPrefix && normalizedPath !== originalPath) {
      const queryIndex = req.url.indexOf("?");
      const query = queryIndex >= 0 ? req.url.slice(queryIndex) : "";
      req.url = `${normalizedPath}${query}`;

      if (shouldLogMcpHttp()) {
        console.error("[moodle-mcp][mcp-http] normalized tunnel path", {
          originalPath,
          normalizedPath,
          strippedTunnelPrefix,
        });
      }
    }

    next();
  });

  const handlePost = async (req: Request, res: Response): Promise<void> => {
    const logContext = beginMcpRequestLog(req);
    res.on("finish", () => finishMcpRequestLog(res, logContext));

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
            logContext.sessionCreated = true;
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
    const logContext = beginMcpRequestLog(req);
    res.on("finish", () => finishMcpRequestLog(res, logContext));

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
    const logContext = beginMcpRequestLog(req);
    res.on("finish", () => finishMcpRequestLog(res, logContext));

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

  for (const mcpPath of paths) {
    app.post(mcpPath, handlePost);
    app.get(mcpPath, handleGet);
    app.delete(mcpPath, handleDelete);
  }

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
  const baseUrl = getMcpBaseUrl(host, port);

  return {
    url,
    baseUrl,
    host,
    port,
    paths,
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

export function logStartupMessage(handle: {
  url: string;
  baseUrl: string;
  paths: string[];
}): void {
  info("Moodle MCP server running");
  info(`MCP base URL: ${handle.baseUrl}`);
  info(`MCP endpoint: ${handle.url}`);
  info(`MCP paths: ${handle.paths.join(", ")}`);
  info(
    `MCP_PATHS env: ${process.env.MCP_PATHS ?? "(default /,/mcp)"}`,
  );
  info("HTTP request logging enabled (set MCP_HTTP_LOG=false to disable)");
}
