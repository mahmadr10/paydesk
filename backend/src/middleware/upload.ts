import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import { AppError } from "../utils/AppError";

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export const UPLOAD_DIR = isServerless
  ? path.join(os.tmpdir(), "uploads")
  : path.join(__dirname, "..", "..", "uploads");

try {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
} catch {
  // Ignore filesystem errors at module load time in constrained / read-only environments
}

// Whitelist, not blacklist - we only accept file types we can vouch for.
// This is the main defense against someone uploading something dangerous
// (e.g. an executable, or an HTML file that could be served back and run
// script in another user's browser).
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }
    } catch {
      // safe fallback
    }
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    // Never trust the client's filename for the ON-DISK name - it could
    // contain path-traversal characters ("../../etc") or collide with an
    // existing file. We generate a random name and keep the client's
    // original name only as metadata for display/download.
    const randomName = crypto.randomBytes(16).toString("hex");
    cb(null, randomName + path.extname(file.originalname));
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new AppError(400, "UNSUPPORTED_FILE_TYPE", `File type not allowed: ${file.mimetype}`));
    }
    cb(null, true);
  },
});
