import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { listActiveCategories } from "../repositories/categoryRepository";

const router = Router();

// Any logged-in user (customer included) needs to see the list of active
// categories to fill out the "Create Ticket" form - distinct from
// /admin/categories, which is the admin-only management endpoint (create,
// deactivate). This one is read-only and deliberately has no role
// restriction beyond "must be logged in."
router.get("/", requireAuth, async (_req, res) => {
  const categories = await listActiveCategories();
  res.status(200).json({ success: true, data: { categories } });
});

export default router;
