"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adminController = __importStar(require("../controllers/adminController"));
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const rateLimit_1 = require("../middleware/rateLimit");
const adminValidators_1 = require("../validators/adminValidators");
const ticketValidators_1 = require("../validators/ticketValidators");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
// Every admin route requires BOTH a valid session AND the ADMIN role - two
// separate middlewares because they answer two separate questions ("who are
// you" then "are you allowed"), same pattern as the rest of the API.
router.use(auth_1.requireAuth, (0, auth_1.requireRole)("ADMIN"));
router.get("/users", (0, validate_1.validate)(adminValidators_1.listUsersQuerySchema, "query"), adminController.listUsers);
router.patch("/users/:id", (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), (0, validate_1.validate)(adminValidators_1.updateUserSchema), adminController.updateUser);
router.get("/categories", adminController.listCategories);
router.post("/categories", (0, validate_1.validate)(adminValidators_1.createCategorySchema), adminController.createCategory);
router.patch("/categories/:id", (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), (0, validate_1.validate)(adminValidators_1.setCategoryActiveSchema), adminController.setCategoryActive);
// Manual trigger for the background job (see jobs/slaBreachJob.ts) - the
// same function the 1-minute cron calls, exposed for on-demand/demo use.
router.post("/jobs/sla-check/run", adminController.runSlaBreachCheck);
// AI Dev Assistant (multi-agent orchestrator) - investigate-and-recommend
// only, Admin-only, its own tighter rate limit (see middleware/rateLimit.ts
// for why). See services/devAssistantService.ts and ai/devAssistant/.
router.post("/dev-assistant/ask", rateLimit_1.devAssistantLimiter, (0, validate_1.validate)(adminValidators_1.askDevAssistantSchema), adminController.askDevAssistant);
// The ONE write path in this whole feature - see ai/devAssistant/applyFix.ts
// for the actual safety mechanics (path validation, exact-match validation,
// apply, test, auto-revert-on-failure). Reachable only after a human has
// reviewed the diff shown by the endpoint above and explicitly clicked
// Apply; there is no automatic call path into this.
router.post("/dev-assistant/apply-fix", rateLimit_1.devAssistantLimiter, (0, validate_1.validate)(adminValidators_1.applyDevAssistantFixSchema), adminController.applyDevAssistantFix);
router.get("/sla-policies", adminController.listSlaPolicies);
router.put("/sla-policies/:priority", (0, validate_1.validate)(zod_1.z.object({ priority: zod_1.z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]) }), "params"), (0, validate_1.validate)(adminValidators_1.upsertSlaPolicySchema), adminController.upsertSlaPolicy);
exports.default = router;
