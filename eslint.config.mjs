import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noUncheckedSupabaseWrite from "./eslint-rules/no-unchecked-supabase-write.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    // An eslint-disable that suppresses nothing is indistinguishable from a
    // working one when a human reads it: it has a comment, it looks
    // deliberate, and it does nothing. ESLint defaults this to "warn"; here it
    // is an error, because it is a check on the checker.
    //
    // It has already caught two directives placed one line above where the
    // rule actually fires (the rule reports at the setState call, not at the
    // statement above it), and one directive that was genuinely unnecessary
    // because the fix beneath it had made the rule pass on its own — that one
    // came with a comment claiming the rule was suppressed, which would have
    // been false the moment it shipped.
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    plugins: {
      local: { rules: { "no-unchecked-supabase-write": noUncheckedSupabaseWrite } },
    },
    rules: {
      "local/no-unchecked-supabase-write": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
