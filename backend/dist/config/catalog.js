"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATALOG = void 0;
exports.findProduct = findProduct;
exports.CATALOG = [
    {
        sku: "ICON-PACK",
        name: "Pro Icon Pack",
        description: "2,000 hand-drawn SVG icons, commercial license.",
        price: 25,
        emoji: "🎨",
    },
    {
        sku: "UI-KIT",
        name: "Dashboard UI Kit",
        description: "120 ready-made React dashboard screens.",
        price: 49,
        emoji: "🧩",
    },
    {
        sku: "COURSE-AI",
        name: "Build AI Agents Course",
        description: "8-hour video course with lifetime access.",
        price: 79,
        emoji: "🎓",
    },
    {
        sku: "HOSTING-1Y",
        name: "1-Year Starter Hosting",
        description: "Managed hosting for one small web app.",
        price: 120,
        emoji: "☁️",
    },
];
function findProduct(sku) {
    return exports.CATALOG.find((p) => p.sku === sku);
}
