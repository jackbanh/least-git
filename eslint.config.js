import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Only the two standard hooks rules — skipping React Compiler rules
      // (set-state-in-effect, incompatible-library) which require opt-in to
      // React Compiler and produce false positives on our async loading pattern.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Honour the `_`-prefix convention for intentionally unused args/vars.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    ignores: ["dist/**", "src-tauri/**", "node_modules/**"],
  }
);
