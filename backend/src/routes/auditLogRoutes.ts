import { Router } from "express";
import { getAuditLogs } from "../controllers/auditLogController";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { listAuditLogsQuerySchema } from "../validators/auditLogValidators";

const router = Router();

// Only admins inspect the audit trail - per spec, this is an
// administrator-only capability.
router.get("/", requireAuth, requireRole("ADMIN"), validate(listAuditLogsQuerySchema, "query"), getAuditLogs);

export default router;
