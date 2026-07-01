// userId inferred from jwtToken
import { eq, and, desc, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  sessions,
  entries,
  type Session,
  type Entry,
  type NewEntry,
} from "../db/schema.js";

export const createSession = async (
  userId: string,
  cwd: string,
  title: string = "New chat", // default VALUE (=), not a union (|)
): Promise<Session> => {
  const [session] = await db
    .insert(sessions)
    .values({ userId, cwd, title })
    .returning();
  return session; // whole row: id, title, cwd, activeLeafId, createdAt...
};

export const listSessions = async (userId: string): Promise<Session[]> => {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.archivedAt)))
    .orderBy(desc(sessions.updatedAt));
  return rows;
};

export const getSession = async (sessionId: string): Promise<Session> => {
  const row = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return row[0];
};

export const appendEntry = async (entry: NewEntry): Promise<Entry> => {
  return await db.transaction(async (tx) => {
    //fetches session from sessionId for parent connection
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, entry.sessionId));
    if (!session) throw new Error("Session not found");

    // inserts actual entry
    const [newEntry] = await tx
      .insert(entries)
      .values({ ...entry, parentEntryId: session.activeLeafId })
      .returning();

    // updates tip of sesssion
    await tx
      .update(sessions)
      .set({ activeLeafId: newEntry.id, updatedAt: new Date() })
      .where(eq(sessions.id, entry.sessionId));

    return newEntry;
  });
};

export const getActivePath = async (sessionId: string): Promise<Entry[]> => {
  // 1. find the tip
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!session) throw new Error("Session not found");
  if (!session.activeLeafId) return []; // empty chat, no entries yet

  // 2. load ALL entries for this session in ONE query
  const rows = await db
    .select()
    .from(entries)
    .where(eq(entries.sessionId, sessionId));

  // 3. index by id → entry for O(1) hops
  const byId = new Map(rows.map((e) => [e.id, e]));

  // 4. walk tip → root via parentEntryId
  const path: Entry[] = [];
  let cursor: string | null = session.activeLeafId;
  while (cursor) {
    const entry = byId.get(cursor);
    if (!entry) break; // dangling link — stop, don't loop forever
    path.push(entry);
    cursor = entry.parentEntryId;
  }

  // 5. collected leaf → root; flip to root → leaf (the order the model reads)
  return path.reverse();
};

export const appendMessage = (
  sessionId: string,
  role: "user" | "assistant",
  content: string,
): Promise<Entry> =>
  appendEntry({ sessionId, type: "message", role, data: { content } });

export const appendToolCall = (
  sessionId: string,
  data: { name: string; arguments: string; toolCallId: string },
): Promise<Entry> =>
  appendEntry({ sessionId, type: "tool_call", role: "assistant", data });

export const appendToolResult = (
  sessionId: string,
  data: { name: string; content: string; toolCallId: string },
): Promise<Entry> =>
  appendEntry({ sessionId, type: "tool_result", role: "tool", data });
