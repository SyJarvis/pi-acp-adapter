import * as acp from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { errorMessage, formatErrorData } from "../src/errors.ts";

describe("ACP error diagnostics", () => {
  it("includes structured RequestError data without changing ordinary errors", () => {
    const error = acp.RequestError.internalError({
      provider: "fixture-provider",
      model: "fixture-model",
    });

    expect(errorMessage(error)).toContain("Internal error");
    expect(errorMessage(error)).toContain(
      'ACP error data: {"provider":"fixture-provider","model":"fixture-model"}',
    );
    expect(errorMessage(new Error("ordinary failure"))).toBe("ordinary failure");
  });

  it("handles cyclic data and redacts sensitive fields", () => {
    const data: Record<string, unknown> = {
      provider: "fixture-provider",
      accessToken: "must-not-leak",
    };
    data.self = data;

    const diagnostic = formatErrorData(data);
    expect(diagnostic).toContain('"provider":"fixture-provider"');
    expect(diagnostic).toContain('"accessToken":"[redacted]"');
    expect(diagnostic).toContain('"self":"[circular]"');
    expect(diagnostic).not.toContain("must-not-leak");
  });

  it("bounds large error data", () => {
    const diagnostic = formatErrorData("x".repeat(10_000));

    expect(diagnostic.length).toBeLessThanOrEqual(2_024);
    expect(diagnostic).toContain("[diagnostic truncated]");
  });
});
