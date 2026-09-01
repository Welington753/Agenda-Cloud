import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
