import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescriptConfig from "eslint-config-next/typescript";

/**
 * eslint-config-next v16 ships native flat configs, so FlatCompat is neither
 * needed nor compatible here.
 */
const eslintConfig = [
  {
    // v1 source is gone from git; `client/` may still linger on disk as
    // untracked build artifacts until it is deleted manually.
    ignores: ["client/**", ".next/**", "node_modules/**", "prisma/migrations/**"],
  },
  ...coreWebVitals,
  ...typescriptConfig,
];

export default eslintConfig;
