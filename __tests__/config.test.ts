import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENV_ARGS,
  ENV_COMMAND,
  ENV_ENV,
  ENV_LABEL,
  formatConfigStatus,
  resolveAgentConfig,
} from "../src/config.ts";

describe("resolveAgentConfig", () => {
  it("uses the package-local Codex ACP binary without npx", () => {
    const config = resolveAgentConfig({});
    expect(config).toMatchObject({
      label: "Codex ACP",
      command: process.execPath,
      source: "codex-default",
      env: {},
    });
    expect(config.args).toHaveLength(1);
    expect(isAbsolute(config.args[0]!)).toBe(true);
    expect(config.args[0]).toContain("node_modules/@agentclientprotocol/codex-acp/");
    expect(readFileSync(config.args[0]!, "utf8").length).toBeGreaterThan(0);
    expect(formatConfigStatus(config)).not.toContain("npx");
  });

  it("parses a custom ACP command, JSON args, env, and label", () => {
    expect(resolveAgentConfig({
      [ENV_COMMAND]: "/usr/bin/custom-acp-agent",
      [ENV_ARGS]: '["--stdio","--profile","test"]',
      [ENV_ENV]: '{"CUSTOM_AGENT_MODEL":"configured-model"}',
      [ENV_LABEL]: "Custom ACP",
    })).toEqual({
      label: "Custom ACP",
      command: "/usr/bin/custom-acp-agent",
      args: ["--stdio", "--profile", "test"],
      env: { CUSTOM_AGENT_MODEL: "configured-model" },
      source: "environment",
    });
  });

  it.each([
    [{ [ENV_ARGS]: '["-m"]' }, `${ENV_ARGS} requires ${ENV_COMMAND}`],
    [{ [ENV_COMMAND]: "python", [ENV_ARGS]: "not-json" }, `${ENV_ARGS} must be a JSON array of strings`],
    [{ [ENV_COMMAND]: "python", [ENV_ARGS]: "[1]" }, `${ENV_ARGS} must be a JSON array of strings`],
    [{ [ENV_COMMAND]: "python", [ENV_ENV]: "[]" }, `${ENV_ENV} must be a JSON object with string values`],
    [{ [ENV_COMMAND]: "python", [ENV_ENV]: '{"KEY":1}' }, `${ENV_ENV} must be a JSON object with string values`],
  ])("rejects invalid environment configuration", (env, message) => {
    expect(() => resolveAgentConfig(env)).toThrow(message);
  });
});
