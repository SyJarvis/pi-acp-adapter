import type * as acp from "@agentclientprotocol/sdk";

export interface PermissionUi {
  select(
    title: string,
    options: string[],
    config?: { signal?: AbortSignal },
  ): Promise<string | undefined>;
}

export interface PermissionContext {
  readonly mode: string;
  readonly hasUI: boolean;
  readonly ui: PermissionUi;
}

export async function requestPermissionFromPi(
  request: acp.RequestPermissionRequest,
  context: PermissionContext,
  signal: AbortSignal,
  isCurrent: () => boolean = () => true,
): Promise<acp.RequestPermissionResponse> {
  const cancelled: acp.RequestPermissionResponse = { outcome: { outcome: "cancelled" } };
  if (signal.aborted || !isCurrent() || !context.hasUI) {
    return cancelled;
  }
  const labels = request.options.map(option =>
    option.name + " [" + option.optionId + "] (" + option.kind + ")"
  );
  const selected = await context.ui.select(
    "ACP permission: " + request.toolCall.toolCallId,
    labels,
    { signal },
  );
  if (!selected || signal.aborted || !isCurrent()) return cancelled;
  const index = labels.indexOf(selected);
  const option = request.options[index];
  return option
    ? { outcome: { outcome: "selected", optionId: option.optionId } }
    : cancelled;
}
