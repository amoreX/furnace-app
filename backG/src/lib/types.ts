import { GraphQLError } from "graphql";
import { JSONResolver, DateTimeResolver } from "graphql-scalars";
import {
  createSession,
  listSessions,
  getSession,
  getActivePath,
  runEchoTurn,
} from "../services/sessions.services.js";

// The per-request context, produced by the context fn in index.ts (from the JWT).
// userId is null when the request has no valid Bearer token.
export type GqlContext = { userId: string | null };

// Guard: every resolver that needs a logged-in user calls this. Throws if the
// token was missing/invalid (ctx.userId is null), else hands back the id.
function requireUser(ctx: GqlContext): string {
  if (!ctx.userId) {
    throw new GraphQLError("Not authenticated", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return ctx.userId;
}

// Guard: the session must exist AND belong to this user. Stops user A from
// reading user B's chat by guessing an id.
async function requireOwnedSession(sessionId: string, userId: string) {
  const session = await getSession(sessionId);
  if (!session) {
    throw new GraphQLError("Session not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  if (session.userId !== userId) {
    throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
  }
  return session;
}

export const typeDefs = `#graphql
  scalar JSON
  scalar DateTime

  type Session {
    id: ID!
    title: String!
    cwd: String!
    activeLeafId: ID
    parentSessionId: ID
    forkedFromEntryId: ID
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type Entry {
    id: ID!
    sessionId: ID!
    parentEntryId: ID
    type: String!
    role: String
    createdAt: DateTime!
    data: JSON!
  }

  type Query {
    sessions: [Session!]!
    session(id: ID!): Session
    activePath(sessionId: ID!): [Entry!]!
  }

  type Mutation {
    createSession(cwd: String!, title: String): Session!
    sendMessage(sessionId: ID!, content: String!): [Entry!]!
  }
`;

export const resolvers = {
  // Custom scalars: teach GraphQL how to (de)serialize JSON + DateTime.
  JSON: JSONResolver,
  DateTime: DateTimeResolver,

  Query: {
    // (parent, args, context) — userId comes from ctx (the JWT), never the client.
    sessions: (_parent: unknown, _args: unknown, ctx: GqlContext) =>
      listSessions(requireUser(ctx)),

    session: async (_parent: unknown, { id }: { id: string }, ctx: GqlContext) => {
      const userId = requireUser(ctx);
      return requireOwnedSession(id, userId); // 404/403 if not yours
    },

    activePath: async (
      _parent: unknown,
      { sessionId }: { sessionId: string },
      ctx: GqlContext,
    ) => {
      const userId = requireUser(ctx);
      await requireOwnedSession(sessionId, userId);
      return getActivePath(sessionId);
    },
  },

  Mutation: {
    createSession: (
      _parent: unknown,
      { cwd, title }: { cwd: string; title?: string },
      ctx: GqlContext,
    ) => createSession(requireUser(ctx), cwd, title),

    // Echo MVP: one batched transaction (ownership + both appends + activePath).
    // Service throws plain codes; map them to GraphQL errors here.
    sendMessage: async (
      _parent: unknown,
      { sessionId, content }: { sessionId: string; content: string },
      ctx: GqlContext,
    ) => {
      const userId = requireUser(ctx);
      try {
        return await runEchoTurn(sessionId, userId, content);
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        if (code === "SESSION_NOT_FOUND")
          throw new GraphQLError("Session not found", {
            extensions: { code: "NOT_FOUND" },
          });
        if (code === "SESSION_FORBIDDEN")
          throw new GraphQLError("Forbidden", {
            extensions: { code: "FORBIDDEN" },
          });
        throw err;
      }
    },
  },
};
