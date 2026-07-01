# furnace-app — TO-DO

> Working checklist. The current focus (**Sessions / Chats**) is broken into small
> steps. Later topics are just titles — we elaborate them when we get there.
> Auth (signup/login/JWT) is ✅ done — see `claude_session.md`.

---

## 🟢 NOW: Sessions / Chats

The chat data layer + making GraphQL real. Sits on furnace's entry-tree
(`Session ──< Entry`). Reference: `docs/ARCHITECTURE.md` §4.1 + §5.2, and furnace
`src/session/store.ts` / `types.ts`.

### 1. Conversation tables (Drizzle, 1:1 furnace)
- [ ] In `src/db/schema.ts` add **`sessions`** table — furnace columns:
      `id, title, cwd, activeLeafId, parentSessionId, forkedFromEntryId,
      createdAt, updatedAt, archivedAt` + scoping `userId` (ref `users.id`).
      *(project/device scoping = later topic; for now just `userId` + `cwd`.)*
- [ ] Add **`entries`** table: `id, sessionId (ref sessions), parentEntryId,
      type, role, createdAt, data` (data = `jsonb`).
- [ ] Entry `type`/`role`: start as plain `text()` (furnace stores text). Optional
      later: drizzle `pgEnum`.
- [ ] `npx drizzle-kit push` → pick **create**, keep `schemaFilter:["public"]`.
- [ ] (optional) drizzle `relations()` for `db.query.*` — skip for now, use joins/selects.

### 2. Session store logic (port furnace store.ts)
- [ ] New `src/services/session.services.ts`.
- [ ] `createSession(userId, { cwd, title })` → insert, return row.
- [ ] `listSessions(userId)` → select where `userId`, `archivedAt is null`,
      order by `updatedAt desc`.
- [ ] `getSession(id)` → one row.
- [ ] `appendEntry(sessionId, type, role, data)` → **the Pi rule** (furnace
      store.ts:317): new entry's `parentEntryId = session.activeLeafId`, insert,
      then `update session set activeLeafId = newEntry.id`. Do in a transaction.
- [ ] `getActivePath(sessionId)` (furnace store.ts:353): load all entries, walk
      `parentEntryId` from `activeLeafId` up to root, reverse → the path the model sees.
- [ ] thin helpers: `appendMessage(role, content)`, `appendToolCall`, `appendToolResult`.

### 3. GraphQL layer (kill the Todo demo)
- [ ] Install a JSON scalar: `npm i graphql-scalars` (for `Entry.data`).
- [ ] In `src/lib/types.ts` replace Todo typeDefs with: `Session`, `Entry`
      (start with `data: JSON` — skip the typed union for now), `Query { sessions,
      session(id), activePath(sessionId) }`, `Mutation { createSession, sendMessage }`.
- [ ] Resolvers call the session services from step 2.
- [ ] Apollo already mounted at `/graphql` in `index.ts` — no new wiring needed.

### 4. Bridge JWT → GraphQL context (auth in resolvers)
- [ ] In `index.ts`, give `expressMiddleware(apserver, { context })` a `context` fn:
      read `Authorization: Bearer`, `verifyToken()` (reuse `src/utils/jwt.ts`) →
      return `{ userId }`.
- [ ] Resolvers read `ctx.userId` to scope sessions (your chats vs mine).
- [ ] Reuse logic, not the express `requireAuth` (that's for REST routes).

### 5. sendMessage (echo — NO LLM yet)
- [ ] `sendMessage(sessionId, content)` mutation: `appendMessage("user", content)`
      → then append a fake assistant entry (e.g. `"echo: " + content`) → return entries.
- [ ] Goal: prove entry-tree + `activePath` end-to-end over GraphQL before real AI.

---

## ⚪ LATER (titles only — flesh out when we reach them)

- [ ] LLM integration (OpenRouter — real assistant replies, non-streaming first)
- [ ] Streaming (Redis Pub/Sub + GraphQL subscriptions — `tokenStream`)
- [ ] Tool dispatch to device (`toolDispatch` / `submitToolResult`)
- [ ] Projects / Devices scoping
- [ ] Branching & forking (`switchBranch`, `forkSession`)
- [ ] Compaction (context window management)
- [ ] Swift desktop app (SwiftUI client + Apollo iOS + bundled tool runner)
- [ ] OAuth (GitHub login via `ASWebAuthenticationSession`)
- [ ] Skills / Tasks (subagents)
- [ ] Convert `docs/ARCHITECTURE.md` schema from Prisma syntax → Drizzle
