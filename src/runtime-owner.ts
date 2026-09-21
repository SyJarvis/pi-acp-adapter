import { AcpCancelledError } from "./errors.ts";

interface ActiveInvocation {
  readonly controller: AbortController;
  settled: Promise<unknown>;
}

export interface InvocationContext {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}

export class RuntimeOwner {
  #active = new Map<number, ActiveInvocation>();
  #nextId = 1;
  #stopped = false;
  #shutdownPromise: Promise<void> | undefined;

  get activeCount(): number {
    return this.#active.size;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  run<T>(work: (context: InvocationContext) => Promise<T>): Promise<T> {
    if (this.#stopped) return Promise.reject(new AcpCancelledError("ACP runtime is shut down"));
    const id = this.#nextId++;
    const controller = new AbortController();
    const active: ActiveInvocation = { controller, settled: Promise.resolve() };
    this.#active.set(id, active);
    const isCurrent = () => !this.#stopped && this.#active.get(id) === active;
    const promise = Promise.resolve().then(() => work({ signal: controller.signal, isCurrent }));
    active.settled = promise.catch(() => undefined).finally(() => {
      if (this.#active.get(id) === active) this.#active.delete(id);
    });
    return promise;
  }

  shutdown(reason = "Pi session shut down"): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    this.#stopped = true;
    const active = [...this.#active.values()];
    for (const invocation of active) invocation.controller.abort(new AcpCancelledError(reason));
    this.#shutdownPromise = Promise.allSettled(active.map(item => item.settled)).then(() => {});
    return this.#shutdownPromise;
  }
}

export function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const available = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (available.length === 0) return new AbortController().signal;
  if (available.length === 1) return available[0]!;
  if (typeof AbortSignal.any === "function") return AbortSignal.any(available);

  const controller = new AbortController();
  const aborted = available.find(signal => signal.aborted);
  if (aborted) {
    controller.abort(aborted.reason);
    return controller.signal;
  }
  const onAbort = (event: Event) => {
    for (const signal of available) signal.removeEventListener("abort", onAbort);
    controller.abort((event.target as AbortSignal).reason);
  };
  for (const signal of available) signal.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
