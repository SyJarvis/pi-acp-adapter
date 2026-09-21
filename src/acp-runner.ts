import { resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentConfig } from "./config.ts";
import { AcpProcess } from "./acp-process.ts";
import { AcpAdapterError, AcpCancelledError, asAdapterError } from "./errors.ts";
import {
  UpdateCollector,
  type AcpDelegateDetails,
  type PartialToolResult,
} from "./update-collector.ts";

const CANCEL_GRACE_MS = 300;
const CLOSE_GRACE_MS = 300;
const CLIENT_INFO: acp.Implementation = { name: "pi-acp-delegate", version: "0.1.0" };

export interface AcpRunResult {
  readonly text: string;
  readonly details: AcpDelegateDetails;
}

export interface AcpRunOptions {
  readonly task: string;
  readonly cwd: string;
  readonly config: AgentConfig;
  readonly signal?: AbortSignal;
  readonly onUpdate?: (result: PartialToolResult) => void;
  readonly requestPermission: (
    request: acp.RequestPermissionRequest,
  ) => Promise<acp.RequestPermissionResponse>;
  readonly isCurrent?: () => boolean;
  readonly onSpawn?: (child: ChildProcessWithoutNullStreams) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function abortPromise(signal: AbortSignal | undefined): Promise<never> {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.reject(new AcpCancelledError());
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new AcpCancelledError()), { once: true });
  });
}

async function requestBeforeAbort<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  request.catch(() => {});
  return Promise.race([request, abortPromise(signal)]);
}

async function boundedRequest<T>(request: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  request.catch(() => {});
  return Promise.race([request, delay(timeoutMs).then(() => undefined)]);
}

export async function runAcpTask(options: AcpRunOptions): Promise<AcpRunResult> {
  const task = options.task.trim();
  if (!task) throw new AcpAdapterError("task must contain non-whitespace text");
  const cwd = resolve(options.cwd);
  const collector = new UpdateCollector({
    agent: options.config.label,
    cwd,
    ...(options.onUpdate ? { onUpdate: options.onUpdate } : {}),
    ...(options.isCurrent ? { isCurrent: options.isCurrent } : {}),
  });

  let process: AcpProcess | undefined;
  let connection: ReturnType<ReturnType<typeof acp.client>["connect"]> | undefined;
  let sessionId: string | undefined;
  let cancelled = false;
  let cancelSent = false;

  try {
    if (options.signal?.aborted) throw new AcpCancelledError();
    process = await AcpProcess.start({
      config: options.config,
      cwd,
      ...(options.onSpawn ? { onSpawn: options.onSpawn } : {}),
    });
    const stream = acp.ndJsonStream(
      Writable.toWeb(process.child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(process.child.stdout) as unknown as ReadableStream<Uint8Array>,
    );

    connection = acp.client({ name: "pi-acp-delegate" })
      .onNotification(acp.methods.client.session.update, context => {
        collector.accept(context.params.update);
      })
      .onRequest(acp.methods.client.session.requestPermission, context => {
        if (options.signal?.aborted || options.isCurrent?.() === false) {
          return { outcome: { outcome: "cancelled" } };
        }
        return options.requestPermission(context.params);
      })
      .connect(stream);

    const agent = connection.agent;
    const initialized = await requestBeforeAbort(agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: CLIENT_INFO,
    }), options.signal);
    if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new AcpAdapterError(
        "ACP protocol version mismatch: expected " + acp.PROTOCOL_VERSION +
          ", received " + initialized.protocolVersion,
      );
    }

    const session = await requestBeforeAbort(agent.request(acp.methods.agent.session.new, {
      cwd,
      mcpServers: [],
    }), options.signal);
    sessionId = session.sessionId;

    const sendCancel = async () => {
      if (cancelSent || !sessionId) return;
      cancelSent = true;
      try {
        await agent.notify(acp.methods.agent.session.cancel, { sessionId });
      } catch {
        // The transport may already be closed.
      }
    };
    const onAbort = () => {
      cancelled = true;
      void sendCancel();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const prompt = agent.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text: task }],
    });
    prompt.catch(() => {});

    let promptResult: Awaited<typeof prompt> | undefined;
    try {
      if (!options.signal) {
        promptResult = await prompt;
      } else {
        const outcome = await Promise.race([
          prompt.then(value => ({ kind: "result" as const, value })),
          abortPromise(options.signal).catch(() => ({ kind: "cancel" as const })),
        ]);
        if (outcome.kind === "result") {
          promptResult = outcome.value;
        } else {
          cancelled = true;
          await sendCancel();
          await boundedRequest(prompt, CANCEL_GRACE_MS);
        }
      }
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
    }

    if (cancelled || options.signal?.aborted) throw new AcpCancelledError();
    if (!promptResult) throw new AcpAdapterError("ACP prompt ended without a response");

    if (initialized.agentCapabilities?.sessionCapabilities?.close != null) {
      await boundedRequest(
        agent.request(acp.methods.agent.session.close, { sessionId }),
        CLOSE_GRACE_MS,
      );
    }
    const final = collector.finish(promptResult.stopReason);
    return { text: final.text, details: final.details };
  } catch (error) {
    if (error instanceof AcpCancelledError || options.signal?.aborted || cancelled) {
      throw new AcpCancelledError();
    }
    throw asAdapterError(error, process?.stderr ?? "");
  } finally {
    connection?.close();
    if (process) await process.terminate();
  }
}
