import express from "express";
import morgan from "morgan";
import { ApolloServer } from "@apollo/server";
import bodyParser from "body-parser";
import { expressMiddleware } from "@as-integrations/express5";
import { config } from "dotenv";
import router from "./routes/index.js";
import { verifyToken } from "./utils/jwt.js";

import { typeDefs, resolvers, type GqlContext } from "./lib/types.js";

config();
const PORT = process.env.PORT;

const app = express();
const apserver = new ApolloServer<GqlContext>({ typeDefs, resolvers });
await apserver.start();

app.use(morgan("dev"));
app.use(bodyParser.json());
app.use(
  "/graphql",
  expressMiddleware(apserver, {
    // Runs ONCE per request, before any resolver. Same idea as requireAuth, but
    // returns { userId } into the GraphQL context instead of stamping req.
    context: async ({ req }): Promise<GqlContext> => {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) return { userId: null };
      try {
        return { userId: verifyToken(header.slice(7)).userId };
      } catch {
        return { userId: null }; // bad/expired token → treated as logged-out
      }
    },
  }),
);
app.use("/api", router);
app.get("/", (_, res) => {
  res.send("Server alive twin");
});

app.listen(PORT, () => {
  console.log("Server running at port:", PORT);
});
