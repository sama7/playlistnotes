import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescriptConfig from "eslint-config-next/typescript";

/**
 * eslint-config-next v16 ships native flat configs, so FlatCompat is neither
 * needed nor compatible here.
 */
const eslintConfig = [
  {
    // v1 sources still present on this branch until they are removed.
    ignores: [
      "client/**",
      "routes/**",
      "db/**",
      "server.js",
      ".next/**",
      "node_modules/**",
      "prisma/migrations/**",
    ],
  },
  ...coreWebVitals,
  ...typescriptConfig,
];

export default eslintConfig;
