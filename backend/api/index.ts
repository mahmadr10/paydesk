import type { Request, Response } from "express";

let appInstance: any = null;
let initError: Error | null = null;

function setCorsHeaders(req: Request, res: Response) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept, Cookie"
  );
  res.setHeader("Access-Control-Expose-Headers", "Set-Cookie");
}

async function getApp() {
  if (appInstance) return appInstance;
  if (initError) throw initError;
  try {
    const { createApp } = await import("../src/app");
    appInstance = createApp();
    return appInstance;
  } catch (err: any) {
    initError = err;
    throw err;
  }
}

export default async function handler(req: Request, res: Response) {
  // Always attach CORS headers before doing anything
  setCorsHeaders(req, res);

  // Instantly handle preflight OPTIONS requests without touching backend logic
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const app = await getApp();
    return new Promise((resolve, reject) => {
      res.on("finish", resolve);
      res.on("close", resolve);
      res.on("error", reject);
      app(req, res);
    });
  } catch (error: any) {
    console.error("Vercel Serverless Function Startup Error:", error);
    setCorsHeaders(req, res);
    return res.status(500).json({
      success: false,
      error: error?.message || "Server initialization failed",
      details: error?.stack || String(error),
    });
  }
}

export { getApp as app };
