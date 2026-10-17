import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import path from "node:path";
import {
  root,
  packageRoot,
  manifest,
  sha256,
  sourceDigest,
  npm,
} from "./common.mjs";
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const pack = JSON.parse(
  npm(
    [
      "pack",
      packageRoot,
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      artifacts,
    ],
    root,
  ),
)[0];
const required = ["LICENSE", "NOTICE", "THIRD-PARTY-LICENSES"];
if (required.some((file) => !pack.files.some((entry) => entry.path === file)))
  throw Error("Missing package license notices");
if (
  pack.files.some(
    ({ path: file }) =>
      ![
        "package.json",
        "README.md",
        "CHANGELOG.md",
        "LICENSE",
        "NOTICE",
        "THIRD-PARTY-LICENSES",
        "RELEASING.md",
      ].includes(file) && !/^dist\/index\.(?:js|cjs|d\.ts|d\.cts)$/.test(file),
  )
)
  throw Error("Unexpected package contents");
for (const file of ["index.js", "index.cjs", "index.d.ts", "index.d.cts"])
  if (
    /@spry\/|\/Users\/|["'](?:workspace:|file:)/.test(
      await readFile(path.join(packageRoot, "dist", file), "utf8"),
    )
  )
    throw Error("Private/source dependency leaked into candidate");
for (const file of ["index.js", "index.cjs", "index.d.ts", "index.d.cts"]) {
  const text = await readFile(path.join(packageRoot, "dist", file), "utf8");
  for (const reference of ts.preProcessFile(text, true, true).importedFiles)
    if (reference.fileName !== "zod" && !reference.fileName.startsWith("zod/"))
      throw Error(`Undeclared SDK runtime/type import: ${reference.fileName}`);
}
const bytes = await readFile(path.join(artifacts, pack.filename));
const report = {
  schemaVersion: 1,
  package: `${manifest().name}@${manifest().version}`,
  manifest: manifest(),
  filename: pack.filename,
  sha256: sha256(bytes),
  integrity: pack.integrity,
  shasum: pack.shasum,
  sourceDigest: sourceDigest(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  node: process.versions.node,
  files: pack.files.map((file) => file.path),
};
await writeFile(
  path.join(artifacts, "candidate.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    package: report.package,
    sha256: report.sha256,
    sourceDigest: report.sourceDigest,
  }),
);
