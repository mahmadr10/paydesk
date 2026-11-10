"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = exports.UPLOAD_DIR = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const AppError_1 = require("../utils/AppError");
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
exports.UPLOAD_DIR = isServerless
    ? path_1.default.join(os_1.default.tmpdir(), "uploads")
    : path_1.default.join(__dirname, "..", "..", "uploads");
try {
    if (!fs_1.default.existsSync(exports.UPLOAD_DIR)) {
        fs_1.default.mkdirSync(exports.UPLOAD_DIR, { recursive: true });
    }
}
catch {
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
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        try {
            if (!fs_1.default.existsSync(exports.UPLOAD_DIR)) {
                fs_1.default.mkdirSync(exports.UPLOAD_DIR, { recursive: true });
            }
        }
        catch {
            // safe fallback
        }
        cb(null, exports.UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
        // Never trust the client's filename for the ON-DISK name - it could
        // contain path-traversal characters ("../../etc") or collide with an
        // existing file. We generate a random name and keep the client's
        // original name only as metadata for display/download.
        const randomName = crypto_1.default.randomBytes(16).toString("hex");
        cb(null, randomName + path_1.default.extname(file.originalname));
    },
});
exports.upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
            return cb(new AppError_1.AppError(400, "UNSUPPORTED_FILE_TYPE", `File type not allowed: ${file.mimetype}`));
        }
        cb(null, true);
    },
});
