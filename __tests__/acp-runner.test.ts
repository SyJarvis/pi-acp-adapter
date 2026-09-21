import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { runAcpTask } from "../src/acp-runner.ts";
import type { AgentConfig } from "../src/config.ts";
import { AcpAdapterError, AcpCancelledError } from "../src/errors.ts";
import { requestPermissionFromPi } from "../src/permissions.ts";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-agent.mjs");
const tempDirs: string[] = [];

interface FixtureEvent {
  event: string;
  [key: string]: unknown;
}

function fixtureRun(mode: string): {
  config: AgentConfig;
  readEvents(): FixtureEvent[];
} {
  const directory = mkdtempSync(resolve(tmpdir(), "pi-acp-delegate-"));
  tempDirs.push(directory);
  const logPath = resolve(directory, "events.jsonl");
  return {
    config: {
      label: "Fixture ACP",
      command: process.execPath,
      args: [fixture],
      env: { FAKE_ACP_MODE: mode, FAKE_ACP_LOG: logPath },
      source: "environment",
    },
    readEvents() {
      if (!existsSync(logPath)) return [];
      return readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line) as FixtureEvent);
    },
  };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("runAcpTask", () => {
  it("runs the ACP v1 happy flow and closes an advertised session", async () => {
    const fixtureProcess = fixtureRun("happy");
    let child: ChildProcessWithoutNullStreams | undefined;

    const result = await runAcpTask({
      task: "  inspect the project  ",
      cwd: ".",
      config: fixtureProcess.config,
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      onSpawn: spawned => { child = spawned; },
    });

    expect(result.text).toBe("hello world");
    expect(result.details).toMatchObject({
      agent: "Fixture ACP",
      cwd: process.cwd(),
      stopReason: "end_turn",
    });
    expect(result.details).not.toHaveProperty("stderr");
    expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);

    const events = fixtureProcess.readEvents();
    const initialize = events.find(event => event.event === "initialize");
    expect(initialize).toMatchObject({
      protocolVersion: acp.PROTOCOL_VERSION,
    });
    expect(initialize?.clientInfo).toEqual({ name: "pi-acp-delegate", version: "0.1.0" });
    expect(events.find(event => event.event === "session/new")).toMatchObject({
      cwd: process.cwd(),
      mcpServers: [],
    });
    expect(events.find(event => event.event === "session/prompt")).toMatchObject({
      sessionId: "fake-session",
      prompt: [{ type: "text", text: "inspect the project" }],
    });
    expect(events.find(event => event.event === "session/close")).toMatchObject({
      sessionId: "fake-session",
    });
  });

  it("does not close a session when close is not advertised", async () => {
    const fixtureProcess = fixtureRun("no-close");
    await runAcpTask({
      task: "test",
      cwd: process.cwd(),
      config: fixtureProcess.config,
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    });
    expect(fixtureProcess.readEvents().some(event => event.event === "session/close")).toBe(false);
  });

  it("rejects an exact protocol version mismatch", async () => {
    const fixtureProcess = fixtureRun("protocol-mismatch");
    await expect(runAcpTask({
      task: "test",
      cwd: process.cwd(),
      config: fixtureProcess.config,
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    })).rejects.toThrow(
      `ACP protocol version mismatch: expected ${acp.PROTOCOL_VERSION}, received ${acp.PROTOCOL_VERSION + 1}`,
    );
  });

  it("returns the exact permission option selected through Pi UI", async () => {
    const fixtureProcess = fixtureRun("permission");
    const result = await runAcpTask({
      task: "request permission",
      cwd: process.cwd(),
      config: fixtureProcess.config,
      requestPermission: request => requestPermissionFromPi(
        request,
        {
          mode: "tui",
          hasUI: true,
          ui: { select: async (_title, options) => options[1] },
        },
        new AbortController().signal,
      ),
    });

    expect(JSON.parse(result.text)).toEqual({
      outcome: { outcome: "selected", optionId: "deny-exact" },
    });
    expect(fixtureProcess.readEvents().find(event => event.event === "permission-response"))
      .toMatchObject({ outcome: { outcome: "selected", optionId: "deny-exact" } });
  });

  it.each(["hang", "ignore-term"])(
    "sends session/cancel and reaps an aborted %s child",
    async mode => {
      const fixtureProcess = fixtureRun(mode);
      const controller = new AbortController();
      let child: ChildProcessWithoutNullStreams | undefined;
      const run = runAcpTask({
        task: "wait",
        cwd: process.cwd(),
        config: fixtureProcess.config,
        signal: controller.signal,
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
        onSpawn: spawned => { child = spawned; },
      });

      await waitForEvent(fixtureProcess.readEvents, "session/prompt");
      controller.abort();
      await expect(run).rejects.toBeInstanceOf(AcpCancelledError);

      const events = fixtureProcess.readEvents();
      expect(events.find(event => event.event === "session/cancel")).toMatchObject({
        sessionId: "fake-session",
      });
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
      if (mode === "ignore-term") {
        expect(events.some(event => event.event === "sigterm")).toBe(true);
        expect(child?.signalCode).toBe("SIGKILL");
      }
    },
    5_000,
  );

  it("includes bounded RequestError data from session/new", async () => {
    const fixtureProcess = fixtureRun("session-new-error");
    let failure: unknown;
    try {
      await runAcpTask({
        task: "test",
        cwd: process.cwd(),
        config: fixtureProcess.config,
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AcpAdapterError);
    const message = (failure as AcpAdapterError).message;
    expect(message).toContain("Internal error");
    expect(message).toContain("actionable fixture detail");
    expect(message.length).toBeLessThanOrEqual(2_100);
  });

  it.each(["early-exit", "malformed"])(
    "includes bounded stderr when the %s transport fails",
    async mode => {
      const fixtureProcess = fixtureRun(mode);
      let failure: unknown;
      try {
        await runAcpTask({
          task: "test",
          cwd: process.cwd(),
          config: fixtureProcess.config,
          requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(AcpAdapterError);
      const error = failure as AcpAdapterError;
      expect(error.message).toContain("ACP stderr:");
      expect(error.message).toContain(mode === "early-exit"
        ? "early fixture failure"
        : "malformed fixture diagnostic");
      expect(error.stderr?.length).toBeLessThanOrEqual(2_024);
    },
  );
});

async function waitForEvent(readEvents: () => FixtureEvent[], name: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (readEvents().some(event => event.event === name)) return;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
  }
  throw new Error(`Timed out waiting for fixture event ${name}`);
}
