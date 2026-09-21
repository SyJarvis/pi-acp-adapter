import type * as acp from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { requestPermissionFromPi } from "../src/permissions.ts";

const request: acp.RequestPermissionRequest = {
  sessionId: "session",
  toolCall: {
    toolCallId: "call",
    title: "Run operation",
    status: "pending",
  },
  options: [
    { optionId: "first-id", name: "Same", kind: "allow_once" },
    { optionId: "second-id", name: "Same", kind: "reject_once" },
  ],
};

const cancelled: acp.RequestPermissionResponse = { outcome: { outcome: "cancelled" } };

describe("requestPermissionFromPi", () => {
  it("returns the exact selected option id even when names match", async () => {
    const signal = new AbortController().signal;
    const result = await requestPermissionFromPi(
      request,
      {
        mode: "rpc",
        hasUI: true,
        ui: { select: async (_title, options) => options[1] },
      },
      signal,
    );
    expect(result).toEqual({ outcome: { outcome: "selected", optionId: "second-id" } });
  });

  it.each([
    { name: "headless", hasUI: false, stale: false, aborted: false, selected: undefined },
    { name: "stale", hasUI: true, stale: true, aborted: false, selected: undefined },
    { name: "aborted", hasUI: true, stale: false, aborted: true, selected: undefined },
    { name: "dismissed", hasUI: true, stale: false, aborted: false, selected: undefined },
  ])("cancels when $name", async ({ hasUI, stale, aborted, selected }) => {
    const controller = new AbortController();
    if (aborted) controller.abort();
    const select = vi.fn(async () => selected);
    const result = await requestPermissionFromPi(
      request,
      { mode: hasUI ? "tui" : "print", hasUI, ui: { select } },
      controller.signal,
      () => !stale,
    );
    expect(result).toEqual(cancelled);
    if (!hasUI || stale || aborted) expect(select).not.toHaveBeenCalled();
  });

  it("cancels when the invocation becomes stale while the dialog is open", async () => {
    let current = true;
    const result = await requestPermissionFromPi(
      request,
      {
        mode: "tui",
        hasUI: true,
        ui: {
          select: async (_title, options) => {
            current = false;
            return options[0];
          },
        },
      },
      new AbortController().signal,
      () => current,
    );
    expect(result).toEqual(cancelled);
  });
});
