import { fixupPluginRules } from "@eslint/compat";
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettierConfig from "eslint-config-prettier/flat";
import importPlugin from "eslint-plugin-import";
import typescriptPlugin from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "packages/*/build/",
      "packages/*/.react-router/",
      "packages/runtime/bin/",
    ],
  },
  eslint.configs.recommended,
  typescriptPlugin.configs.strictTypeChecked,
  typescriptPlugin.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: fixupPluginRules(importPlugin) },
    rules: {
      curly: "warn",
      eqeqeq: "warn",
      "no-console": "warn",
      "no-constant-condition": ["warn", { checkLoops: false }],
      "no-fallthrough": ["warn", { allowEmptyCase: true }],
      "no-template-curly-in-string": "warn",
      "sort-imports": ["warn", { ignoreDeclarationSort: true }],

      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/explicit-member-accessibility": "warn",
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "interface",
          format: ["PascalCase"],
          custom: { regex: "^I[A-Z]", match: false },
        },
      ],
      "@typescript-eslint/no-confusing-void-expression": "warn",
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowWithName: "^Register$" },
      ],
      "@typescript-eslint/no-unnecessary-condition": [
        "warn",
        { allowConstantLoopConditions: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true },
      ],
      "@typescript-eslint/prefer-enum-initializers": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": [
        "warn",
        { ignoreConditionalTests: true, ignoreMixedLogicalExpressions: true },
      ],
      "@typescript-eslint/promise-function-async": "warn",
      "@typescript-eslint/restrict-template-expressions": [
        "warn",
        { allowNumber: true },
      ],
      "@typescript-eslint/return-await": ["warn", "always"],

      "import/consistent-type-specifier-style": ["warn", "prefer-top-level"],
      "import/newline-after-import": "warn",
      "import/no-default-export": "warn",
      "import/no-duplicates": "warn",
      "import/order": [
        "warn",
        {
          alphabetize: {
            order: "asc",
            orderImportKind: "asc",
            caseInsensitive: true,
          },
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "always",
          pathGroupsExcludedImportTypes: ["builtin"],
        },
      ],
    },
  },
  {
    // the console is these modules' output surface
    files: [
      "packages/runtime/src/{account-store,cli,device-auth,provisioner,reporter,scenario,store}.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
  {
    // react-router finds the testbed's routes, root and config files by
    // default export — and the walk CLI its config, entry and scenarios
    files: [
      "packages/testbed/*.ts",
      "packages/testbed/src/app/root.tsx",
      "packages/testbed/src/app/routes.ts",
      "packages/testbed/src/app/routes/*.tsx",
      "packages/testbed/src/walk/scenario.ts",
      "packages/testbed/scenarios/*.ts",
    ],
    rules: {
      "import/no-default-export": "off",
    },
  },
  {
    files: ["**/*.js", "**/knip.config.ts"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "import/no-default-export": "off",
    },
  },
  {
    // Playwright reporters are loaded by their default export
    files: ["packages/runtime/src/reporter.ts"],
    rules: {
      "import/no-default-export": "off",
    },
  },
  prettierConfig,
);
