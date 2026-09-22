import type { PartialToolResult } from "./update-collector.ts";

export type ActiveLifecycleState = "starting" | "running" | "waiting_permission";

const LIFECYCLE_TEXT: Record<ActiveLifecycleState, string> = {
  starting: "ACP delegation starting.",
  running: "ACP delegation running.",
  waiting_permission: "ACP delegation waiting for permission.",
};

export function lifecycleUpdate(
  state: ActiveLifecycleState,
  agent: string,
  cwd: string,
): PartialToolResult {
  return {
    content: [{ type: "text", text: LIFECYCLE_TEXT[state] }],
    // Progress details intentionally exclude ACP events. The completed result still
    // carries the collector's full, bounded details contract.
    details: { agent, cwd, updates: [] },
  };
}

export function lifecycleFromPartial(result: {
  content: Array<{ type: string; text?: string }>;
}): ActiveLifecycleState {
  const texts = result.content
    .filter(content => content.type === "text")
    .map(content => content.text);
  if (texts.includes(LIFECYCLE_TEXT.waiting_permission)) return "waiting_permission";
  if (texts.includes(LIFECYCLE_TEXT.starting)) return "starting";
  return "running";
}
