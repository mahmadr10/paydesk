"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auditLogController_1 = require("../controllers/auditLogController");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const auditLogValidators_1 = require("../validators/auditLogValidators");
const router = (0, express_1.Router)();
// Only admins inspect the audit trail - per spec, this is an
// administrator-only capability.
router.get("/", auth_1.requireAuth, (0, auth_1.requireRole)("ADMIN"), (0, validate_1.validate)(auditLogValidators_1.listAuditLogsQuerySchema, "query"), auditLogController_1.getAuditLogs);
exports.default = router;
