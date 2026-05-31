# AGENTS.md

## Project Overview

opencode-clawmessenger is a TypeScript bridge connecting RongCloud IM (融云/虾说) to an OpenCode server. It receives chat messages via RongCloud, forwards them to OpenCode's session API, and returns responses. Designed as an OpenCode plugin following the same pattern as `opencode-feishu`.

## Architecture

```
src/
  types/plugin.ts     OpenCode Plugin interface (id + server hook)
  plugin.ts           Plugin mode entry (imported by OpenCode runtime)
  standalone.ts       Standalone daemon mode entry
  cli.ts              Commander CLI (start/stop/status/logs/setup)
  index.ts            Library exports
  core/
    types.ts          ClawMessengerConfig, RongCloudMessage, SessionInfo, message enums
    config.ts         Zod-validated ConfigManager (file + env + auto-register)
    logger.ts         Pino structured logging → ~/.config/opencode/clawmessenger.log
    session-manager.ts  chatId→sessionId mapping, JSON persistence
    message-handler.ts  Message dispatch: chat/session/command/device-status/device-control
    dedup.ts          In-memory message dedup with TTL
    daemon.ts         PID file, status heartbeat, spawn daemon
    hook-manager.ts   onSessionCreated / onSessionIdle lifecycle hooks
    auto-register.ts  Node registration with ClawMessenger server (7-day token)
    qr-crypto.ts      XOR stream cipher + Base64 (v2: prefix), shared with mini-program
    mac-address.ts    Cross-platform MAC address detection
  rongcloud/
    env-polyfill.ts   Browser polyfill (jsdom + fake-indexeddb + ws + NodeXHR) — MUST be imported before SDK
    client.ts         RongCloud IM client (connect/sendMessage/sendReadReceipt)
  opencode/
    client.ts         OpenCode SDK wrapper (createSession/sendPrompt/waitForResponse)
    event-handler.ts  SSE event stream handler (session.idle/error)
  websocket/
    client.ts         Direct WebSocket client (register + heartbeat)
    server-client.ts  Server-mediated WebSocket client (node_info registration)
bin/
  opencode-clawmessenger   CLI entrypoint (#!/usr/bin/env node → dist/cli.js)
```

## Dual-Mode Architecture

Like opencode-feishu, this plugin supports two modes:
1. **Plugin mode** (`plugin.ts`) — loaded by OpenCode's plugin system, receives `PluginInput` with `client/project/directory`
2. **Standalone mode** (`standalone.ts`) — runs as a daemon, auto-registers, manages its own lifecycle

Both modes share: `RongCloudClient`, `OpenCodeClient`, `SessionManager`, `MessageHandler`.

## Key Dependencies

- `@rongcloud/imlib-next` — RongCloud IM SDK (browser-oriented)
- `@opencode-ai/sdk` — OpenCode v2 client SDK
- `jsdom`, `fake-indexeddb`, `ws` — Node.js polyfills for RongCloud SDK
- `commander` — CLI framework
- `pino` / `pino-pretty` — Structured logging
- `zod` — Config validation
- `axios` — HTTP for auto-registration

## Commands

```bash
npm run build          # tsc compile
npm run dev            # tsc --watch
npm run start          # node dist/cli.js start
npm run lint           # tsc --noEmit
npm run typecheck      # tsc --noEmit
```

CLI commands:
```bash
opencode-clawmessenger setup            # Auto-register, save config
opencode-clawmessenger start            # Foreground
opencode-clawmessenger start --daemon   # Background daemon
opencode-clawmessenger stop             # Stop daemon
opencode-clawmessenger status           # Check status [--json]
opencode-clawmessenger logs             # Tail logs [-n N] [-f]
```

## Config Priority

**env vars > auto-register saved config > `~/.config/opencode/clawmessenger.json`**

Key env vars:
- `CLAW_TOKEN`, `CLAW_ACCOUNT_ID` — RongCloud credentials
- `DM_SERVER_URL` — registration server (default: `https://newsradar.dreamdt.cn/im`)
- `CLAW_OPENCODE_URL` — OpenCode server (default: `http://127.0.0.1:19876`)
- `CLAW_OPENCODE_DIR` — working directory for OpenCode sessions
- `OPENCODE_SERVER_PASSWORD` — Basic auth for OpenCode
- `CLAW_SYSTEM_PROMPT` — override default system prompt
- `CLAW_LOG_LEVEL` — pino log level (default: info)
- `DEBUG` — (legacy) enable debug logging

## Critical: RongCloud Browser Polyfill

`rongcloud/env-polyfill.ts` **must** be imported before any RongCloud SDK usage. It patches `globalThis` with `window`, `document`, `navigator`, `localStorage`, `XMLHttpRequest`, `WebSocket`, and IndexedDB.

## Message Protocol

Types in `core/types.ts` (`RongyunMessageTypeEnum`). Shared with `claw-subagent-service`. Structured messages use `msg_type` field, sent as custom RongCloud message types (registered via `registerMessageType`), not plain text.

## QR Crypto

`core/qr-crypto.ts` implements XOR stream cipher + Base64 with `v2:` prefix. Algorithm must stay in sync with the clawmessenger mini-program/app.

## Config File Locations

- Plugin config: `~/.config/opencode/clawmessenger.json`
- Auto-register data: `~/.claw-bridge/config.json`
- Sessions: `~/.config/opencode/clawmessenger-sessions.json`
- Logs: `~/.config/opencode/clawmessenger.log`
- PID: `~/.config/opencode/clawmessenger.pid`
