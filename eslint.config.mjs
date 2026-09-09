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
    // `artifact/` is the packaged standalone build the runbook tells you to
    // create. It is gitignored and excluded from tsconfig; without it here too,
    // merely having deployed once makes `npm run lint` report thousands of
    // problems in generated code.
    ignores: [
      "client/**",
      ".next/**",
      "artifact/**",
      "node_modules/**",
      "prisma/migrations/**",
    ],
  },
  ...coreWebVitals,
  ...typescriptConfig,
  {
    // The production entry point must be CommonJS: Next's generated
    // `server.js` is CommonJS, and the wrapper has to `require` it in the same
    // module system. `.cjs` says so explicitly, so `require` is correct there.
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default eslintConfig;
