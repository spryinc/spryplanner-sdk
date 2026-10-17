import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { root, npm, sha256 } from "./common.mjs";
const [destination, kind, expected] = process.argv.slice(2);
if (!destination || !["initial", "oidc"].includes(kind))
  throw Error("Use an explicit destination and initial/oidc bootstrap kind");
if (process.env.GITHUB_ACTIONS && !/^[a-f0-9]{64}$/.test(expected ?? ""))
  throw Error("GitHub bootstrap requires the explicitly reviewed SHA-256");
const version = kind === "initial" ? "0.0.0-bootstrap.1" : "0.0.0-bootstrap.2";
await mkdir(destination, { recursive: true });
const pkg = {
  name: "@spryinc/spryplanner-sdk",
  version,
  description:
    "Package-name reservation only; not a usable SpryPlanner SDK release",
  license: "Apache-2.0",
  repository: {
    type: "git",
    url: "https://github.com/spryinc/spryplanner-sdk.git",
  },
  files: ["README.md", "LICENSE"],
  publishConfig: {
    access: "public",
    tag: "bootstrap",
    registry: "https://registry.npmjs.org/",
  },
};
await writeFile(
  path.join(destination, "package.json"),
  JSON.stringify(pkg, null, 2) + "\n",
);
await writeFile(
  path.join(destination, "README.md"),
  "# SpryPlanner SDK name reservation\n\nThis package reserves the SpryPlanner SDK name so npm trusted publishing can\nbe configured. It contains no executable SDK code. The SDK alpha is not yet\nreleased. Do not approve this staged documentation package as an SDK release.\n",
);
await copyFile(path.join(root, "LICENSE"), path.join(destination, "LICENSE"));
const packed = JSON.parse(
  npm(
    [
      "pack",
      destination,
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      destination,
    ],
    root,
  ),
)[0];
if (
  packed.files.length !== 3 ||
  !packed.files.every((file) =>
    ["README.md", "LICENSE", "package.json"].includes(file.path),
  )
)
  throw Error("Bootstrap must contain documentation and metadata only");
const archive = path.join(destination, packed.filename),
  hash = sha256(await readFile(archive));
if (expected && hash !== expected)
  throw Error(
    "Bootstrap differs from the explicitly approved reservation archive",
  );
console.log(
  JSON.stringify({
    archive,
    sha256: hash,
    version,
    files: packed.files.map((file) => file.path),
  }),
);
