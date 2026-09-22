import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./config.ts";

export const ACP_SESSION_ENTRY_TYPE = "pi-acp-delegate/session";
export const ACP_SESSION_BINDING_VERSION = 1;

export interface AcpSessionBinding {
  readonly version: typeof ACP_SESSION_BINDING_VERSION;
  readonly kind: "binding";
  readonly sessionId: string;
  readonly cwd: string;
  readonly agentKey: string;
}

export interface AcpSessionReset {
  readonly version: typeof ACP_SESSION_BINDING_VERSION;
  readonly kind: "reset";
}

export type AcpSessionEntryData = AcpSessionBinding | AcpSessionReset;

export interface BindingCompatibility {
  readonly cwd: string;
  readonly agentKey: string;
}

export function agentIdentityKey(config: AgentConfig): string {
  const identity = JSON.stringify({
    source: config.source,
    command: config.command,
    args: [...config.args],
  });
  return "sha256:" + createHash("sha256").update(identity).digest("hex");
}

export function createSessionBinding(
  sessionId: string,
  cwd: string,
  agentKey: string,
): AcpSessionBinding {
  if (!sessionId.trim()) throw new Error("ACP session ID must not be blank");
  if (!isAbsolute(cwd)) throw new Error("ACP session binding cwd must be absolute");
  if (!agentKey.trim()) throw new Error("ACP agent identity key must not be blank");
  return {
    version: ACP_SESSION_BINDING_VERSION,
    kind: "binding",
    sessionId,
    cwd: resolve(cwd),
    agentKey,
  };
}

export function createSessionReset(): AcpSessionReset {
  return { version: ACP_SESSION_BINDING_VERSION, kind: "reset" };
}

export function parseSessionEntryData(data: unknown): AcpSessionEntryData | undefined {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return undefined;
  const value = data as Record<string, unknown>;
  if (value.version !== ACP_SESSION_BINDING_VERSION) return undefined;
  if (value.kind === "reset") return { version: ACP_SESSION_BINDING_VERSION, kind: "reset" };
  if (
    value.kind !== "binding" ||
    typeof value.sessionId !== "string" || !value.sessionId.trim() ||
    typeof value.cwd !== "string" || !isAbsolute(value.cwd) ||
    typeof value.agentKey !== "string" || !value.agentKey.trim()
  ) {
    return undefined;
  }
  return {
    version: ACP_SESSION_BINDING_VERSION,
    kind: "binding",
    sessionId: value.sessionId,
    cwd: resolve(value.cwd),
    agentKey: value.agentKey,
  };
}

export function resolveSessionBinding(
  branch: readonly SessionEntry[],
  compatibility: BindingCompatibility,
): AcpSessionBinding | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "custom" || entry.customType !== ACP_SESSION_ENTRY_TYPE) continue;

    // The newest entry is authoritative even when malformed or incompatible. This
    // prevents an older binding from resurfacing after a reset or config change.
    const data = parseSessionEntryData(entry.data);
    if (
      data?.kind === "binding" &&
      data.cwd === resolve(compatibility.cwd) &&
      data.agentKey === compatibility.agentKey
    ) {
      return data;
    }
    return undefined;
  }
  return undefined;
}
