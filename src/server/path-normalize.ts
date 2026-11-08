const UUID_SEGMENT =
  /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Poke's tunnel may forward MCP requests to /{uuid}/ on localhost even though
 * MCP Streamable HTTP keeps a single endpoint and passes session state via the
 * Mcp-Session-Id header. Strip a leading UUID path segment before routing.
 */
export function normalizeMcpRequestPath(path: string): {
  path: string;
  strippedTunnelPrefix: string | null;
} {
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { path: "/", strippedTunnelPrefix: null };
  }

  const [first, ...rest] = segments;
  const candidatePrefix = `/${first}`;

  if (!UUID_SEGMENT.test(candidatePrefix)) {
    return { path: path || "/", strippedTunnelPrefix: null };
  }

  if (rest.length === 0) {
    return { path: "/", strippedTunnelPrefix: first!.toLowerCase() };
  }

  return {
    path: `/${rest.join("/")}`,
    strippedTunnelPrefix: first!.toLowerCase(),
  };
}
