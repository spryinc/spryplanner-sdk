import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const explicit = process.env.PNPM_CLI;
let selected = explicit && existsSync(explicit) ? explicit : null;
for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
  if (selected) break;
  try {
    const manifest = createRequire(
      path.resolve(directory, "__pnpm_lookup.cjs"),
    ).resolve("pnpm/package.json");
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    if (pkg.version !== "11.1.2") continue;
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.pnpm;
    selected = realpathSync(path.resolve(path.dirname(manifest), bin));
  } catch {}
}
if (!selected)
  throw Error(
    "Cannot locate pnpm 11.1.2 from pnpm/action-setup; supply PNPM_CLI explicitly",
  );
console.log(`PNPM_CLI=${selected}`);
