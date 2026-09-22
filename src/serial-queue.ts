import { AcpCancelledError } from "./errors.ts";

interface QueueItem<T> {
  readonly work: () => Promise<T>;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
  started: boolean;
  onAbort: (() => void) | undefined;
}

export class SerialQueue {
  #items: Array<QueueItem<unknown>> = [];
  #active = false;

  get activeCount(): number {
    return this.#active ? 1 : 0;
  }

  get queuedCount(): number {
    return this.#items.length;
  }

  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new AcpCancelledError());

    return new Promise<T>((resolvePromise, reject) => {
      const item: QueueItem<T> = {
        work,
        signal,
        resolve: resolvePromise,
        reject,
        started: false,
        onAbort: undefined,
      };
      if (signal) {
        item.onAbort = () => {
          if (item.started) return;
          const index = this.#items.indexOf(item as QueueItem<unknown>);
          if (index >= 0) this.#items.splice(index, 1);
          reject(new AcpCancelledError());
          this.#startNext();
        };
        signal.addEventListener("abort", item.onAbort, { once: true });
      }
      this.#items.push(item as QueueItem<unknown>);
      this.#startNext();
    });
  }

  #startNext(): void {
    if (this.#active) return;
    const item = this.#items.shift();
    if (!item) return;
    if (item.signal?.aborted) {
      if (item.onAbort) item.signal.removeEventListener("abort", item.onAbort);
      item.reject(new AcpCancelledError());
      this.#startNext();
      return;
    }

    this.#active = true;
    item.started = true;
    if (item.signal && item.onAbort) {
      item.signal.removeEventListener("abort", item.onAbort);
    }
    Promise.resolve()
      .then(() => {
        if (item.signal?.aborted) throw new AcpCancelledError();
        return item.work();
      })
      .then(item.resolve, item.reject)
      .finally(() => {
        this.#active = false;
        this.#startNext();
      });
  }
}
