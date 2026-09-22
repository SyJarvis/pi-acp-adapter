import type { CustomEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../src/config.ts";
import {
  ACP_SESSION_ENTRY_TYPE,
  agentIdentityKey,
  createSessionBinding,
  createSessionReset,
  parseSessionEntryData,
  resolveSessionBinding,
} from "../src/session-binding.ts";

function entry(data: unknown, id = crypto.randomUUID()): CustomEntry {
  return {
    type: "custom",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: ACP_SESSION_ENTRY_TYPE,
    data,
  };
}

function unrelated(): SessionEntry {
  return {
    type: "custom",
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: "another-extension",
    data: createSessionReset(),
  };
}

describe("ACP session bindings", () => {
  it("creates and parses a versioned binding with an absolute cwd", () => {
    const binding = createSessionBinding("session-1", "/project", "agent-key");

    expect(parseSessionEntryData(binding)).toEqual(binding);
    expect(parseSessionEntryData(createSessionReset())).toEqual({ version: 1, kind: "reset" });
    expect(() => createSessionBinding("session", "relative", "agent-key")).toThrow("absolute");
  });

  it("derives identity from source, command, and args but not label or environment values", () => {
    const config: AgentConfig = {
      source: "environment",
      label: "First label",
      command: "/bin/agent",
      args: ["--stdio"],
      env: { SECRET_TOKEN: "must-not-be-persisted" },
    };
    const equivalent: AgentConfig = {
      ...config,
      label: "Another label",
      env: { SECRET_TOKEN: "different-secret" },
    };

    const key = agentIdentityKey(config);
    expect(key).toBe(agentIdentityKey(equivalent));
    expect(key).not.toContain("must-not-be-persisted");
    expect(key).not.toBe(agentIdentityKey({ ...config, args: ["--other"] }));
  });

  it("resolves only the active branch's newest relevant compatible binding", () => {
    const old = createSessionBinding("old", "/project", "agent-key");
    const latest = createSessionBinding("latest", "/project", "agent-key");
    const branch = [entry(old), unrelated(), entry(latest)];

    expect(resolveSessionBinding(branch, { cwd: "/project", agentKey: "agent-key" }))
      .toEqual(latest);
  });

  it("does not rediscover an older binding after a reset", () => {
    const branch = [
      entry(createSessionBinding("old", "/project", "agent-key")),
      entry(createSessionReset()),
      unrelated(),
    ];

    expect(resolveSessionBinding(branch, { cwd: "/project", agentKey: "agent-key" }))
      .toBeUndefined();
  });

  it.each([
    ["malformed", { version: 1, kind: "binding", sessionId: 42, cwd: "/project", agentKey: "agent-key" }],
    ["wrong version", { version: 2, kind: "binding", sessionId: "new", cwd: "/project", agentKey: "agent-key" }],
  ])("lets a newest %s entry mask an older binding", (_name, newest) => {
    const branch = [
      entry(createSessionBinding("old", "/project", "agent-key")),
      entry(newest),
    ];

    expect(resolveSessionBinding(branch, { cwd: "/project", agentKey: "agent-key" }))
      .toBeUndefined();
  });

  it.each([
    ["cwd", { cwd: "/other", agentKey: "agent-key" }],
    ["agent", { cwd: "/project", agentKey: "other-agent" }],
  ])("rejects a %s-mismatched binding", (_name, compatibility) => {
    const branch = [entry(createSessionBinding("session", "/project", "agent-key"))];
    expect(resolveSessionBinding(branch, compatibility)).toBeUndefined();
  });
});
