"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const categoryRepository_1 = require("../repositories/categoryRepository");
const router = (0, express_1.Router)();
// Any logged-in user (customer included) needs to see the list of active
// categories to fill out the "Create Ticket" form - distinct from
// /admin/categories, which is the admin-only management endpoint (create,
// deactivate). This one is read-only and deliberately has no role
// restriction beyond "must be logged in."
router.get("/", auth_1.requireAuth, async (_req, res) => {
    const categories = await (0, categoryRepository_1.listActiveCategories)();
    res.status(200).json({ success: true, data: { categories } });
});
exports.default = router;
