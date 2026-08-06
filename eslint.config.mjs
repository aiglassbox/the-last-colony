import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // `pipeline/**` is the retrieval engine: a separate package, Node rather than
  // Next, with its own toolchain. Next's lint rules do not apply to it.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "pipeline/**"]),
]);

export default eslintConfig;
