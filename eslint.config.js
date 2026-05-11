import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      ".claude/**",
      ".remember/**",
      ".planning/**",
      ".superpowers/**",
      "server/**",
      "node_modules/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-namespace": "off",
      // Tvinga alla /api-anrop genom api.request() så CSRF, auth-header och
      // refresh-retry hanteras enhetligt. Raw fetch missar dessa och har gett
      // 403 (saknad CSRF-token) i prod.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='fetch'] > Literal[value=/^\\/api/]",
          message: "Använd api.request() (eller en api.* metod) istället för raw fetch mot /api — så får anropet CSRF-token, auth-header och refresh-retry automatiskt.",
        },
        {
          selector: "CallExpression[callee.name='fetch'] TemplateLiteral Identifier[name='API_BASE_URL']",
          message: "Använd api.request() (eller en api.* metod) istället för raw fetch mot ${API_BASE_URL} — så får anropet CSRF-token, auth-header och refresh-retry automatiskt.",
        },
      ],
    },
  },
  {
    files: ["src/components/ui/**/*.{ts,tsx}", "src/contexts/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // api.ts implementerar request()-wrappern och behöver raw fetch internt.
    // secureFileAccess.ts anropar /auth/refresh som är CSRF-exempt.
    files: ["src/lib/api.ts", "src/lib/secureFileAccess.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
);
