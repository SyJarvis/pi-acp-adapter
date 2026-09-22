import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, Text, type Component } from "@earendil-works/pi-tui";
import type { AcpDelegateDetails } from "./update-collector.ts";
import { lifecycleFromPartial } from "./lifecycle.ts";

const COLLAPSED_LINES = 3;
const COLLAPSED_CHARS = 360;

interface DelegateArgs {
  task: string;
}

interface RenderContext {
  readonly lastComponent: Component | undefined;
  readonly executionStarted: boolean;
  readonly expanded: boolean;
  readonly isError: boolean;
}

interface RenderOptions {
  readonly expanded: boolean;
  readonly isPartial: boolean;
}

function textComponent(context: RenderContext, content: string): Text {
  const text = context.lastComponent instanceof Text
    ? context.lastComponent
    : new Text("", 0, 0);
  text.setText(content);
  return text;
}

function normalizedText(value: string): string {
  // The TUI helper removes complete ANSI/OSC/APC sequences. Filtering residual
  // controls makes unsupported or malformed sequences inert as well.
  const withoutTerminalSequences = stripTerminalSequences(value.replace(/\r\n?/g, "\n"));
  let safe = "";
  for (const character of withoutTerminalSequences) {
    const codePoint = character.codePointAt(0);
    if (
      character === "\n" ||
      character === "\t" ||
      (codePoint !== undefined &&
        codePoint >= 0x20 &&
        codePoint !== 0x7f &&
        !(codePoint >= 0x80 && codePoint <= 0x9f) &&
        !(codePoint >= 0xd800 && codePoint <= 0xdfff) &&
        !(codePoint >= 0xfff9 && codePoint <= 0xfffb))
    ) {
      safe += character;
    }
  }
  return safe.trim();
}

export function displayText(value: string, expanded: boolean): {
  readonly text: string;
  readonly truncated: boolean;
} {
  const full = normalizedText(value);
  if (expanded || !full) return { text: full, truncated: false };

  const lines = full.split("\n");
  let preview = lines.slice(0, COLLAPSED_LINES).join("\n");
  let truncated = lines.length > COLLAPSED_LINES;
  if (preview.length > COLLAPSED_CHARS) {
    preview = preview.slice(0, COLLAPSED_CHARS).trimEnd();
    truncated = true;
  }
  return { text: preview, truncated };
}

function expandSuffix(theme: Theme): string {
  return theme.fg("muted", "\n… (toggle tool details to expand)");
}

function styledStatus(
  status: "Starting" | "Running" | "Waiting for permission" | "Completed" | "Failed" | "Cancelled",
  theme: Theme,
): string {
  const color = status === "Completed"
    ? "success"
    : status === "Failed"
      ? "error"
      : status === "Cancelled" || status === "Waiting for permission"
        ? "warning"
        : "accent";
  return theme.fg(color, status);
}

function textOutput(result: AgentToolResult<AcpDelegateDetails>): string {
  return result.content
    .filter((content): content is Extract<typeof content, { type: "text" }> => content.type === "text")
    .map(content => content.text)
    .join("\n");
}

export const acpDelegateRenderers = {
  renderCall(
    args: DelegateArgs,
    theme: Theme,
    context: RenderContext,
  ): Component {
    let content = theme.fg("toolTitle", theme.bold("ACP Delegate"));
    if (!context.executionStarted) {
      content += theme.fg("muted", " · ") + styledStatus("Starting", theme);
    }

    const task = displayText(args.task ?? "", context.expanded);
    content += "\n" + theme.fg("muted", "Task: ") + theme.fg("toolOutput", task.text || "(empty)");
    if (task.truncated) content += expandSuffix(theme);
    return textComponent(context, content);
  },

  renderResult(
    result: AgentToolResult<AcpDelegateDetails>,
    options: RenderOptions,
    theme: Theme,
    context: RenderContext,
  ): Component {
    if (options.isPartial) {
      const active = lifecycleFromPartial(result);
      const status = active === "waiting_permission"
        ? "Waiting for permission"
        : active === "starting"
          ? "Starting"
          : "Running";
      return textComponent(
        context,
        theme.fg("muted", "Status: ") + styledStatus(status, theme),
      );
    }

    const cancelled = result.details?.cancelled === true;
    const status = context.isError ? "Failed" : cancelled ? "Cancelled" : "Completed";
    let content = theme.fg("muted", "Status: ") + styledStatus(status, theme);

    if (status === "Completed") {
      const output = displayText(textOutput(result), options.expanded);
      if (output.text) {
        content += "\n" + theme.fg("muted", "Result: ") + theme.fg("toolOutput", output.text);
        if (output.truncated) content += expandSuffix(theme);
      }
    }
    return textComponent(context, content);
  },
};
