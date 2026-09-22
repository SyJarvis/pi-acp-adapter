# pi-acp-delegate

A Pi extension that delegates focused tasks from Pi to Agent Client Protocol (ACP) v1 coding agents over stdio. One resumable ACP session is bound to the current linear Pi branch by default, while every invocation still uses a short-lived child process. The default agent is the package-local `@agentclientprotocol/codex-acp@1.12.0` executable; no runtime `npx` download is used.

This package makes Pi the ACP client; it does not expose Pi as an ACP agent or server.

## Requirements

- Node.js 20 or newer
- Pi
- Authentication and model configuration required by the selected ACP agent

## Install

Install the published package from npm:

```sh
pi install npm:pi-acp-delegate
```

For a temporary trial without changing Pi settings:

```sh
pi -e npm:pi-acp-delegate
```

For source or local development:

```sh
git clone https://github.com/SyJarvis/pi-acp-delegate.git
cd pi-acp-delegate
npm install
pi install .
```

Pi records the local package path in its settings. The package manifest loads `index.ts` through `pi.extensions`. For a local one-off run without changing Pi settings:

```sh
pi -e .
```

Inside Pi, `/acp` shows the resolved agent command, active and queued work, and whether the current branch has a compatible bound session. When delegation work is idle, `/acp new` appends a branch-local reset marker so the next delegation creates a fresh ACP session; the command is rejected while delegation work is active or queued. The model can call the single `acp_delegate` tool with a required, nonblank `task`.

## Default Codex agent

With no adapter environment variables, each `acp_delegate` call starts the installed `@agentclientprotocol/codex-acp` binary using `process.execPath`. The child resumes the branch's persisted Codex thread when a compatible binding exists. Codex ACP uses the Codex authentication and model configuration available in the environment where Pi runs.

The adapter does not run `npx`, install packages at delegation time, or keep an ACP child alive between calls. Process lifetime and ACP session lifetime are distinct: `session/close` frees resources in the current child but does not delete or archive the persisted Codex thread.

## Examples

See the [default Codex ACP example](examples/codex/README.md) for a portable
launcher and a read-only smoke-test workflow in any target repository.

## Configuration

All overrides are process environment variables read when a delegation starts:

| Variable | Meaning | Default |
| --- | --- | --- |
| `PI_ACP_COMMAND` | Executable used to start the ACP agent | Current Node executable with the package-local Codex ACP bin |
| `PI_ACP_ARGS` | JSON array of string arguments | `[]` for an override; resolved Codex ACP bin for the default |
| `PI_ACP_ENV` | JSON object of string environment additions or overrides for the child | `{}` |
| `PI_ACP_LABEL` | Agent label shown in status and tool details | `Codex ACP` or the configured command |

`PI_ACP_ARGS` requires `PI_ACP_COMMAND`. Invalid JSON, non-string arguments, and non-string environment values are rejected before a child starts. The child inherits Pi's environment, with `PI_ACP_ENV` values applied last.

Custom ACP stdio agent override:

```sh
export PI_ACP_COMMAND=/path/to/acp-agent
export PI_ACP_ARGS='["--stdio"]'
export PI_ACP_ENV='{"CUSTOM_AGENT_MODEL":"your-configured-model"}'
export PI_ACP_LABEL='Custom ACP'
pi -e .
```

## Permissions and security

ACP permission options are dynamic. In an interactive Pi UI or RPC UI, the adapter presents the exact options supplied by the agent through `ctx.ui.select` and returns the selected `optionId` unchanged. It never auto-approves. A dismissed prompt, an abort, a stale session callback, or a headless Pi mode returns ACP `cancelled`.

The adapter advertises no client file-system or terminal capabilities. This prevents the ACP agent from using ACP client callbacks for those operations. It does not sandbox the child process: extensions and configured commands run with the operating-system permissions and inherited environment of Pi. Review any ACP agent and command before configuring it.

The model cannot choose the child working directory. The adapter resolves `ctx.cwd` to an absolute path and uses it for process spawn plus `session/new` or `session/resume`.

