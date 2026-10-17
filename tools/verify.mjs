import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  hashTrees,
  inputIdentity,
  packageClosure,
  resolvePackageDirectory,
  runRecordedCheck,
} from "./verification/receipts.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const suite = process.argv[2];
const commands = {
  build: ["build.mjs"],
  test: [
    "node_modules/vitest/vitest.mjs",
    "run",
    "packages/sdk-typescript/src/index.test.ts",
  ],
  typecheck: [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
    "-p",
    "packages/sdk-typescript/tsconfig.json",
  ],
};
if (!commands[suite]) throw Error("Choose build, test or typecheck");
if (process.versions.node !== "24.17.0") throw Error("Use Node 24.17.0");
const outputs =
  suite === "build"
    ? ["index.js", "index.cjs", "index.d.ts", "index.d.cts"].map((file) =>
        path.join(root, "packages/sdk-typescript/dist", file),
      )
    : [];
const identify = () =>
  inputIdentity({
    command: { argv: commands[suite], cwd: root },
    sourceRoots: {
      sdk: path.join(root, "packages/sdk-typescript/src"),
      contract: path.join(root, "packages/api-contract/src"),
      verifier: path.join(root, "tools/verify.mjs"),
      receipts: path.join(root, "tools/verification/receipts.mjs"),
    },
    dependencyRoots: packageClosure(
      [
        "tsup",
        "typescript",
        "vitest",
        "zod",
        "@asteasolutions/zod-to-openapi",
      ].map((name) => resolvePackageDirectory(name, root)),
    ),
    configurationRoots: Object.fromEntries(
      [
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        ".npmrc",
        "tsconfig.base.json",
        ".node-version",
        "build.mjs",
        "packages/sdk-typescript/package.json",
        "packages/sdk-typescript/tsconfig.json",
      ].map((file) => [file, path.join(root, file)]),
    ),
    environment: Object.fromEntries(
      Object.entries(process.env).filter(([name]) =>
        /^(NODE_ENV|NODE_OPTIONS|NODE_PATH|TZ|LANG|LC_ALL|CI)$/.test(name),
      ),
    ),
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      binary: hashTrees({ node: process.execPath }).digest,
    },
    outputs,
  });
const result = await runRecordedCheck({
  suite: `sdk-${suite}`,
  cacheRoot: path.join(root, ".verification"),
  identify,
  force: process.argv.includes("--force-rerun"),
  execute: async () => {
    try {
      execFileSync(process.execPath, commands[suite], {
        cwd: root,
        stdio: "inherit",
      });
      return {
        exitCode: 0,
        outputDigest: hashTrees(
          Object.fromEntries(outputs.map((file) => [file, file])),
        ).digest,
      };
    } catch (error) {
      return { exitCode: error.status ?? 1 };
    }
  },
});
process.exitCode = result.exitCode;
