import { FlatCompat } from "@eslint/eslintrc";
import { arsUi } from "./eslint-ui-rules.mjs";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "coverage/**", "reference/**", "next-env.d.ts", "test-results/**", "playwright-report/**", ".claude/worktrees/**"],
  },
  {
    // Standalone CommonJS scripts run directly by Node, outside the bundler.
    files: ["scripts/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // v1.89.0 (D-422): the design tokens stay the only control sizes, spacing and type sizes.
    files: ["app/**/*.{ts,tsx}", "features/**/*.{ts,tsx}"],
    plugins: { "ars-ui": arsUi },
    rules: { "ars-ui/control-size": "error", "ars-ui/spacing-scale": "error", "ars-ui/type-scale": "error" },
  },
  {
    // v1.89.0 (D-425, UIQA-CON-08 / ERR-01): one date formatter (lib/format/date.ts) for every text people read.
    files: ["app/**/*.{ts,tsx}", "features/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "server/**/*.{ts,tsx}"],
    plugins: { "ars-ui": arsUi },
    rules: { "ars-ui/date-format": "error" },
  },
  {
    // v1.89.0 stage 4 (D-426): one date picker everywhere (no native date inputs).
    files: ["app/**/*.tsx", "features/**/*.tsx", "components/**/*.tsx"],
    plugins: { "ars-ui": arsUi },
    rules: { "ars-ui/date-input": "error" },
  },
];

export default eslintConfig;
