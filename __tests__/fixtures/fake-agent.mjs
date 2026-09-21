#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const mode = process.env.FAKE_ACP_MODE ?? "happy";
const logPath = process.env.FAKE_ACP_LOG;
const sessionId = "fake-session";
let promptController;

function log(event, data = {}) {
  if (logPath) appendFileSync(logPath, JSON.stringify({ event, ...data }) + "\n");
}

if (mode === "early-exit") {
  process.stderr.write("early fixture failure\n");
  process.exit(23);
}

if (mode === "malformed") {
  process.stderr.write("malformed fixture diagnostic\n");
  process.stdout.write("{not-json}\n");
  setTimeout(() => process.exit(24), 25);
} else {
  const app = acp.agent({ name: "pi-acp-test-agent" })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      log("initialize", params);
      return {
        protocolVersion: mode === "protocol-mismatch" ? acp.PROTOCOL_VERSION + 1 : acp.PROTOCOL_VERSION,
        agentCapabilities: {
          sessionCapabilities: mode === "no-close" ? {} : { close: {} },
        },
        agentInfo: { name: "pi-acp-test-agent", version: "1.0.0" },
      };
    })
    .onRequest(acp.methods.agent.session.new, ({ params }) => {
      log("session/new", params);
      if (mode === "session-new-error") {
        throw acp.RequestError.internalError("actionable fixture detail");
      }
      return { sessionId };
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      log("session/prompt", params);
      if (mode === "permission") {
        const outcome = await client.request(acp.methods.client.session.requestPermission, {
          sessionId,
          toolCall: {
            toolCallId: "permission-call",
            title: "Modify a file",
            kind: "edit",
            status: "pending",
          },
          options: [
            { optionId: "allow-exact", name: "Allow", kind: "allow_once" },
            { optionId: "deny-exact", name: "Deny", kind: "reject_once" },
          ],
        });
        log("permission-response", outcome);
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: JSON.stringify(outcome) },
          },
        });
        return { stopReason: "end_turn" };
      }
      if (mode === "hang" || mode === "ignore-term") {
        promptController = new AbortController();
        await new Promise(resolve => promptController.signal.addEventListener("abort", resolve, { once: true }));
        return { stopReason: "cancelled" };
      }
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello " },
        },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "world" },
        },
      });
      return { stopReason: "end_turn" };
    })
    .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
      log("session/cancel", params);
      promptController?.abort();
    })
    .onRequest(acp.methods.agent.session.close, ({ params }) => {
      log("session/close", params);
      return {};
    });

  const stream = acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin),
  );
  const connection = app.connect(stream);
  connection.closed.then(() => {
    log("connection/closed");
    if (mode !== "ignore-term") process.exit(0);
  });
  if (mode === "ignore-term") {
    process.on("SIGTERM", () => log("sigterm"));
    setInterval(() => {}, 1_000);
  }
}
