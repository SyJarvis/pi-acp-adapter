import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentConfig } from "./config.ts";

const MAX_STDERR_CHARS = 8_000;
const EOF_GRACE_MS = 300;
const TERM_GRACE_MS = 500;
const KILL_GRACE_MS = 500;

export interface ProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface AcpProcessOptions {
  readonly config: AgentConfig;
  readonly cwd: string;
  readonly onSpawn?: (child: ChildProcessWithoutNullStreams) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class AcpProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exit: Promise<ProcessExit>;
  #stderr = "";
  #terminatePromise: Promise<ProcessExit> | undefined;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.#stderr = (this.#stderr + chunk).slice(-MAX_STDERR_CHARS);
    });
    child.stdin.on("error", () => {});
    child.stdout.on("error", () => {});
    this.exit = new Promise(resolve => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  }

  static async start(options: AcpProcessOptions): Promise<AcpProcess> {
    const child = spawn(options.config.command, [...options.config.args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.config.env },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const acpProcess = new AcpProcess(child);
    options.onSpawn?.(child);
    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.removeListener("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        child.removeListener("spawn", onSpawn);
        reject(error);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
    return acpProcess;
  }

  get stderr(): string {
    return this.#stderr;
  }

  get exited(): boolean {
    return this.child.exitCode !== null || this.child.signalCode !== null;
  }

  terminate(): Promise<ProcessExit> {
    if (this.#terminatePromise) return this.#terminatePromise;
    this.#terminatePromise = this.#terminate();
    return this.#terminatePromise;
  }

  async #terminate(): Promise<ProcessExit> {
    if (this.exited) return this.exit;
    this.child.stdin.end();
    const eofExit = await this.#wait(EOF_GRACE_MS);
    if (eofExit) return eofExit;

    this.child.kill("SIGTERM");
    const termExit = await this.#wait(TERM_GRACE_MS);
    if (termExit) return termExit;

    this.child.kill("SIGKILL");
    return (await this.#wait(KILL_GRACE_MS)) ?? this.exit;
  }

  async #wait(ms: number): Promise<ProcessExit | undefined> {
    return Promise.race([
      this.exit,
      delay(ms).then(() => undefined),
    ]);
  }
}
