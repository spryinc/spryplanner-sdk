import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
for (const version of ["11.1.2", "10.0.0"])
  test("pnpm/action-setup layout " + version, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "spry-pnpm-locator-"));
    try {
      const home = path.join(directory, "node_modules/.bin"),
        pkg = path.join(directory, "node_modules/pnpm");
      mkdirSync(home, { recursive: true });
      mkdirSync(path.join(pkg, "bin"), { recursive: true });
      writeFileSync(
        path.join(pkg, "package.json"),
        JSON.stringify({
          name: "pnpm",
          version,
          bin: { pnpm: "bin/pnpm.mjs" },
        }),
      );
      writeFileSync(path.join(pkg, "bin/pnpm.mjs"), "");
      const result = spawnSync(process.execPath, ["tools/find-pnpm.mjs"], {
        env: { PNPM_HOME: home, PATH: "" },
        encoding: "utf8",
      });
      if (version === "11.1.2") {
        assert.equal(result.status, 0);
        assert.match(result.stdout, /PNPM_CLI=.*pnpm[\\/]bin[\\/]pnpm.mjs/);
      } else assert.notEqual(result.status, 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
