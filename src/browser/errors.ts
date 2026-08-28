export type BrowserErrorCode =
  | "SESSION_EXPIRED"
  | "ELEMENT_NOT_FOUND"
  | "NAVIGATION_FAILED"
  | "DOWNLOAD_FAILED"
  | "BROWSER_NOT_READY"
  | "INVALID_ARGUMENT"
  | "OPERATION_FAILED";

export class BrowserError extends Error {
  readonly code: BrowserErrorCode;

  constructor(code: BrowserErrorCode, message: string) {
    super(message);
    this.name = "BrowserError";
    this.code = code;
  }

  toToolMessage(): string {
    return `${this.code}: ${this.message}`;
  }
}

export function isBrowserError(error: unknown): error is BrowserError {
  return error instanceof BrowserError;
}
