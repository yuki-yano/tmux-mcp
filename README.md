# Tmux MCP Server

A Bun/Node-compatible TypeScript toolkit that exposes tmux pane context and logs through the Model Context Protocol (MCP). It lets MCP-compatible assistants inspect and troubleshoot your live tmux session.

## Requirements
- Node.js 20+
- Bun 1.2+
- tmux installed on the host machine

## Configure MCP Agents
MCP-capable tools should launch the server themselves. Configure each agent to run `bunx @yuki-yano/tmux-mcp@latest` (or `npx @yuki-yano/tmux-mcp@latest`) as a command provider; there is no need to start the server manually.

## MCP Tool Reference
All tools live under the `tmux` namespace. Validation is handled with Zod; requests outside these shapes are rejected and surface as `tool call failed` errors.

### `tmux.describe-context`
- **Purpose**: identify the most relevant tmux pane and provide ranked alternatives.
- **Request fields (optional)**:
  - `paneHint`: string matched against pane id/title/session/window/command.
  - `tags`: string[] placeholder for future tagged panes (accepted but unused).
- **Response**: `{ primaryPane, candidates }` where each pane includes `{ id, title, session, window, command? }`.

### `tmux.fetch-log`
- **Purpose**: take a one-off log snapshot from a tmux pane or file.
- **Required field**: `mode` must be `"capture"` or `"file"`.
- **When to use**: choose `mode: "capture"` for panes, `mode: "file"` for local log files. Use `tmux.stream-log` for anything that needs to keep streaming.

#### Capture mode (pane snapshot)
- `paneId` — tmux pane id (for example `"%305"`).
- `lines` — positive integer ≤ 10_000; defaults to `TMUX_CONTEXT_CAPTURE_LINES` (2000 if unset).
- `filters` — optional `timeRange`, `keywords`, `levels` filters.
- `maskPatterns` — strings or regex fragments replaced with `***`.
- `summary` — include `{ totalLines, errorCount, firstErrorLine? }`.

```json
{ "mode": "capture", "paneId": "%305", "lines": 400 }
```

#### File mode (log tail)
- `filePath` — absolute path to the log file; response exposes a readable stream.

```json
{ "mode": "file", "filePath": "/var/log/app.log" }
```

> Info: Passing `mode: "tail"` or `mode: "stream"` triggers a validation error. For live streaming call `tmux.stream-log`.

### `tmux.stream-log`
- **Purpose**: manage a live `pipe-pane` stream.
- **Start**: `{ "mode": "stream", "paneId": "%1" }` (the optional `action: "start"` is ignored).
- **Stop**: `{ "mode": "stream", "action": "stop", "streamId": "...", "stopToken": "..." }` using the `id` and `stopToken` returned when you started the stream.
- **Responses**: `{ id, stopToken }` for both start and stop.
- **Errors**: `paneId is required`, `Stream not found: ...`, `Invalid stop token`.

### Typical Failure Scenarios
- Missing required fields (`paneId is required`, `filePath is required`).
- Unsupported `mode` strings supplied to `fetch-log` (the error message includes the valid options).
- Using a stale or incorrect `stopToken` when stopping a stream.

## Example Calls
```jsonc
tmux.describe-context { "paneHint": "%3" }

// Start then stop a live stream (generic MCP JSON-RPC)
{
  "name": "tmux.stream-log",
  "arguments": { "mode": "stream", "paneId": "%1" }
}
{
  "name": "tmux.stream-log",
  "arguments": { "mode": "stream", "action": "stop", "streamId": "…", "stopToken": "…" }
}
```

## Optional Local Installation
If you need to bundle the server with other tooling:
```bash
npm install @yuki-yano/tmux-mcp
# or
bun add @yuki-yano/tmux-mcp
```
Once installed locally, the executable name is `tmux-mcp`, so `npx tmux-mcp` or `bunx tmux-mcp` will resolve to the same CLI.

## Configuration
Environment variables tweak runtime behaviour:

| Variable | Description |
| --- | --- |
| `TMUX_CONTEXT_TMUX_PATH` | Absolute path to the tmux binary (falls back to `$TMUX` or `tmux`). |
| `TMUX_CONTEXT_CAPTURE_LINES` | Default `capture-pane` line count (defaults to 2000). |
| `TMUX_CONTEXT_AUDIT_PATH` | File destination for JSON Lines audit logs (defaults to STDOUT). |
| `NODE_ENV` | When `test`, suppresses info logs for cleaner test output. |

## Developer Notes (for contributors)
- Source lives in `src/` and follows a functional style (no classes or interfaces).
- `src/index.ts` wires dependencies; `src/sdk-server.ts` registers MCP tools via `@modelcontextprotocol/sdk`.
- Supporting modules handle tmux integration, log formatting, file tailing, configuration, and auditing.
- Tests in `tests/` mock external processes/files so they run without tmux.
- `bun run ci` executes formatting, type checks, lint, and tests before publishing.
