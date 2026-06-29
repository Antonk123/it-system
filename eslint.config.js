import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist",
      "coverage",
      ".claude/**",
      ".remember/**",
      ".planning/**",
      ".superpowers/**",
      "node_modules/**",
      "tools/codemap/**",
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
      // react-hooks 7:s `recommended` drar numera in React Compiler-reglerna
      // (set-state-in-effect, refs, purity, immutability, preserve-manual-
      // memoization). Denna kodbas kör INTE React Compiler, och de reglerna ger
      // ~40 beteendekänsliga träffar över 20+ filer — adopteras som egen,
      // testad insats, inte via en dep-bump. Därför sätts de KLASSISKA reglerna
      // explicit (= tidigare beteende), versionsoberoende:
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
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
  {
    // Backend-filer: Node-globals, inga React-plugins, inga fetch-restriktioner.
    // prefer-const nedgraderas till warn — pre-existing let-destructuring i routes
    // ska inte blockera commits, men ska fortfarande synas i lint-output.
    files: ["server/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
    plugins: {},
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-refresh/only-export-components": "off",
      "no-restricted-syntax": "off",
      "prefer-const": "off",
      // ESM-paket ("type":"module"): __dirname/__filename finns inte som globaler.
      // Bare-användning ger ReferenceError i runtime men passerar tsc (@types/node
      // deklarerar dem globalt). Lokalt definierade consts skuggar globalen och
      // flaggas INTE — bara oavsiktlig global-användning fångas. Se bugs.md 2026-06-12.
      "no-restricted-globals": [
        "error",
        { name: "__dirname", message: "ESM saknar __dirname. Definiera lokalt: const __dirname = path.dirname(fileURLToPath(import.meta.url))" },
        { name: "__filename", message: "ESM saknar __filename. Definiera lokalt: const __filename = fileURLToPath(import.meta.url)" },
      ],
      // Tvinga användning av logger-instansen i server-koden — raw console.*
      // fångas inte av centraliserad loggning (strukturerat JSON, nivåfiltrering).
      "no-console": "error",
    },
  },
  {
    // logger.ts implementerar console.*-wrappern — måste tillåtas direkt.
    // cleanup-refresh-tokens.ts och migrations.ts är standalone-scripts som
    // körs utan logger-context och behöver console.* för diagnostik.
    files: [
      "server/src/lib/logger.ts",
      "server/src/db/cleanup-refresh-tokens.ts",
      "server/src/db/migrations.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
);
