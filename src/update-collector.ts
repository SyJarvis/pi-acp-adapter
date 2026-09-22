import type * as acp from "@agentclientprotocol/sdk";
import { lifecycleUpdate } from "./lifecycle.ts";

const MAX_FINAL_CHARS = 50_000;
const MAX_EVENT_TEXT_CHARS = 500;
const MAX_EVENTS = 64;
const UPDATE_INTERVAL_MS = 100;

export interface AcpProgressEvent {
  readonly kind: string;
  readonly text?: string;
  readonly toolCallId?: string;
  readonly status?: string;
}

export interface AcpDelegateDetails {
  readonly agent: string;
  readonly cwd: string;
  readonly updates: readonly AcpProgressEvent[];
  readonly stopReason?: string;
  readonly truncated?: boolean;
  readonly cancelled?: boolean;
}

export interface PartialToolResult {
  readonly content: Array<{ type: "text"; text: string }>;
  readonly details: AcpDelegateDetails;
}

type SessionUpdate = acp.SessionNotification["update"];
type OnUpdate = (result: PartialToolResult) => void;

function textFromContent(content: unknown): string | undefined {
  if (!content || typeof content !== "object") return undefined;
  const block = content as { type?: unknown; text?: unknown };
  return block.type === "text" && typeof block.text === "string" ? block.text : undefined;
}

function short(value: string): string {
  return value.length <= MAX_EVENT_TEXT_CHARS
    ? value
    : value.slice(0, MAX_EVENT_TEXT_CHARS) + "...";
}

function eventFromUpdate(update: SessionUpdate): AcpProgressEvent {
  const value = update as unknown as Record<string, unknown>;
  const kind = typeof value.sessionUpdate === "string" ? value.sessionUpdate : "update";
  const text = textFromContent(value.content);
  const title = typeof value.title === "string" ? value.title : undefined;
  const toolCallId = typeof value.toolCallId === "string" ? value.toolCallId : undefined;
  const status = typeof value.status === "string" ? value.status : undefined;
  return {
    kind,
    ...(text || title ? { text: short(text ?? title ?? "") } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(status ? { status } : {}),
  };
}

export class UpdateCollector {
  readonly #agent: string;
  readonly #cwd: string;
  readonly #onUpdate: OnUpdate | undefined;
  readonly #isCurrent: () => boolean;
  readonly #events: AcpProgressEvent[] = [];
  #message = "";
  #truncated = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: {
    agent: string;
    cwd: string;
    onUpdate?: OnUpdate;
    isCurrent?: () => boolean;
  }) {
    this.#agent = options.agent;
    this.#cwd = options.cwd;
    this.#onUpdate = options.onUpdate;
    this.#isCurrent = options.isCurrent ?? (() => true);
  }

  accept(update: SessionUpdate): void {
    if (!this.#isCurrent()) return;
    const event = eventFromUpdate(update);
    if (this.#events.length === MAX_EVENTS) this.#events.shift();
    this.#events.push(event);

    const value = update as unknown as Record<string, unknown>;
    if (value.sessionUpdate === "agent_message_chunk") {
      const text = textFromContent(value.content);
      if (text) this.#appendMessage(text);
    }
    this.#schedule();
  }

  finish(stopReason?: string): { text: string; details: AcpDelegateDetails } {
    this.#flush();
    const text = this.#message.trim() || "ACP agent completed without a text response.";
    return { text, details: this.snapshot(stopReason) };
  }

  snapshot(stopReason?: string): AcpDelegateDetails {
    return {
      agent: this.#agent,
      cwd: this.#cwd,
      updates: [...this.#events],
      ...(stopReason ? { stopReason } : {}),
      ...(this.#truncated ? { truncated: true } : {}),
    };
  }

  #appendMessage(text: string): void {
    const remaining = MAX_FINAL_CHARS - this.#message.length;
    if (remaining <= 0) {
      this.#truncated = true;
      return;
    }
    this.#message += text.slice(0, remaining);
    if (text.length > remaining) this.#truncated = true;
  }

  #schedule(): void {
    if (!this.#onUpdate || this.#timer) return;
    this.#timer = setTimeout(() => this.#flush(), UPDATE_INTERVAL_MS);
  }

  #flush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.#onUpdate || !this.#isCurrent()) return;
    this.#onUpdate(lifecycleUpdate("running", this.#agent, this.#cwd));
  }
}
