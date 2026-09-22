import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { lifecycleUpdate } from "../src/lifecycle.ts";
import { acpDelegateRenderers } from "../src/tool-renderer.ts";
import type { AcpDelegateDetails } from "../src/update-collector.ts";

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as Theme;

function context(overrides: Partial<{
  lastComponent: Component | undefined;
  executionStarted: boolean;
  expanded: boolean;
  isError: boolean;
}> = {}) {
  return {
    lastComponent: undefined,
    executionStarted: true,
    expanded: false,
    isError: false,
    ...overrides,
  };
}

function rendered(component: Component): string {
  return component.render(1_000).map(line => line.trimEnd()).join("\n");
}

function result(
  text: string,
  details: AcpDelegateDetails = { agent: "Agent", cwd: "/project", updates: [] },
): AgentToolResult<AcpDelegateDetails> {
  return { content: [{ type: "text", text }], details };
}

describe("ACP delegate tool renderer", () => {
  it("shows Starting and the submitted task before execution", () => {
    const output = rendered(acpDelegateRenderers.renderCall(
      { task: "Inspect the delegation boundary" },
      theme,
      context({ executionStarted: false }),
    ));

    expect(output).toContain("ACP Delegate · Starting");
    expect(output).toContain("Task: Inspect the delegation boundary");
  });

  it("keeps Starting visible during the startup partial", () => {
    const partial = lifecycleUpdate("starting", "Agent", "/project");
    const output = rendered(acpDelegateRenderers.renderResult(
      partial,
      { expanded: false, isPartial: true },
      theme,
      context(),
    ));

    expect(output).toBe("Status: Starting");
  });

  it("collapses long multiline tasks and restores the full task when expanded", () => {
    const task = [
      "first requirement",
      "second requirement",
      "third requirement",
      "fourth requirement",
      "fifth requirement",
    ].join("\n");

    const collapsed = rendered(acpDelegateRenderers.renderCall(
      { task },
      theme,
      context({ expanded: false }),
    ));
    expect(collapsed).toContain("first requirement\nsecond requirement\nthird requirement");
    expect(collapsed).not.toContain("fourth requirement");
    expect(collapsed).toContain("to expand");

    const expanded = rendered(acpDelegateRenderers.renderCall(
      { task },
      theme,
      context({ expanded: true }),
    ));
    expect(expanded).toContain(task);
    expect(expanded).not.toContain("to expand");
  });

  it("sanitizes terminal sequences and controls in the displayed task", () => {
    const task = "\x1b[31mred task\x1b[0m\nsecond\0 line\x1b]2;forged title\x07\n普通の Unicode 😀\x1b[2J";
    const output = rendered(acpDelegateRenderers.renderCall(
      { task },
      theme,
      context({ expanded: true }),
    ));

    expect(output).toContain("Task: red task\nsecond line\n普通の Unicode 😀");
    expect(output).not.toContain("forged title");
    expect(output).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
  });

  it("renders only Running for arbitrary ACP partial content", () => {
    const partial = result("private thought\ncommand output\nfile event\nplan detail");
    const output = rendered(acpDelegateRenderers.renderResult(
      partial,
      { expanded: true, isPartial: true },
      theme,
      context({ expanded: true }),
    ));

    expect(output).toBe("Status: Running");
    expect(output).not.toMatch(/private thought|command output|file event|plan detail/);
  });

  it("shows Waiting for permission for a permission lifecycle update", () => {
    const partial = lifecycleUpdate("waiting_permission", "Agent", "/project");
    const output = rendered(acpDelegateRenderers.renderResult(
      partial,
      { expanded: false, isPartial: true },
      theme,
      context(),
    ));

    expect(output).toBe("Status: Waiting for permission");
  });

  it("shows Completed with compact final text and the full text when expanded", () => {
    const finalText = ["summary", "change one", "change two", "verification", "residual risk"].join("\n");
    const final = result(finalText);

    const collapsed = rendered(acpDelegateRenderers.renderResult(
      final,
      { expanded: false, isPartial: false },
      theme,
      context(),
    ));
    expect(collapsed).toContain("Status: Completed");
    expect(collapsed).toContain("Result: summary\nchange one\nchange two");
    expect(collapsed).not.toContain("verification");
    expect(collapsed).toContain("to expand");

    const expanded = rendered(acpDelegateRenderers.renderResult(
      final,
      { expanded: true, isPartial: false },
      theme,
      context({ expanded: true }),
    ));
    expect(expanded).toContain("Status: Completed");
    expect(expanded).toContain(finalText);
    expect(expanded).not.toContain("to expand");
  });

  it("sanitizes only the displayed final text and preserves readable lines", () => {
    const finalText = "\x1b[1;35mfinished\x1b[0m\nnext\x08 line\n\x1b]8;;https://example.com\x07linked\x1b]8;;\x07\n完了 ✓\x1b[2K";
    const final = result(finalText);
    const output = rendered(acpDelegateRenderers.renderResult(
      final,
      { expanded: true, isPartial: false },
      theme,
      context({ expanded: true }),
    ));

    expect(output).toContain("Result: finished\nnext line\nlinked\n完了 ✓");
    expect(output).not.toContain("https://example.com");
    expect(output).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
    expect(final).toEqual(result(finalText));
  });

  it.each([
    {
      name: "Failed",
      details: { agent: "Agent", cwd: "/project", updates: [] },
      isError: true,
    },
    {
      name: "Cancelled",
      details: { agent: "Agent", cwd: "/project", updates: [], cancelled: true },
      isError: false,
    },
  ])("shows $name without rendering raw terminal content", ({ name, details, isError }) => {
    const output = rendered(acpDelegateRenderers.renderResult(
      result("internal failure output", details),
      { expanded: true, isPartial: false },
      theme,
      context({ expanded: true, isError }),
    ));

    expect(output).toBe(`Status: ${name}`);
    expect(output).not.toContain("internal failure output");
  });
});
