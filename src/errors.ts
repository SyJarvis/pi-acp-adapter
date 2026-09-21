import { RequestError } from "@agentclientprotocol/sdk";

const MAX_ERROR_CHARS = 2_000;
const MAX_DATA_DEPTH = 4;
const MAX_DATA_ITEMS = 20;
const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|privatekey|secret|token|apikey)$/;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.replace(/[^a-z0-9]/gi, "").toLowerCase());
}

export class AcpCancelledError extends Error {
  constructor(message = "ACP delegation cancelled") {
    super(message);
    this.name = "AcpCancelledError";
  }
}

export class AcpAdapterError extends Error {
  readonly stderr: string | undefined;

  constructor(message: string, stderr?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AcpAdapterError";
    this.stderr = stderr;
  }
}

export function isCancellation(error: unknown): error is AcpCancelledError {
  return error instanceof AcpCancelledError;
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error);
  if (!(error instanceof RequestError) || error.data === undefined) return message;

  const data = formatErrorData(error.data);
  return data ? `${message}\nACP error data: ${data}` : message;
}

export function boundedText(value: string, maxChars = MAX_ERROR_CHARS): string {
  if (value.length <= maxChars) return value;
  return value.slice(-maxChars) + "\n[diagnostic truncated]";
}

function boundedErrorData(value: string): string {
  if (value.length <= MAX_ERROR_CHARS) return value;
  return value.slice(0, MAX_ERROR_CHARS) + "\n[diagnostic truncated]";
}

export function formatErrorData(data: unknown): string {
  const seen = new WeakSet<object>();
  const sanitize = (value: unknown, depth: number): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value !== "object") return String(value);
    if (depth >= MAX_DATA_DEPTH) return "[max depth]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_DATA_ITEMS).map(item => sanitize(item, depth + 1));
      if (value.length > MAX_DATA_ITEMS) items.push(`[${value.length - MAX_DATA_ITEMS} more items]`);
      return items;
    }

    const result: Record<string, unknown> = {};
    const entries = Object.entries(value).slice(0, MAX_DATA_ITEMS);
    for (const [key, item] of entries) {
      result[key] = isSensitiveKey(key) ? "[redacted]" : sanitize(item, depth + 1);
    }
    const remaining = Object.keys(value).length - entries.length;
    if (remaining > 0) result["[truncated]"] = `${remaining} more properties`;
    return result;
  };

  try {
    const formatted = typeof data === "string" ? data : JSON.stringify(sanitize(data, 0));
    return boundedErrorData(formatted);
  } catch {
    return "[unserializable error data]";
  }
}

export function asAdapterError(error: unknown, stderr: string): AcpAdapterError {
  const diagnostic = boundedText(stderr.trim());
  const baseMessage = errorMessage(error);
  const message = diagnostic && !baseMessage.includes("\nACP stderr:\n")
    ? baseMessage + "\nACP stderr:\n" + diagnostic
    : baseMessage;
  return new AcpAdapterError(message, diagnostic || undefined, {
    cause: error instanceof Error ? error : undefined,
  });
}
