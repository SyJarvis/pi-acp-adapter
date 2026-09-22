import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveAgentConfig, formatConfigStatus } from "./src/config.ts";
import { runAcpTask } from "./src/acp-runner.ts";
import { isCancellation } from "./src/errors.ts";
import { requestPermissionFromPi } from "./src/permissions.ts";
import { RuntimeOwner, combineSignals } from "./src/runtime-owner.ts";
import { lifecycleUpdate } from "./src/lifecycle.ts";
import { acpDelegateRenderers } from "./src/tool-renderer.ts";
import { SerialQueue } from "./src/serial-queue.ts";
import {
  ACP_SESSION_ENTRY_TYPE,
  agentIdentityKey,
  createSessionBinding,
  createSessionReset,
  resolveSessionBinding,
} from "./src/session-binding.ts";

export default function acpAdapter(pi: ExtensionAPI): void {
  const owner = new RuntimeOwner();
  const queue = new SerialQueue();
  let bindingGeneration = 0;

  const resetBinding = () => {
    bindingGeneration += 1;
    pi.appendEntry(ACP_SESSION_ENTRY_TYPE, createSessionReset());
  };

  pi.registerTool({
    name: "acp_delegate",
    label: "ACP Delegate",
    description: "Delegate a focused task to the configured ACP v1 stdio agent. The current Pi branch reuses one resumable ACP collaboration session while each invocation uses a short-lived child process. The first task must be self-contained because the ACP agent cannot see prior Pi-only conversation.",
    promptSnippet: "Delegate a clear task to the branch's ACP collaborator (Codex by default)",
    promptGuidelines: [
      "On the first delegation, include all relevant Pi-only context because the ACP agent cannot see the prior Pi conversation.",
      "Follow-up delegations may rely on facts and results already sent to this branch's ACP session, but every call still needs a clear current goal and acceptance criteria.",
    ],
    parameters: Type.Object({
      task: Type.String({ minLength: 1, description: "Complete task for the ACP agent" }),
    }),
    ...acpDelegateRenderers,
    async execute(_toolCallId, params, piSignal, onUpdate, ctx) {
      if (!params.task.trim()) throw new Error("ACP delegation failed: task must not be blank");
      const cwd = resolve(ctx.cwd);
      try {
        return await owner.run(async invocation => {
          const signal = combineSignals(piSignal, invocation.signal);
          return queue.run(async () => {
            const config = resolveAgentConfig();
            const agentKey = agentIdentityKey(config);
            const binding = resolveSessionBinding(ctx.sessionManager.getBranch(), {
              cwd,
              agentKey,
            });
            const generation = bindingGeneration;
            if (invocation.isCurrent()) {
              onUpdate?.(lifecycleUpdate("starting", config.label, cwd));
            }
            const result = await runAcpTask({
              task: params.task,
              cwd,
              config,
              signal,
              isCurrent: invocation.isCurrent,
              ...(binding ? { sessionId: binding.sessionId } : {}),
              onSessionEstablished: session => {
                if (
                  session.resumable &&
                  generation === bindingGeneration &&
                  invocation.isCurrent() &&
                  !signal.aborted
                ) {
                  pi.appendEntry(
                    ACP_SESSION_ENTRY_TYPE,
                    createSessionBinding(session.sessionId, cwd, agentKey),
                  );
                }
              },
              onUpdate: partial => {
                if (invocation.isCurrent()) onUpdate?.(partial);
              },
              requestPermission: async request => {
                if (invocation.isCurrent()) {
                  onUpdate?.(lifecycleUpdate("waiting_permission", config.label, cwd));
                }
                try {
                  return await requestPermissionFromPi(
                    request,
                    ctx,
                    signal,
                    invocation.isCurrent,
                  );
                } finally {
                  if (invocation.isCurrent() && !signal.aborted) {
                    onUpdate?.(lifecycleUpdate("running", config.label, cwd));
                  }
                }
              },
            });
            return {
              content: [{ type: "text" as const, text: result.text }],
              details: result.details,
            };
          }, signal);
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
    description: "Show ACP status or reset the branch collaboration with /acp new",
    handler: async (args, ctx: ExtensionContext) => {
      const argument = args.trim();
      if (argument === "new") {
        if (owner.activeCount > 0) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Cannot reset ACP collaboration while delegation work is active or queued. Wait for all active and queued work to finish.",
              "warning",
            );
          }
          return;
        }
        resetBinding();
        if (ctx.hasUI) {
          ctx.ui.notify("ACP collaboration reset; the next delegation will create a new session.", "info");
        }
        return;
      }
      if (argument) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /acp [new]", "warning");
        return;
      }

      let status: string;
      try {
        const config = resolveAgentConfig();
        const cwd = resolve(ctx.cwd);
        const binding = resolveSessionBinding(ctx.sessionManager.getBranch(), {
          cwd,
          agentKey: agentIdentityKey(config),
        });
        status = formatConfigStatus(config) +
          "; active: " + queue.activeCount +
          "; queued: " + queue.queuedCount +
          "; branch session: " + (binding ? "bound" : "none");
      } catch (error) {
        status = "ACP configuration error: " +
          (error instanceof Error ? error.message : String(error)) +
          "; active: " + queue.activeCount +
          "; queued: " + queue.queuedCount +
          "; branch session: unavailable";
      }
      if (ctx.hasUI) ctx.ui.notify(status, owner.activeCount === 0 ? "info" : "warning");
    },
  });

  pi.on("session_start", event => {
    if (event.reason === "fork") resetBinding();
  });

  pi.on("session_tree", () => {
    resetBinding();
  });

  pi.on("session_shutdown", async () => {
    await owner.shutdown();
  });
}
