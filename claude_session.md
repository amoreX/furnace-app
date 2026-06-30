# furnace-app — Claude Session Log

> Living working doc for our build + learning sessions on furnace-app.
> We update this as we go. **Last updated: 2026-06-30.**
>
> How to use: skim **Locked decisions** + **Architecture model** for the current
> state, **Learning log** to revisit a concept, **Open / next up** for what's
> queued. Append, don't rewrite history.

---

## What furnace-app is

A **ChatGPT-style app that is a GUI + cloud brain for [furnace](../furnace)** —
furnace being a local-first terminal AI coding agent (entry-tree session model,
~15 tools, OpenRouter provider, local SQLite store).

Originally scaffolded as a learning project for a **GraphQL + Postgres + Redis**
stack. Two parts in the repo today:
- `app/` — was React + Vite (now superseded; see decision #1).
- `backG/` — Express 5 + Apollo Server 5; currently serves a throwaway Todo demo
  (proxies JSONPlaceholder) just to prove the GraphQL plumbing.

Status: **early scaffold.** The real design lives in `docs/ARCHITECTURE.md`.

---

## Locked decisions

1. **Client is a native macOS app (Swift / SwiftUI)** — NOT a React web app.
   (`app/` will be replaced; README still describes React and is now stale.)
2. **Execution model: "brain in the backend, hands on the device."**
   - The whole furnace runtime (agent loop, OpenRouter calls, store, compaction,
     permission logic) runs **server-side**.
   - When the agent emits a tool call, the backend **dispatches it to the Mac**,
     which runs it locally (real FS + bash on the user's repo) and sends the
     result back. The loop blocks on that result — same pattern furnace already
     uses for permission waits.
   - **Consequence: no server-side sandbox, no repo cloning, no cold starts.**
3. **Tools run via a bundled local runner** — the macOS app ships furnace's
   existing TypeScript tool executors (CLI in "executor mode" / embedded Node);
   SwiftUI does UI + native permission prompts and drives that runner. We do NOT
   reimplement read/edit/bash in Swift. *(Worth a final confirm before building.)*
4. **Conversation schema is 1:1 with furnace** — `Session`/`Entry` mirror
   furnace's `sessions`/`entries` tables column-for-column, plus multi-user scoping.
5. **Hosting: Neon (Postgres) + Railway (long-lived server + co-located Redis).**
   Not serverless — the WebSocket must stay open for streaming + tool dispatch.
6. **Backend holds all secrets** (`OPENROUTER_API_KEY`, DB, Redis, auth). The
   device needs none — only the bundled tool runner + a signed-in session token.

---

## Architecture model (current)

```
macOS app (SwiftUI)                 Cloud server (Express 5 + Apollo)
- chat UI / branches    GraphQL     - auth, sessions, entries
- LOCAL TOOL EXECUTOR  ◀────────▶   - furnace agent loop (BRAIN)
  (bundled TS runner)   HTTP + WS   - Prisma
- native perm prompts               ├─ Postgres (Neon)  ← source of truth
- Keychain auth                     └─ Redis            ← pub/sub, cache, sessions
        │
        ▼ runs tools on the user's Mac (FS + bash), returns results
   user's local repo (cwd)
```

**Turn lifecycle (fire-and-stream):**
1. App sends `sendMessage` (mutation, POST) → user entry saved, turn starts async.
2. Backend reconstructs root→leaf path → OpenRouter → streams tokens back over WS.
3. Tool call → backend appends `tool_call` entry, pushes `toolDispatch` to device,
   **blocks** awaiting the result.
4. App runs the tool locally (native perm prompt first if needed) →
   `submitToolResult` mutation → backend appends `tool_result`, unblocks loop.
5. Repeat until no tool calls → final assistant message + `tokenStream(done)`.

---

## API surface — GraphQL vs. plain HTTP

**GraphQL** (`/graphql`): all conversation/agent data + realtime.
- Fetch: `me`, `devices`, `projects`, `sessions`, `session`, `activePath`.
- Act: `sendMessage`, `cancelTurn`, `forkSession`, `switchBranch`, `submitToolResult`.
- Realtime (WS): `tokenStream`, `entryAdded`, `toolActivity`, `toolDispatch`.

**Plain HTTP** (not GraphQL): OAuth (`/auth/github`, `/auth/github/callback`,
`/auth/token`, `/auth/refresh`, `/auth/logout`), blob up/download (`/uploads`,
`/files/:id`), health (`/healthz`, `/`), and the WS upgrade transport on `/graphql`.

Rule of thumb: *redirects a browser / mints-refreshes-revokes a token / moves
binary bytes / is an infra probe → plain HTTP. Reads or mutates conversation
data → GraphQL.*

---

## What's been done to the repo

- ✅ `docs/ARCHITECTURE.md` rewritten for the Swift desktop + split-runtime model
  (§2 execution model, §3 diagram, §4 data model, §5 API).
- ✅ `docs/ARCHITECTURE.md` §4.1 — Prisma schema 1:1 with furnace (+ scoping).
- ✅ `docs/ARCHITECTURE.md` §5.1 — GraphQL-vs-HTTP endpoint table + auth model.
- ✅ `docs/ARCHITECTURE.md` §5.2 — conversation GraphQL SDL (typed `EntryData` union).
- ⬜ README.md — still says "React SPA / web app"; **stale, needs updating.**
- ⬜ No backend/schema code changed yet (still the Todo demo).

---

## Learning log (concepts covered)

Tight recaps so we can revisit. Most detail is in chat history + ARCHITECTURE.md.

### L1 — GraphQL transports: POST vs WebSocket
- `query`/`mutation` → request/response over **HTTP POST `/graphql`**.
- `subscription` → server-push over a **WebSocket on `/graphql`**.
- A chat turn uses **both**: sending = `sendMessage` mutation (POST); receiving the
  streamed reply = `tokenStream` subscription (WS). "Fire-and-stream."
- Can't do streaming over POST (one-shot). Don't do everything over WS (POST is
  simpler/stateless/cacheable for discrete ops).

### L2 — The WebSocket "upgrade"
- A WS connection starts as an HTTP `GET` with `Connection: Upgrade` +
  `Upgrade: websocket`; server replies `101 Switching Protocols`; the same TCP
  socket becomes a persistent, full-duplex WebSocket.
- Same URL `/graphql`, different protocol: normal POST → Apollo HTTP handler;
  GET+Upgrade → the `graphql-ws` WebSocket server takes over.
- Modern subprotocol = `graphql-transport-ws` (lib: `graphql-ws`). Old/deprecated:
  `subscriptions-transport-ws`.
- This is why the server must be long-lived (not serverless).

### L4 — Express layering: route → controller → service (+ middleware)
- **route** = path+method (the door). **controller** = HTTP glue (req/res).
  **service** = pure logic, no req/res. **middleware** = cross-cutting guard.
- Key win: a **pure service** (e.g. `signup(email, pw)`) is callable by BOTH the
  REST controller AND a future GraphQL resolver — no duplication.
- Middleware worth it when reused across routes (e.g. `requireAuth` jwt check).
  One-off validation → middleware optional (inline/helper fine).

### L3 — `connectionParams` vs HTTP headers (auth)
- **Header**: per-request HTTP metadata, re-sent on every query/mutation
  (`Authorization: Bearer …`).
- **connectionParams**: sent **once** in the WS `connection_init` message payload;
  authenticates the whole open socket.
- Why both exist: the browser `WebSocket` API can't set arbitrary headers, so
  graphql-ws defines an app-level auth slot (`connection_init.payload`).
- Native (Apollo iOS) uses `connectingPayload` for the same thing.

---

## Current task: AUTH (email + password)

Decided 2026-06-30: build **email + password** auth first (plan B, not OAuth yet).
Order: **scaffold auth first (fake/in-memory store) → then Prisma + Neon → link up.**

Pieces:
- `signup(email, password)` → hash pw → store user → return token
- `login(email, password)` → check pw hash → return token
- libs: `bcrypt` (hash pw), `jsonwebtoken` (make/verify JWT)
- shape as **GraphQL mutations** (fits the learn-GraphQL goal; email+pw is one-shot
  so a mutation is fine — the OAuth `/auth/*` HTTP routes come later)
- auth context: verify `Authorization: Bearer <jwt>` on each request → `me`

Later: swap fake store → Prisma `User` table.

## Open questions / next up

- [ ] **(next topics — going through these one by one)**
- [ ] Confirm bundled-TS-runner vs. native-Swift tools (decision #3).
- [ ] Update `README.md` to match the Swift desktop direction.
- [ ] P0 plumbing: Prisma + Neon, replace Todo demo schema, wire Apollo to the SDL.

> Add new topics/questions here as they come up.
