import { build } from "tsup";
await build({
  entry: { index: "packages/sdk-typescript/src/index.ts" },
  outDir: "packages/sdk-typescript/dist",
  format: ["esm", "cjs"],
  target: "es2022",
  platform: "neutral",
  splitting: false,
  bundle: true,
  external: ["zod"],
  noExternal: ["@asteasolutions/zod-to-openapi"],
  dts: { resolve: false },
  tsconfig: "packages/sdk-typescript/tsconfig.json",
  clean: true,
});
