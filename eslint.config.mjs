// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/next-env.d.ts",
      "prototype/**",
      "deploy/**",
      "docs/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["error"] }],
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["packages/db/src/**", "apps/*/src/**", "scripts/**", "**/*.test.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Plain Node scripts: no TypeScript project, Node globals available.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", fetch: "readonly", URL: "readonly" },
    },
  },
);
