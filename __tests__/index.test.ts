import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpRunOptions } from "../src/acp-runner.ts";
import { ACP_SESSION_ENTRY_TYPE } from "../src/session-binding.ts";

const mocks = vi.hoisted(() => ({ runAcpTask: vi.fn() }));

vi.mock("../src/acp-runner.ts", () => ({
  runAcpTask: mocks.runAcpTask,
}));

import acpAdapter from "../index.ts";

interface CapturedTool {
  execute(
    toolCallId: string,
    params: { task: string },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ): Promise<unknown>;
}

interface CapturedCommand {
  handler(args: string, ctx: ExtensionContext): Promise<void>;
}

type EventHandler = (event: unknown, ctx: ExtensionContext) => void | Promise<void>;

function harness() {
  const branch: SessionEntry[] = [];
  const appended: Array<{ customType: string; data: unknown }> = [];
  const handlers = new Map<string, EventHandler[]>();
  const notify = vi.fn();
  let tool: CapturedTool | undefined;
  let command: CapturedCommand | undefined;

  const pi = {
    registerTool(value: CapturedTool) { tool = value; },
    registerCommand(name: string, value: CapturedCommand) {
      if (name === "acp") command = value;
    },
    appendEntry(customType: string, data: unknown) {
      appended.push({ customType, data });
      branch.push({
        type: "custom",
        id: `entry-${branch.length}`,
        parentId: branch.at(-1)?.id ?? null,
        timestamp: "2026-01-01T00:00:00.000Z",
        customType,
        data,
      });
    },
    on(name: string, handler: EventHandler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    cwd: process.cwd(),
    mode: "tui",
    hasUI: true,
    ui: { notify },
    sessionManager: { getBranch: () => [...branch] },
  } as unknown as ExtensionContext;

  acpAdapter(pi);
  if (!tool || !command) throw new Error("Extension registrations were not captured");
  return { appended, branch, command, ctx, handlers, notify, tool };
}

beforeEach(() => {
  mocks.runAcpTask.mockReset();
  mocks.runAcpTask.mockImplementation(async (options: AcpRunOptions) => {
    if (!options.sessionId) {
      options.onSessionEstablished?.({ sessionId: "persisted-session", resumable: true });
    }
    return {
      text: "done",
      details: { agent: "Fixture", cwd: options.cwd, updates: [], stopReason: "end_turn" },
    };
  });
});

describe("extension session binding wiring", () => {
  it("persists a new resumable session and supplies it to the next serialized invocation", async () => {
    const { appended, ctx, tool } = harness();

    await tool.execute("first", { task: "initial task" }, undefined, undefined, ctx);
    await tool.execute("second", { task: "follow-up" }, undefined, undefined, ctx);

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      customType: ACP_SESSION_ENTRY_TYPE,
      data: { kind: "binding", sessionId: "persisted-session", cwd: process.cwd() },
    });
    expect((mocks.runAcpTask.mock.calls[0]![0] as AcpRunOptions).sessionId).toBeUndefined();
    expect((mocks.runAcpTask.mock.calls[1]![0] as AcpRunOptions).sessionId)
      .toBe("persisted-session");
  });

  it("does not persist a session when the initialized agent cannot resume", async () => {
    mocks.runAcpTask.mockImplementationOnce(async (options: AcpRunOptions) => {
      options.onSessionEstablished?.({ sessionId: "one-shot", resumable: false });
      return {
        text: "done",
        details: { agent: "Fixture", cwd: options.cwd, updates: [], stopReason: "end_turn" },
      };
    });
    const { appended, ctx, tool } = harness();

    await tool.execute("first", { task: "one-shot task" }, undefined, undefined, ctx);

    expect(appended).toHaveLength(0);
  });

  it("implements /acp status, reset, and unknown-argument usage without deleting sessions", async () => {
    const { appended, command, ctx, notify, tool } = harness();
    await tool.execute("first", { task: "initial task" }, undefined, undefined, ctx);

    await command.handler("", ctx);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("branch session: bound"), "info");

    await command.handler("new", ctx);
    expect(appended.at(-1)).toEqual({
      customType: ACP_SESSION_ENTRY_TYPE,
      data: { version: 1, kind: "reset" },
    });
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("next delegation"), "info");

    const count = appended.length;
    await command.handler("unexpected", ctx);
    expect(appended).toHaveLength(count);
    expect(notify).toHaveBeenLastCalledWith("Usage: /acp [new]", "warning");
  });

  it("rejects /acp new while delegation work is active", async () => {
    let resolveTask: (() => void) | undefined;
    mocks.runAcpTask.mockImplementationOnce(async (options: AcpRunOptions) => {
      await new Promise<void>(resolve => { resolveTask = resolve; });
      return {
        text: "done",
        details: { agent: "Fixture", cwd: options.cwd, updates: [], stopReason: "end_turn" },
      };
    });
    const { appended, command, ctx, notify, tool } = harness();

    const pending = tool.execute("first", { task: "pending task" }, undefined, undefined, ctx);
    await vi.waitFor(() => expect(mocks.runAcpTask).toHaveBeenCalledOnce());
    try {
      await command.handler("new", ctx);

      expect(appended).toHaveLength(0);
      expect(notify).toHaveBeenLastCalledWith(
        "Cannot reset ACP collaboration while delegation work is active or queued. Wait for all active and queued work to finish.",
        "warning",
      );
    } finally {
      resolveTask?.();
      await pending;
    }
  });

  it("appends tombstones after forks and tree navigation only", async () => {
    const { appended, ctx, handlers } = harness();
    const start = handlers.get("session_start")![0]!;
    const tree = handlers.get("session_tree")![0]!;

    await start({ type: "session_start", reason: "resume" }, ctx);
    expect(appended).toHaveLength(0);
    await start({ type: "session_start", reason: "fork" }, ctx);
    await tree({ type: "session_tree", newLeafId: "new", oldLeafId: "old" }, ctx);

    expect(appended).toHaveLength(2);
    expect(appended.every(item => (
      item.customType === ACP_SESSION_ENTRY_TYPE &&
      (item.data as { kind?: string }).kind === "reset"
    ))).toBe(true);
  });
});
