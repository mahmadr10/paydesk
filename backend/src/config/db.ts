import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "../observability/logger";

// Mongoose is a library that sits on top of the raw MongoDB driver and lets
// us define "schemas" (shapes for our documents, e.g. a User always has an
// email string and a role) plus get TypeScript types for them. Raw MongoDB
// has no schema at all — anything can be saved. For a team project with
// TypeScript, Mongoose's structure + validation is worth the small overhead.
// MONGODB_URI=memory starts a throwaway in-memory MongoDB, so anyone (a
// judge included) can run the app with zero database setup. Data is lost
// when the server stops. Dev-only: the package is a devDependency.
async function resolveMongoUri(): Promise<string> {
  if (env.MONGODB_URI !== "memory") return env.MONGODB_URI;
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const server = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  logger.info("Using a temporary in-memory MongoDB (MONGODB_URI=memory). Data resets on restart.");
  return server.getUri("paydesk");
}

export async function connectDB() {
  try {
    await mongoose.connect(await resolveMongoUri());
    logger.info("MongoDB connected");
  } catch (err) {
    logger.error({ err }, "MongoDB connection failed");
    process.exit(1);
  }
}
