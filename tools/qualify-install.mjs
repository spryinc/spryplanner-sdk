import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  cp,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { root, manifest, npm, npmCli, sha256 } from "./common.mjs";
const candidate = JSON.parse(
  await readFile(path.join(root, "artifacts/candidate.json"), "utf8"),
);
const bytes = await readFile(path.join(root, "artifacts", candidate.filename));
if (sha256(bytes) !== candidate.sha256)
  throw Error("Candidate checksum mismatch");
const work = await realpath(
  await mkdtemp(path.join(tmpdir(), "spry-sdk-install-")),
);
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    /^(PATH|TMPDIR|TEMP|TMP|SYSTEMROOT|LANG|LC_ALL|NO_COLOR)$/.test(name),
  ),
);
async function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: cleanEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (value) => {
      out = (out + value).slice(-16000);
    });
    child.stderr.on("data", (value) => {
      out = (out + value).slice(-16000);
    });
    const timeout = setTimeout(() => child.kill(), 120000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve(out)
        : reject(Error(`External consumer failed (${code}): ${out}`));
    });
  });
}
let server;
try {
  const pack = async (directory) =>
    JSON.parse(
      npm(
        [
          "pack",
          directory,
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          work,
        ],
        work,
        cleanEnv,
      ),
    )[0];
  const zod = JSON.parse(
    await readFile(path.join(root, "node_modules/zod/package.json"), "utf8"),
  );
  // Use the published dependency archive: repacking an installed dependency can
  // lose files through the enclosing checkout's ignore rules.
  const zodPack = await pack(`zod@${zod.version}`);
  const compiler = await pack(path.join(root, "node_modules/typescript"));
  const archives = new Map([
    ["/sdk.tgz", bytes],
    ["/zod.tgz", await readFile(path.join(work, zodPack.filename))],
  ]);
  let origin = "";
  let requests = new Set();
  server = createServer((request, response) => {
    const route = decodeURIComponent(
      new URL(request.url, "http://registry.invalid").pathname,
    );
    requests.add(route);
    if (archives.has(route)) {
      response
        .writeHead(200, { "content-type": "application/octet-stream" })
        .end(archives.get(route));
      return;
    }
    const pkg =
      route === `/${manifest().name}`
        ? manifest()
        : route === "/zod"
          ? zod
          : null;
    if (!pkg || request.method !== "GET") {
      response.writeHead(404).end();
      return;
    }
    const sdk = pkg.name === manifest().name;
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        name: pkg.name,
        "dist-tags": { latest: pkg.version },
        versions: {
          [pkg.version]: {
            ...pkg,
            dist: {
              tarball: origin + (sdk ? "/sdk.tgz" : "/zod.tgz"),
              integrity: sdk ? candidate.integrity : zodPack.integrity,
              shasum: sdk ? candidate.shasum : zodPack.shasum,
            },
          },
        },
      }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const reports = [];
  for (const manager of ["npm", "pnpm"]) {
    requests = new Set();
    const cwd = path.join(work, manager);
    await mkdir(cwd);
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await writeFile(path.join(cwd, "empty.npmrc"), "");
    await writeFile(path.join(cwd, "global.npmrc"), "");
    await writeFile(path.join(cwd, ".npmrc"), `registry=${origin}\n`);
    await cp(path.join(root, "tools/fixtures"), path.join(cwd, "src"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
          skipLibCheck: false,
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          outDir: "compiled",
        },
        include: ["src/types.mts", "src/platform.mts", "src/platform.cts"],
      }),
    );
    const options = [
      `--userconfig=${path.join(cwd, "empty.npmrc")}`,
      `--globalconfig=${path.join(cwd, "global.npmrc")}`,
    ];
    const cli = manager === "npm" ? npmCli : process.env.PNPM_CLI;
    if (!cli) throw Error("PNPM_CLI must be the pinned pnpm JavaScript entry");
    const version = (await run([cli, "--version"], cwd)).trim();
    if (manager === "pnpm" && version !== "11.1.2")
      throw Error("Unexpected pnpm version");
    const args =
      manager === "npm"
        ? [
            cli,
            ...options,
            "install",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--cache",
            path.join(cwd, "cache"),
          ]
        : [
            cli,
            "add",
            "--ignore-scripts",
            "--ignore-workspace",
            `--config.userconfig=${path.join(cwd, "empty.npmrc")}`,
            `--config.globalconfig=${path.join(cwd, "global.npmrc")}`,
            "--config.manage-package-manager-versions=false",
            "--config.verify-deps-before-run=false",
            "--store-dir",
            path.join(cwd, "store"),
            "--cache-dir",
            path.join(cwd, "cache"),
            "--config.state-dir",
            path.join(cwd, "state"),
          ];
    await run(
      [
        ...args,
        "--registry",
        origin,
        candidate.package,
        path.join(work, compiler.filename),
      ],
      cwd,
    );
    for (const required of [
      `/${manifest().name}`,
      "/zod",
      "/sdk.tgz",
      "/zod.tgz",
    ])
      if (!requests.has(required)) throw Error("Fresh registry fetch missing");
    const installed = await realpath(
      path.join(cwd, "node_modules", manifest().name),
    );
    if (!installed.startsWith(cwd + path.sep))
      throw Error("Installed package escaped external project");
    await run(
      [
        path.join(cwd, "node_modules/typescript/bin/tsc"),
        "-p",
        "tsconfig.json",
      ],
      cwd,
    );
    await run([path.join(cwd, "compiled/platform.mjs")], cwd);
    await run([path.join(cwd, "compiled/platform.cjs")], cwd);
    reports.push({
      manager,
      version,
      sha256: candidate.sha256,
      sourceDigest: candidate.sourceDigest,
      status: "passed",
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      freshConsumerCache: true,
      registryTarballsFetched: true,
      installedOutsideRepository: true,
      checks: [
        "types",
        "esm",
        "commonjs",
        "prepared-command",
        "http-error",
        "key-redaction",
      ],
      regionalApiAuthorization: false,
    });
  }
  const report = {
    schemaVersion: 1,
    status: "passed",
    sha256: candidate.sha256,
    sourceDigest: candidate.sourceDigest,
    sourceCommit: candidate.sourceCommit,
    packageManagers: reports,
  };
  await writeFile(
    path.join(
      root,
      `artifacts/install-${process.platform}-${process.arch}.json`,
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await rm(work, { recursive: true, force: true });
}
