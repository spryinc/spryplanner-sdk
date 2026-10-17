import {
  existsSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { hashTrees } from "./verification/receipts.mjs";
export const root = fileURLToPath(new URL("../", import.meta.url));
export const packageRoot = path.join(root, "packages/sdk-typescript");
export const manifest = () =>
  JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const sourceDigest = () =>
  hashTrees({
    sdk: path.join(root, "packages/sdk-typescript/src"),
    contract: path.join(root, "packages/api-contract/src"),
  }).digest;
export const npmCli = [
  path.resolve(
    path.dirname(process.execPath),
    "../lib/node_modules/npm/bin/npm-cli.js",
  ),
  path.resolve(
    path.dirname(process.execPath),
    "node_modules/npm/bin/npm-cli.js",
  ),
].find(existsSync);
if (!npmCli)
  throw Error("npm CLI for the selected Node installation is missing");
export function npm(args, cwd, env = process.env) {
  const scratch = mkdtempSync(path.join(tmpdir(), "spry-sdk-npm-pack-"));
  const user = path.join(scratch, "user.npmrc"),
    global = path.join(scratch, "global.npmrc");
  writeFileSync(user, "");
  writeFileSync(global, "");
  const clean = Object.fromEntries(
    Object.entries(env).filter(([name]) =>
      /^(PATH|TMPDIR|TEMP|TMP|SYSTEMROOT|LANG|LC_ALL|NO_COLOR)$/.test(name),
    ),
  );
  try {
    return execFileSync(
      process.execPath,
      [
        npmCli,
        "--userconfig",
        user,
        "--globalconfig",
        global,
        "--cache",
        path.join(scratch, "cache"),
        ...args,
      ],
      { cwd, env: clean, encoding: "utf8", maxBuffer: 4e6 },
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
