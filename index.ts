import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveAgentConfig, formatConfigStatus } from "./src/config.ts";
import { runAcpTask } from "./src/acp-runner.ts";
import { isCancellation } from "./src/errors.ts";
import { requestPermissionFromPi } from "./src/permissions.ts";
import { RuntimeOwner, combineSignals } from "./src/runtime-owner.ts";

export default function acpAdapter(pi: ExtensionAPI): void {
  const owner = new RuntimeOwner();

  pi.registerTool({
    name: "acp_delegate",
    label: "ACP Delegate",
    description: "Delegate one well-scoped task to the configured ACP v1 stdio agent. The default agent is the package-local Codex ACP executable. Returns the agent's text response; progress is bounded.",
    promptSnippet: "Delegate a focused task to the configured ACP agent (Codex by default)",
    promptGuidelines: [
      "Use acp_delegate for one focused, self-contained delegated task; include the complete goal and relevant constraints in task.",
    ],
    parameters: Type.Object({
      task: Type.String({ minLength: 1, description: "Complete task for the ACP agent" }),
    }),
    async execute(_toolCallId, params, piSignal, onUpdate, ctx) {
      if (!params.task.trim()) throw new Error("ACP delegation failed: task must not be blank");
      const cwd = resolve(ctx.cwd);
      try {
        return await owner.run(async invocation => {
          const signal = combineSignals(piSignal, invocation.signal);
          const config = resolveAgentConfig();
          const result = await runAcpTask({
            task: params.task,
            cwd,
            config,
            signal,
            isCurrent: invocation.isCurrent,
            onUpdate: partial => {
              if (invocation.isCurrent()) onUpdate?.(partial);
            },
            requestPermission: request => requestPermissionFromPi(
              request,
              ctx,
              signal,
              invocation.isCurrent,
            ),
          });
          return {
            content: [{ type: "text" as const, text: result.text }],
            details: result.details,
          };
        });
      } catch (error) {
        if (isCancellation(error) || piSignal?.aborted) {
          return {
            content: [{ type: "text" as const, text: "ACP delegation cancelled." }],
            details: {
              agent: "ACP",
              cwd,
              updates: [],
              cancelled: true,
            },
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error("ACP delegation failed: " + message, { cause: error });
      }
    },
  });

  pi.registerCommand("acp", {
    description: "Show ACP delegation status",
    handler: async (_args, ctx: ExtensionContext) => {
      let status: string;
      try {
        status = formatConfigStatus(resolveAgentConfig()) +
          "; active invocations: " + owner.activeCount;
      } catch (error) {
        status = "ACP configuration error: " +
          (error instanceof Error ? error.message : String(error)) +
          "; active invocations: " + owner.activeCount;
      }
      if (ctx.hasUI) ctx.ui.notify(status, owner.activeCount === 0 ? "info" : "warning");
    },
  });

  pi.on("session_shutdown", async () => {
    await owner.shutdown();
  });
}
