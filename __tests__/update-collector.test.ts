import type * as acp from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateCollector } from "../src/update-collector.ts";

function chunk(text: string): acp.SessionNotification["update"] {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  };
}

afterEach(() => vi.useRealTimers());

describe("UpdateCollector", () => {
  it("bounds final text, detail events, event text, and throttled progress", () => {
    vi.useFakeTimers();
    const updates = vi.fn();
    const collector = new UpdateCollector({ agent: "Agent", cwd: "/tmp/project", onUpdate: updates });

    for (let index = 0; index < 70; index += 1) collector.accept(chunk("x".repeat(1_000)));
    expect(updates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(updates.mock.calls[0]![0].content[0].text.length).toBeLessThanOrEqual(4_000);

    const result = collector.finish("end_turn");
    expect(result.text).toHaveLength(50_000);
    expect(result.details.truncated).toBe(true);
    expect(result.details.updates).toHaveLength(64);
    expect(result.details.updates.every(event => (event.text?.length ?? 0) <= 503)).toBe(true);
  });

  it("drops updates and callbacks after the invocation becomes stale", () => {
    vi.useFakeTimers();
    let current = true;
    const updates = vi.fn();
    const collector = new UpdateCollector({
      agent: "Agent",
      cwd: "/tmp/project",
      onUpdate: updates,
      isCurrent: () => current,
    });
    collector.accept(chunk("kept"));
    current = false;
    collector.accept(chunk("dropped"));
    vi.advanceTimersByTime(100);
    expect(updates).not.toHaveBeenCalled();
    expect(collector.finish().text).toBe("kept");
  });
});
