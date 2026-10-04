import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const deepRelativeImports = {
  group: ["../../packages/*", "../../../packages/*", "**/packages/*/src/*"],
  message: "Import workspace packages by name (e.g. @sr/core), not by deep relative path.",
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-demo/**",
      "**/.turbo/**",
      "**/.expo/**",
      "**/coverage/**",
      "**/generated/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // `any` needs an explaining comment next to an eslint-disable (CLAUDE.md).
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-imports": ["error", { patterns: [deepRelativeImports] }],
    },
  },
  {
    // The web app and the browser-driven e2e scripts may use browser globals. packages/ui must not.
    files: ["apps/app/**", "e2e/**"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // The app may use the typed API client, never the API's server code (DB, env).
    files: ["apps/app/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "@sr/api", message: "Import the typed client from @sr/api/client." }],
          patterns: [deepRelativeImports],
        },
      ],
    },
  },
  prettier,
);
