import type { Request, Response } from "express";
import { createApp } from "../src/app";

const app = createApp();

export default async function handler(req: Request, res: Response) {
  return new Promise((resolve, reject) => {
    res.on("finish", resolve);
    res.on("close", resolve);
    res.on("error", reject);
    app(req, res);
  });
}

export { app };
