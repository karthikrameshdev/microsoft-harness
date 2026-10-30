/**
 * JSON-RPC 2.0 Wire Protocol Implementation
 * Used by GitHub Copilot SDK client and server architecture
 */

export interface JSONRPCRequest<T = Record<string, unknown>> {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: T;
}

export interface JSONRPCResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Copilot Harness Custom Error Codes
  AUTHORIZATION_REQUIRED: -32001,
  LIMIT_EXCEEDED: -32002,
  SAFETY_VIOLATION: -32003,
};

export class JSONRPCServer {
  private handlers = new Map<string, (params: any) => Promise<any>>();

  public registerMethod<T, R>(method: string, handler: (params: T) => Promise<R>): void {
    this.handlers.set(method, handler);
  }

  public async handleMessage(rawMessage: string | Record<string, any>): Promise<JSONRPCResponse | null> {
    let req: JSONRPCRequest;
    try {
      req = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;
    } catch {
      return {
        jsonrpc: '2.0',
        id: 0,
        error: { code: JSONRPC_ERROR_CODES.PARSE_ERROR, message: 'Parse error' },
      };
    }

    if (req.jsonrpc !== '2.0' || !req.method) {
      return {
        jsonrpc: '2.0',
        id: req.id || 0,
        error: { code: JSONRPC_ERROR_CODES.INVALID_REQUEST, message: 'Invalid Request' },
      };
    }

    const handler = this.handlers.get(req.method);
    if (!handler) {
      if (req.id === undefined) return null; // Notification, do not respond
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: JSONRPC_ERROR_CODES.METHOD_NOT_FOUND, message: `Method '${req.method}' not found` },
      };
    }

    try {
      const result = await handler(req.params);
      if (req.id === undefined) return null; // Notification
      return {
        jsonrpc: '2.0',
        id: req.id,
        result,
      };
    } catch (err: unknown) {
      if (req.id === undefined) return null;
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: JSONRPC_ERROR_CODES.INTERNAL_ERROR,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
