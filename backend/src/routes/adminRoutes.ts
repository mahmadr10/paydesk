import { Router } from "express";
import * as adminController from "../controllers/adminController";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { devAssistantLimiter } from "../middleware/rateLimit";
import {
  listUsersQuerySchema,
  updateUserSchema,
  createCategorySchema,
  setCategoryActiveSchema,
  upsertSlaPolicySchema,
  askDevAssistantSchema,
  applyDevAssistantFixSchema,
} from "../validators/adminValidators";
import { mongoIdParamSchema } from "../validators/ticketValidators";
import { z } from "zod";

const router = Router();

// Every admin route requires BOTH a valid session AND the ADMIN role - two
// separate middlewares because they answer two separate questions ("who are
// you" then "are you allowed"), same pattern as the rest of the API.
router.use(requireAuth, requireRole("ADMIN"));

router.get("/users", validate(listUsersQuerySchema, "query"), adminController.listUsers);
router.patch("/users/:id", validate(mongoIdParamSchema, "params"), validate(updateUserSchema), adminController.updateUser);

router.get("/categories", adminController.listCategories);
router.post("/categories", validate(createCategorySchema), adminController.createCategory);
router.patch(
  "/categories/:id",
  validate(mongoIdParamSchema, "params"),
  validate(setCategoryActiveSchema),
  adminController.setCategoryActive
);

// Manual trigger for the background job (see jobs/slaBreachJob.ts) - the
// same function the 1-minute cron calls, exposed for on-demand/demo use.
router.post("/jobs/sla-check/run", adminController.runSlaBreachCheck);

// AI Dev Assistant (multi-agent orchestrator) - investigate-and-recommend
// only, Admin-only, its own tighter rate limit (see middleware/rateLimit.ts
// for why). See services/devAssistantService.ts and ai/devAssistant/.
router.post("/dev-assistant/ask", devAssistantLimiter, validate(askDevAssistantSchema), adminController.askDevAssistant);

// The ONE write path in this whole feature - see ai/devAssistant/applyFix.ts
// for the actual safety mechanics (path validation, exact-match validation,
// apply, test, auto-revert-on-failure). Reachable only after a human has
// reviewed the diff shown by the endpoint above and explicitly clicked
// Apply; there is no automatic call path into this.
router.post(
  "/dev-assistant/apply-fix",
  devAssistantLimiter,
  validate(applyDevAssistantFixSchema),
  adminController.applyDevAssistantFix
);

router.get("/sla-policies", adminController.listSlaPolicies);
router.put(
  "/sla-policies/:priority",
  validate(z.object({ priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]) }), "params"),
  validate(upsertSlaPolicySchema),
  adminController.upsertSlaPolicy
);

export default router;