Resumable bindings are stored as versioned Pi custom entries, which do not enter model context. A binding contains the ACP session ID, absolute working directory, and a hashed identity derived from the configured source, command, and arguments. `PI_ACP_ENV` values and credentials are never stored in the binding. Changing the working directory or agent identity makes an older binding incompatible.

`/acp new` only records a reset marker. It never calls `session/delete`, so any agent-side persisted thread remains subject to that agent's own retention and deletion controls.

## Lifecycle and limits

The first call on a branch without a compatible binding follows this sequence:

1. Spawn one child and connect ACP NDJSON over its stdin/stdout.
2. Send `initialize` with protocol version `1` and verify the response is exactly the SDK's `PROTOCOL_VERSION`.
3. Send `session/new`. If the agent advertises `sessionCapabilities.resume`, immediately store the returned session ID in the active Pi branch.
4. Send one `session/prompt` containing the task.
5. Aggregate `agent_message_chunk` text for the final response while emitting lifecycle-only progress.
6. Send `session/close` only when the agent advertised that capability.
7. Close the transport and reap the child.

Later compatible calls spawn a new child, initialize it, send `session/resume` for the stored ID, and then prompt it. The adapter does not use `session/load`. If a stored binding exists but resume is no longer advertised, or if resume fails, the call returns an explicit error and does not silently create a replacement session. Use `/acp new` when a fresh collaboration is wanted.

Agents without resume support keep the previous stateless behavior: every invocation creates a new session and no binding is stored. Calls sharing the default collaboration context are serialized, including the initial creation, so simultaneous first calls cannot create competing bindings. Cancelled queued work never starts.

The first delegated task must be self-contained because the ACP agent cannot see earlier Pi-only conversation. Follow-ups may rely on facts or results already sent to the same ACP session, but each call should still state a clear current goal and acceptance criteria.

A newly created Pi session naturally starts without a binding. Resuming a Pi session recovers the compatible binding from its active branch. Forking a Pi session or navigating the session tree appends a reset marker on the resulting branch, preventing two Pi branches from continuing to mutate the same ACP thread.

On abort, the adapter sends `session/cancel` after a session exists, allows a short grace period, closes stdin, then uses bounded `SIGTERM` and `SIGKILL` fallbacks. Pi `session_shutdown` aborts and awaits every active call idempotently. Late update and permission callbacks are fenced after shutdown.

In Pi's TUI, the submitted task and successful final response are collapsed to a short preview by default and shown in full when tool details are expanded. The row reports Starting, Running, Waiting for permission, Completed, Failed, or Cancelled as applicable. Partial tool updates contain lifecycle state only; ACP thoughts, command output, file events, plans, and other intermediate updates are not rendered.

Final response text is limited to 50,000 characters. Completed result details retain up to 64 update events, with text in each event limited to about 500 characters. Child stderr is bounded and included only in thrown failure diagnostics, never in successful tool output. The adapter aggregates text only; other ACP updates remain bounded metadata.

## Validation

Run the deterministic unit and fake-agent integration suite:

```sh
npm run typecheck
npm test
npm pack --dry-run
```

The test fixture is an SDK-based ACP agent. It covers new and resumed sessions, no-resume fallback, explicit resume errors, protocol negotiation, absolute working directories, streamed text, optional close, exact permission outcomes, cancellation and forced process termination, malformed/early transport failures, binding/reset resolution, serialized cancellation, command/event wiring, shutdown fencing, configuration parsing, and output bounds.

## Maintainer documentation

See [Publishing a Pi Package](docs/publishing.md) for the npm, runtime verification, tagging, release, and gallery indexing procedure.

## Real smoke tests

These commands invoke real model-backed agents and can consume credentials or quota. Confirm the corresponding agent is authenticated and has a model configured before running them.

Default Codex ACP:

```sh
pi -e .
```

In Pi, run `/acp`, then ask Pi to call `acp_delegate` with a small read-only task such as returning a one-sentence description of the current repository.
