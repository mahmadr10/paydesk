"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./env");
const logger_1 = require("../observability/logger");
// Mongoose is a library that sits on top of the raw MongoDB driver and lets
// us define "schemas" (shapes for our documents, e.g. a User always has an
// email string and a role) plus get TypeScript types for them. Raw MongoDB
// has no schema at all - anything can be saved. For a team project with
// TypeScript, Mongoose's structure + validation is worth the small overhead.
// MONGODB_URI=memory starts a throwaway in-memory MongoDB, so anyone (a
// judge included) can run the app with zero database setup. Data is lost
// when the server stops. Dev-only: the package is a devDependency.
async function resolveMongoUri() {
    if (env_1.env.MONGODB_URI !== "memory")
        return env_1.env.MONGODB_URI;
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const server = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    logger_1.logger.info("Using a temporary in-memory MongoDB (MONGODB_URI=memory). Data resets on restart.");
    return server.getUri("paydesk");
}
let cachedPromise = null;
async function connectDB() {
    // If already connected or connecting, reuse the existing connection
    if (mongoose_1.default.connection.readyState >= 1) {
        return mongoose_1.default;
    }
    if (!cachedPromise) {
        cachedPromise = (async () => {
            const uri = await resolveMongoUri();
            return mongoose_1.default.connect(uri, {
                serverSelectionTimeoutMS: 10000,
                maxPoolSize: process.env.VERCEL ? 10 : undefined,
            });
        })();
    }
    try {
        const conn = await cachedPromise;
        logger_1.logger.info("MongoDB connected");
        return conn;
    }
    catch (err) {
        cachedPromise = null;
        logger_1.logger.error({ err }, "MongoDB connection failed");
        if (!process.env.VERCEL) {
            process.exit(1);
        }
        throw err;
    }
}
