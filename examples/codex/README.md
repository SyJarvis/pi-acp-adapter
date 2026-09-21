# Codex ACP example

This example runs Pi with the adapter's package-local Codex ACP agent. It
requires Node.js 20 or newer, Pi on `PATH`, `npm install` in the adapter
repository, and Codex authentication and model configuration available to
`@agentclientprotocol/codex-acp`.

Set `ADAPTER_ROOT` to your adapter checkout, install its dependencies, and run
the launcher while your shell is in any target repository:

```sh
ADAPTER_ROOT=/path/to/pi-acp-adapter
(cd "$ADAPTER_ROOT" && npm install)

cd /path/to/target-repository
(
  unset PI_ACP_COMMAND PI_ACP_ARGS PI_ACP_ENV PI_ACP_LABEL
  "$ADAPTER_ROOT/examples/codex/run.sh"
)
```

Do not set any `PI_ACP_*` variables for this example. The subshell above
removes overrides only for that Pi process and does not change persistent shell
configuration.

In Pi, run `/acp`. The status should identify the default Codex ACP command.
Then use this prompt:

```text
Use acp_delegate to inspect the current repository without modifying files.
Return at most five bullets: a brief purpose, up to three key files with their
roles, and one concrete risk.
```

The delegated session should use the target repository's absolute path as its
working directory, stream bounded progress, return a bounded result, and reap
the short-lived Codex ACP child after the single prompt completes.

The ACP child inherits Pi's environment and operating-system permissions. It
is not sandboxed.

If Codex reports an authentication or model configuration error, configure
Codex for `@agentclientprotocol/codex-acp` in the same environment that starts
Pi, then retry. If `/acp` reports an unexpected command or label, inspect
`env` for `PI_ACP_*` variables and launch again with the subshell above.
