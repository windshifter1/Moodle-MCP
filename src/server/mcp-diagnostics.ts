import type { Request, Response } from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

export interface McpRequestLogContext {
  method: string;
  path: string;
  originalPath?: string;
  normalizedPath?: string;
  strippedTunnelPrefix?: string | null;
  accept?: string;
  sessionId?: string;
  protocolVersion?: string;
  rpcMethod?: string;
  isInitialize: boolean;
  isToolsList: boolean;
  isToolsCall: boolean;
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

function sanitizeResponseHeaders(
  headers: Record<string, number | string | string[]>,
): Record<string, string> {
  const allowed = [
    "content-type",
    "mcp-session-id",
    "location",
    "cache-control",
    "connection",
  ];
  const result: Record<string, string> = {};

  for (const key of allowed) {
    const value = headers[key];
    if (value === undefined) {
      continue;
    }

    result[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }

  return result;
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
    originalPath:
      typeof req.mcpOriginalPath === "string" ? req.mcpOriginalPath : req.path,
    normalizedPath: req.path,
    strippedTunnelPrefix: req.mcpStrippedTunnelPrefix ?? null,
    accept: headerValue(req.headers.accept),
    sessionId: headerValue(req.headers["mcp-session-id"]),
    protocolVersion: headerValue(req.headers["mcp-protocol-version"]),
    rpcMethod,
    isInitialize: isInitializeRequest(req.body),
    isToolsList: rpcMethod === "tools/list",
    isToolsCall: rpcMethod === "tools/call",
    sessionCreated: options?.sessionCreated ?? false,
  };

  if (shouldLogMcpHttp()) {
    console.error("[moodle-mcp][mcp-http] request", {
      httpMethod: context.method,
      originalPath: context.originalPath,
      normalizedPath: context.normalizedPath,
      strippedTunnelPrefix: context.strippedTunnelPrefix,
      accept: context.accept,
      mcpSessionId: context.sessionId ?? null,
      mcpProtocolVersion: context.protocolVersion ?? null,
      rpcMethod: context.rpcMethod ?? null,
      isInitialize: context.isInitialize,
      isToolsList: context.isToolsList,
      isToolsCall: context.isToolsCall,
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

  const payload: Record<string, unknown> = {
    httpMethod: context.method,
    originalPath: context.originalPath,
    normalizedPath: context.normalizedPath,
    strippedTunnelPrefix: context.strippedTunnelPrefix,
    status: res.statusCode,
    rpcMethod: context.rpcMethod ?? null,
    isInitialize: context.isInitialize,
    isToolsList: context.isToolsList,
    isToolsCall: context.isToolsCall,
    sessionCreated: context.sessionCreated,
  };

  if (context.isInitialize || context.isToolsCall) {
    payload.responseHeaders = sanitizeResponseHeaders(
      res.getHeaders() as Record<string, string | number | string[]>,
    );
  }

  console.error("[moodle-mcp][mcp-http] response", payload);
}

export function logHttpRequest(req: Request, res: Response): void {
  if (!shouldLogMcpHttp()) {
    return;
  }

  const rpcMethod = extractRpcMethod(req.body);

  res.on("finish", () => {
    console.error("[moodle-mcp][http] request", {
      httpMethod: req.method,
      originalPath:
        typeof req.mcpOriginalPath === "string" ? req.mcpOriginalPath : req.path,
      normalizedPath: req.path,
      strippedTunnelPrefix: req.mcpStrippedTunnelPrefix ?? null,
      originalUrl: req.originalUrl,
      status: res.statusCode,
      rpcMethod: rpcMethod ?? null,
      mcpSessionId: headerValue(req.headers["mcp-session-id"]) ?? null,
      mcpProtocolVersion: headerValue(req.headers["mcp-protocol-version"]) ?? null,
      handled: res.statusCode !== 404,
    });
  });
}

declare module "express-serve-static-core" {
  interface Request {
    mcpOriginalPath?: string;
    mcpStrippedTunnelPrefix?: string | null;
  }
}
