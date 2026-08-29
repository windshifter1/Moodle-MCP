import type { Request, Response } from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config/index.js";

export interface McpRequestLogContext {
  method: string;
  path: string;
  accept?: string;
  sessionId?: string;
  rpcMethod?: string;
  isInitialize: boolean;
  isToolsList: boolean;
  sessionCreated: boolean;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function extractRpcMethod(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  if (Array.isArray(body)) {
    const methods = body
      .map((entry) =>
        entry && typeof entry === "object" && "method" in entry
          ? String((entry as { method: unknown }).method)
          : undefined,
      )
      .filter(Boolean);

    return methods.length > 0 ? methods.join(",") : undefined;
  }

  if ("method" in body) {
    return String((body as { method: unknown }).method);
  }

  return undefined;
}

export function shouldLogMcpHttp(): boolean {
  return process.env.MCP_HTTP_LOG !== "false";
}

export function beginMcpRequestLog(
  req: Request,
  options?: { sessionCreated?: boolean },
): McpRequestLogContext {
  const rpcMethod = extractRpcMethod(req.body);
  const context: McpRequestLogContext = {
    method: req.method,
    path: req.path,
    accept: headerValue(req.headers.accept),
    sessionId: headerValue(req.headers["mcp-session-id"]),
    rpcMethod,
    isInitialize: isInitializeRequest(req.body),
    isToolsList: rpcMethod === "tools/list",
    sessionCreated: options?.sessionCreated ?? false,
  };

  if (shouldLogMcpHttp()) {
    console.error("[moodle-mcp][mcp-http] request", {
      httpMethod: context.method,
      path: context.path,
      accept: context.accept,
      mcpSessionId: context.sessionId ?? null,
      rpcMethod: context.rpcMethod ?? null,
      isInitialize: context.isInitialize,
      isToolsList: context.isToolsList,
    });
  }

  return context;
}

export function finishMcpRequestLog(
  res: Response,
  context: McpRequestLogContext,
): void {
  if (!shouldLogMcpHttp()) {
    return;
  }

  console.error("[moodle-mcp][mcp-http] response", {
    httpMethod: context.method,
    path: context.path,
    status: res.statusCode,
    rpcMethod: context.rpcMethod ?? null,
    isInitialize: context.isInitialize,
    isToolsList: context.isToolsList,
    sessionCreated: context.sessionCreated,
  });
}

export function logHttpRequest(req: Request, res: Response): void {
  if (!shouldLogMcpHttp()) {
    return;
  }

  const rpcMethod = extractRpcMethod(req.body);

  res.on("finish", () => {
    console.error("[moodle-mcp][http] request", {
      httpMethod: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      status: res.statusCode,
      rpcMethod: rpcMethod ?? null,
      mcpSessionId: headerValue(req.headers["mcp-session-id"]) ?? null,
      handled: res.statusCode !== 404,
    });
  });
}
