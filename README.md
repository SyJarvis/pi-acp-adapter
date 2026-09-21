# pi-acp-delegate

A Pi extension that delegates focused tasks from Pi to short-lived Agent Client Protocol (ACP) v1 coding agents over stdio. The default agent is the package-local `@agentclientprotocol/codex-acp@1.12.0` executable; no runtime `npx` download is used.

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

Inside Pi, `/acp` shows the resolved agent command and current active invocation count. The model can call the single `acp_delegate` tool with a required, nonblank `task`.

## Default Codex agent

With no adapter environment variables, each `acp_delegate` call starts the installed `@agentclientprotocol/codex-acp` binary using `process.execPath`. Codex ACP uses the Codex authentication and model configuration available in the environment where Pi runs.

The adapter does not run `npx`, install packages at delegation time, or keep an ACP child alive between calls.

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

The model cannot choose the child working directory. The adapter resolves `ctx.cwd` to an absolute path and uses it for both process spawn and `session/new`.

## Lifecycle and limits

Each call follows this sequence:

1. Spawn one child and connect ACP NDJSON over its stdin/stdout.
2. Send `initialize` with protocol version `1` and verify the response is exactly the SDK's `PROTOCOL_VERSION`.
3. Send `session/new`, then one `session/prompt` containing the task.
4. Aggregate `agent_message_chunk` text and return bounded progress/details.
5. Send `session/close` only when the agent advertised that capability.
6. Close the transport and reap the child.

On abort, the adapter sends `session/cancel` after a session exists, allows a short grace period, closes stdin, then uses bounded `SIGTERM` and `SIGKILL` fallbacks. Pi `session_shutdown` aborts and awaits every active call idempotently. Late update and permission callbacks are fenced after shutdown.

Final response text is limited to 50,000 characters. Progress text is limited to 4,000 characters, retained update details to 64 events, and text in each detail event to about 500 characters. Child stderr is bounded and included only in thrown failure diagnostics, never in successful tool output. The adapter aggregates text only; other ACP updates remain bounded metadata.

## Validation

Run the deterministic unit and fake-agent integration suite:

```sh
npm run typecheck
npm test
npm pack --dry-run
```

The test fixture is an SDK-based ACP agent. It covers protocol negotiation, absolute working directories, streamed text, optional close, exact permission outcomes, cancellation and forced process termination, malformed/early transport failures, shutdown fencing, configuration parsing, and output bounds.

## Maintainer documentation

See [Publishing a Pi Package](docs/publishing.md) for the npm, runtime verification, tagging, release, and gallery indexing procedure.

## Real smoke tests

These commands invoke real model-backed agents and can consume credentials or quota. Confirm the corresponding agent is authenticated and has a model configured before running them.

Default Codex ACP:

```sh
pi -e .
```

In Pi, run `/acp`, then ask Pi to call `acp_delegate` with a small read-only task such as returning a one-sentence description of the current repository.
