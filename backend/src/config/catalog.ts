// The demo store's products. Prices live on the server only: the browser
// sends a SKU and quantity, never a price, so a customer can't edit the
// amount they pay.
export interface CatalogProduct {
  sku: string;
  name: string;
  description: string;
  price: number;
  emoji: string;
}

export const CATALOG: CatalogProduct[] = [
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

export function findProduct(sku: string) {
  return CATALOG.find((p) => p.sku === sku);
}
