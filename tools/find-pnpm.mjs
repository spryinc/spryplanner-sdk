import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
const explicit = process.env.PNPM_CLI;
let selected = explicit && existsSync(explicit) ? explicit : null;
for (const directory of [
  process.env.PNPM_HOME,
  ...(process.env.PATH ?? "").split(path.delimiter),
].filter(Boolean)) {
  if (selected) break;
  for (const file of [
    path.resolve(directory, "../pnpm/package.json"),
    path.resolve(directory, "node_modules/pnpm/package.json"),
    path.resolve(directory, "../lib/node_modules/pnpm/package.json"),
  ]) {
    try {
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      if (pkg.name !== "pnpm" || pkg.version !== "11.1.2") continue;
      const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.pnpm;
      selected = realpathSync(path.resolve(path.dirname(file), bin));
      break;
    } catch {}
  }
}
if (!selected)
  throw Error(
    "Cannot locate pnpm 11.1.2 from pnpm/action-setup; supply PNPM_CLI explicitly",
  );
console.log(`PNPM_CLI=${selected}`);
