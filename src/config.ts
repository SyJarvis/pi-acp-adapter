import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export const ENV_COMMAND = "PI_ACP_COMMAND";
export const ENV_ARGS = "PI_ACP_ARGS";
export const ENV_ENV = "PI_ACP_ENV";
export const ENV_LABEL = "PI_ACP_LABEL";

export interface AgentConfig {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly source: "codex-default" | "environment";
}

interface PackageManifest {
  bin?: string | Record<string, string>;
}

function parseStringArray(value: string | undefined, name: string): string[] {
  if (value === undefined || value.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(name + " must be a JSON array of strings");
  }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) {
    throw new Error(name + " must be a JSON array of strings");
  }
  return parsed;
}

function parseStringMap(value: string | undefined, name: string): Record<string, string> {
  if (value === undefined || value.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(name + " must be a JSON object with string values");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(name + " must be a JSON object with string values");
  }
  const entries = Object.entries(parsed);
  if (entries.some(([, item]) => typeof item !== "string")) {
    throw new Error(name + " must be a JSON object with string values");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function resolveCodexBin(): string {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("@agentclientprotocol/codex-acp/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
  const bin = typeof manifest.bin === "string"
    ? manifest.bin
    : manifest.bin?.["codex-acp"];
  if (!bin) {
    throw new Error("@agentclientprotocol/codex-acp does not declare the codex-acp binary");
  }
  return resolve(dirname(manifestPath), bin);
}

export function resolveAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const command = env[ENV_COMMAND]?.trim();
  const args = parseStringArray(env[ENV_ARGS], ENV_ARGS);
  const childEnv = parseStringMap(env[ENV_ENV], ENV_ENV);
  const configuredLabel = env[ENV_LABEL]?.trim();

  if (command) {
    return {
      label: configuredLabel || command,
      command,
      args,
      env: childEnv,
      source: "environment",
    };
  }
  if (args.length > 0) throw new Error(ENV_ARGS + " requires " + ENV_COMMAND);
  return {
    label: configuredLabel || "Codex ACP",
    command: process.execPath,
    args: [resolveCodexBin()],
    env: childEnv,
    source: "codex-default",
  };
}

export function formatConfigStatus(config: AgentConfig): string {
  const kind = config.source === "codex-default" ? "default" : "configured";
  return "ACP agent: " + config.label + " (" + kind + "); command: " +
    [config.command, ...config.args].join(" ");
}
