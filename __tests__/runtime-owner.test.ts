import { describe, expect, it, vi } from "vitest";
import { AcpCancelledError } from "../src/errors.ts";
import { RuntimeOwner } from "../src/runtime-owner.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("RuntimeOwner", () => {
  it("aborts active work, fences stale callbacks, and shuts down idempotently", async () => {
    const owner = new RuntimeOwner();
    const started = deferred<void>();
    const callback = vi.fn();
    let currentDuringRun = false;
    let currentAfterAbort = true;

    const run = owner.run(async context => {
      currentDuringRun = context.isCurrent();
      started.resolve();
      await new Promise<void>(resolve => {
        context.signal.addEventListener("abort", () => {
          currentAfterAbort = context.isCurrent();
          if (context.isCurrent()) callback();
          resolve();
        }, { once: true });
      });
      throw new AcpCancelledError();
    });

    await started.promise;
    expect(owner.activeCount).toBe(1);
    const firstShutdown = owner.shutdown();
    const secondShutdown = owner.shutdown();
    expect(secondShutdown).toBe(firstShutdown);
    await firstShutdown;
    await expect(run).rejects.toBeInstanceOf(AcpCancelledError);

    expect(currentDuringRun).toBe(true);
    expect(currentAfterAbort).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    expect(owner.activeCount).toBe(0);
    expect(owner.stopped).toBe(true);
    await expect(owner.run(async () => undefined)).rejects.toBeInstanceOf(AcpCancelledError);
  });
});
