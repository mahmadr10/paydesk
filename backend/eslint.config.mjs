// Flat config - the modern ESLint config format (replaces the old
// .eslintrc). typescript-eslint's `recommended` set catches real bugs
// TypeScript's compiler alone doesn't (unused variables, floating promises,
// etc.) - we don't add a huge custom rule set on top; the point of lint in
// CI is catching mistakes, not enforcing a personal style.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // api/ is the Vercel serverless entry shim (plain CommonJS), not app code.
    ignores: ["dist/", "node_modules/", "uploads/", "api/"],
  },
  {
    rules: {
      // Prefixing an intentionally-unused parameter with _ (e.g. Express's
      // `(_req, res) => ...`) is a common, readable convention - don't flag it.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off", // a few call sites need it (Express type gaps); not worth banning project-wide
    },
  }
);
