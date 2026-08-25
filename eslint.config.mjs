import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["src/modules/**/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next",
              message: "Domain code must remain independent of Next.js.",
            },
            {
              name: "react",
              message: "Domain code must remain independent of React.",
            },
            {
              name: "react-dom",
              message: "Domain code must remain independent of React DOM.",
            },
          ],
          patterns: [
            {
              group: [
                "next/*",
                "react/*",
                "react-dom/*",
                "node:*",
                "@/app/*",
                "@/ui/*",
                "**/infrastructure/**",
              ],
              message:
                "Domain code may depend only on domain-owned or deliberately shared pure code, not effectful infrastructure.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Domain code receives network results through explicit inputs.",
        },
        {
          name: "process",
          message: "Domain code must not read environment variables.",
        },
        {
          name: "window",
          message: "Domain code must not depend on browser state.",
        },
        {
          name: "document",
          message: "Domain code must not depend on the DOM.",
        },
        {
          name: "localStorage",
          message: "Domain code receives persisted state through explicit inputs.",
        },
        {
          name: "sessionStorage",
          message: "Domain code receives persisted state through explicit inputs.",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "out/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
