import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import quality from "./eslint-rules/index.cjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Este protótipo lê dados de localStorage/sessionStorage (sistemas externos ao
      // React) e precisa fazer isso em useEffect para evitar descompasso de hidratação
      // entre servidor e cliente — exatamente o caso de uso que a documentação do React
      // recomenda useEffect+setState. O React Compiler não está habilitado neste projeto
      // (reactCompiler não está em next.config.ts), então essas regras da suíte do
      // compilador são apenas ruído aqui.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  {
    files: ["src/**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    plugins: { quality },
    rules: {
      "quality/max-lines": ["error", { max: 350 }],
      "quality/no-direct-console": [
        "error",
        { logger: "the project logging helper" },
      ],
      // src/lib/db/prisma.ts is the only data-client export in this project;
      // src/app/** and src/components/** (the presentation layer) must go
      // through src/lib/repositories instead.
      "quality/no-direct-data-access": [
        "error",
        {
          modules: ["@/lib/db/prisma"],
          bindings: ["prisma"],
          layers: ["/src/app/", "/src/components/"],
          extensions: [".tsx"],
        },
      ],
    },
  },
  {
    // Same file budget for test files, at "warn" -- placed after the "error"
    // block above on purpose: for a file matched by both, flat config
    // applies the later block's rules last.
    files: [
      "**/*.test.{ts,tsx}",
      "**/{__tests__,__mocks__,fixtures,mocks}/**/*.{ts,tsx}",
    ],
    plugins: { quality },
    rules: {
      "quality/max-lines": ["warn", { includeTests: true }],
    },
  },
  {
    files: ["eslint-rules/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "readonly", require: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // backend/ is an independent npm project (NestJS) with its own lint tooling
    // (oxlint) — see docs/plans/migracao-nestjs-typeorm-neon.md.
    "backend/**",
    // Generated Prisma client -- not authored by hand, not part of what this
    // config polices.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
