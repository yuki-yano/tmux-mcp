# tmux-mcp

A Bun/Node-compatible TypeScript toolkit that exposes tmux pane context and logs through the Model Context Protocol (MCP). It lets MCP-compatible assistants inspect and troubleshoot your live tmux session.

## Requirements
- Node.js 20+
- Bun 1.2+
- tmux installed on the host machine

## Run the Server (recommended)
1. Ensure the target tmux session is running.
2. Launch the MCP server with:
   ```bash
   bunx tmux-mcp
   ```
   or, if you prefer npm:
   ```bash
   npx tmux-mcp
   ```
3. Keep the process running; it communicates with clients over STDIN/STDOUT.

## MCP Tool Reference

### `tmux.describe-context`
- **Purpose**: identify the most relevant tmux pane and provide ranked alternatives.
- **Request fields (optional)**:
  - `paneHint`: string matched against pane id/title/session/window/command.
  - `tags`: string[] placeholder for future tagged panes (accepted but unused).
- **Response**: `{ primaryPane, candidates }` where each pane includes `{ id, title, session, window, command? }`.

### `tmux.fetch-log`
- **Purpose**: take a one-off log snapshot from a tmux pane or file.
- **Required field**: `mode` must be `"capture"` or `"file"`.
- **Capture mode** (`mode: "capture"`):
  - `paneId` (required) — tmux pane id (for example `"%305"`).
  - `lines` — positive integer ≤ 10_000; defaults to `TMUX_CONTEXT_CAPTURE_LINES` (2000 if unset).
  - `filters` — optional `timeRange`, `keywords`, `levels` filters.
  - `maskPatterns` — strings or regex fragments replaced with `***`.
  - `summary` — include `{ totalLines, errorCount, firstErrorLine? }`.
- **File mode** (`mode: "file"`):
  - `filePath` (required) — absolute path to the log file; response exposes a readable stream.
- **Invalid modes**: values such as `"tail"`, `"full"`, or `"stream"` cause validation failure. Use `tmux.stream-log` for ongoing streaming.

### `tmux.stream-log`
- **Purpose**: manage a live `pipe-pane` stream.
- **Start**: `{ mode: "stream", paneId: "..." }` (optional `action: "start"` ignored).
- **Stop**: `{ mode: "stream", action: "stop", streamId, stopToken }` using the token returned on start.
- **Responses**: `{ id, stopToken }` on start and stop.
- **Errors**: `paneId is required`, `Stream not found: ...`, `Invalid stop token`.

### Typical Failure Scenarios
- Missing required fields (`paneId is required`, `filePath is required`).
- Unsupported `mode` strings supplied to `fetch-log`.
- Using a stale or incorrect `stopToken` when stopping a stream.

## Example Calls
```jsonc
// Claude Code prompt example
tmux.describe-context { "paneHint": "%3" }

// Codex CLI `/mcp` command
/mcp call tmux.fetch-log {"mode":"capture","paneId":"%305","lines":400}

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
npm install tmux-mcp
# or
bun add tmux-mcp
```
Then invoke `npx tmux-mcp`, `bunx tmux-mcp`, or add `"tmux-mcp"` to your MCP client config.

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
