import "dotenv/config";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// The Pool talks to Neon over a WebSocket — a persistent connection that CAN hold
// a transaction open (BEGIN → ... → COMMIT). The neon-http driver couldn't. Node
// has no WebSocket the driver auto-picks-up, so hand it `ws`.
neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL missing in .env");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool });
