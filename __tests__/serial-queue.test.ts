import { describe, expect, it, vi } from "vitest";
import { AcpCancelledError } from "../src/errors.ts";
import { RuntimeOwner } from "../src/runtime-owner.ts";
import { SerialQueue } from "../src/serial-queue.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("SerialQueue", () => {
  it("runs work serially and reports active and queued counts", async () => {
    const queue = new SerialQueue();
    const release = deferred<void>();
    const started = deferred<void>();
    const order: string[] = [];

    const first = queue.run(async () => {
      order.push("first-start");
      started.resolve();
      await release.promise;
      order.push("first-end");
      return 1;
    });
    const second = queue.run(async () => {
      order.push("second");
      return 2;
    });

    await started.promise;
    expect(queue.activeCount).toBe(1);
    expect(queue.queuedCount).toBe(1);
    expect(order).toEqual(["first-start"]);
    release.resolve();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(queue.activeCount).toBe(0);
    expect(queue.queuedCount).toBe(0);
  });

  it("removes cancelled queued work without starting it", async () => {
    const queue = new SerialQueue();
    const release = deferred<void>();
    const started = deferred<void>();
    const queuedWork = vi.fn(async () => "second");
    const controller = new AbortController();

    const first = queue.run(async () => {
      started.resolve();
      await release.promise;
    });
    const second = queue.run(queuedWork, controller.signal);
    await started.promise;
    controller.abort();

    await expect(second).rejects.toBeInstanceOf(AcpCancelledError);
    expect(queuedWork).not.toHaveBeenCalled();
    expect(queue.queuedCount).toBe(0);
    release.resolve();
    await first;
  });

  it("does not start work cancelled before its scheduled microtask", async () => {
    const queue = new SerialQueue();
    const controller = new AbortController();
    const work = vi.fn(async () => "result");

    const result = queue.run(work, controller.signal);
    controller.abort();

    await expect(result).rejects.toBeInstanceOf(AcpCancelledError);
    expect(work).not.toHaveBeenCalled();
  });

  it("does not start queued work when its runtime owner shuts down", async () => {
    const owner = new RuntimeOwner();
    const queue = new SerialQueue();
    const started = deferred<void>();
    const queuedWork = vi.fn(async () => "queued");

    const first = owner.run(context => queue.run(async () => {
      started.resolve();
      await new Promise<never>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(new AcpCancelledError()), {
          once: true,
        });
      });
    }, context.signal));
    const second = owner.run(context => queue.run(queuedWork, context.signal));
    const firstOutcome = first.catch(error => error);
    const secondOutcome = second.catch(error => error);

    await started.promise;
    await owner.shutdown();

    expect(await firstOutcome).toBeInstanceOf(AcpCancelledError);
    expect(await secondOutcome).toBeInstanceOf(AcpCancelledError);
    expect(queuedWork).not.toHaveBeenCalled();
    expect(queue.activeCount).toBe(0);
    expect(queue.queuedCount).toBe(0);
  });
});
