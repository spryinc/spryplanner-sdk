import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value);
const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  ".dailydoit-local",
]);

/** Content, not timestamps/Git identity, determines reuse. Missing inputs fail. */
export function hashTrees(roots) {
  const entries = [];
  const visited = new Set();
  function visit(file, label) {
    if (fs.lstatSync(file).isSymbolicLink()) {
      entries.push([label, "symlink", fs.readlinkSync(file)]);
      try {
        fs.realpathSync(file);
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ELOOP") throw error;
        entries.push([label, "unresolved-link"]);
        return;
      }
    }
    const real = fs.realpathSync(file);
    const stat = fs.statSync(real);
    if (stat.isDirectory()) {
      // Resolve directory links once, including external file dependencies.
      if (visited.has(real)) return;
      visited.add(real);
      entries.push([label, "directory"]);
      for (const entry of fs.readdirSync(real).sort()) {
        if (ignoredDirectories.has(entry)) continue;
        visit(path.join(real, entry), `${label}/${entry}`);
      }
    } else if (stat.isFile()) {
      entries.push([label, digest(fs.readFileSync(real))]);
    } else {
      throw new Error(`Unsupported verification input: ${label}`);
    }
  }
  for (const [label, file] of Object.entries(roots).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    visit(file, label);
  return { digest: digest(canonical(entries)), entries: entries.length };
}

export function resolvePackageDirectory(name, from) {
  let directory = path.resolve(from);
  for (;;) {
    const candidate = path.join(directory, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json")))
      return fs.realpathSync(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/** Hash the installed tool/runtime dependency closure, not just lockfile claims. */
export function packageClosure(packageDirectories) {
  const pending = [...packageDirectories];
  const seen = new Set();
  const directories = {};
  while (pending.length) {
    const directory = fs.realpathSync(pending.pop());
    if (seen.has(directory)) continue;
    seen.add(directory);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf8"),
    );
    directories[`${manifest.name}@${manifest.version}:${directory}`] =
      directory;
    const dependencies = {
      ...manifest.peerDependencies,
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };
    for (const name of Object.keys(dependencies)) {
      const installed = resolvePackageDirectory(name, directory);
      const optional =
        name in (manifest.optionalDependencies ?? {}) ||
        manifest.peerDependenciesMeta?.[name]?.optional;
      if (!installed) {
        if (optional || name in (manifest.peerDependencies ?? {})) continue;
        throw new Error(`Missing verification dependency: ${name}`);
      }
      pending.push(installed);
    }
  }
  return directories;
}

export function inputIdentity({
  command,
  sourceRoots,
  dependencyRoots,
  configurationRoots,
  environment,
  runtime,
  outputs = [],
}) {
  const inputs = {
    command,
    source: hashTrees(sourceRoots),
    dependencies: hashTrees(dependencyRoots),
    configuration: hashTrees(configurationRoots),
    // Only the aggregate digest is persisted; never environment values.
    environment: {
      names: Object.keys(environment).sort(),
      digest: digest(
        canonical(
          Object.entries(environment).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    },
    runtime,
    outputs,
  };
  return { key: digest(canonical(inputs)), inputs };
}

function outputIdentity(outputs) {
  return hashTrees(Object.fromEntries(outputs.map((file) => [file, file])));
}

export function reusableReceipt(file, identity) {
  try {
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      receipt.version !== 1 ||
      receipt.status !== "passed" ||
      receipt.exitCode !== 0 ||
      receipt.key !== identity.key ||
      !receipt.completedAt ||
      !/^[a-f0-9]{64}$/.test(receipt.outputDigest)
    )
      return false;
    if (canonical(receipt.inputs) !== canonical(identity.inputs)) return false;
    return (
      canonical(receipt.requiredOutputs) ===
      canonical(outputIdentity(identity.inputs.outputs))
    );
  } catch {
    return false;
  }
}

export async function runRecordedCheck({
  suite,
  cacheRoot,
  identify,
  execute,
  force = false,
  report = console.log,
}) {
  let before;
  try {
    before = identify();
  } catch {
    report(
      `[verification] executed ${suite} without reuse: input identity unavailable`,
    );
    return { ...(await execute()), reused: false };
  }
  const directory = path.join(cacheRoot, suite);
  const file = path.join(directory, `${before.key}.json`);
  if (!force && reusableReceipt(file, before)) {
    report(`[verification] reused ${suite} ${before.key.slice(0, 12)}`);
    return { exitCode: 0, reused: true, key: before.key };
  }
  report(
    `[verification] executed ${suite}${force ? " (forced)" : ""} ${before.key.slice(0, 12)}`,
  );
  const result = await execute();
  if (result.exitCode !== 0) return { ...result, reused: false };
  let after;
  try {
    after = identify();
  } catch {
    report(
      `[verification] ${suite} inputs could not be verified after execution`,
    );
    return { ...result, exitCode: 1, reused: false };
  }
  if (after.key !== before.key) {
    report(
      `[verification] ${suite} inputs changed during execution; verification must be rerun`,
    );
    return { ...result, exitCode: 1, reused: false };
  }
  let requiredOutputs;
  try {
    requiredOutputs = outputIdentity(after.inputs.outputs);
  } catch {
    report(`[verification] ${suite} did not produce its required outputs`);
    return { ...result, exitCode: 1, reused: false };
  }
  const receipt = {
    version: 1,
    status: "passed",
    exitCode: 0,
    key: after.key,
    inputs: after.inputs,
    requiredOutputs,
    outputDigest: result.outputDigest,
    completedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = path.join(
      directory,
      `${after.key}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    fs.writeFileSync(temporary, `${JSON.stringify(receipt)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
    // Bound only this runner's completed content-addressed receipts. Never prune
    // user artifacts, other suites, or unfinished/in-flight files.
    const completed = fs
      .readdirSync(directory)
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map((name) => ({
        name,
        mtime: fs.statSync(path.join(directory, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const entry of completed.slice(8))
      fs.unlinkSync(path.join(directory, entry.name));
  } catch {
    report(
      `[verification] ${suite} passed; receipt storage unavailable (no repeated execution)`,
    );
  }
  return { ...result, reused: false, key: after.key };
}

export function executeProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const output = crypto.createHash("sha256");
    const child = spawn(executable, args, {
      ...options,
      stdio: ["inherit", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      output.update(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output.update(chunk);
      process.stderr.write(chunk);
    });
    const forward = (signal) => child.kill(signal);
    const interrupt = () => forward("SIGINT");
    const terminate = () => forward("SIGTERM");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    child.once("error", reject);
    child.once("close", (code) => {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
      resolve({ exitCode: code ?? 1, outputDigest: output.digest("hex") });
    });
  });
}

export function testSelectionSupportsReuse(
  kind,
  args,
  environment,
  configFiles = [],
) {
  if (
    environment.DATABASE_URL ||
    environment.NODE_V8_COVERAGE ||
    environment.NODE_OPTIONS ||
    configFiles.length
  )
    return false;
  if (kind === "api-contract") return args.length === 0;
  const files = new Set([
    "src/recurrencePreview.test.ts",
    "src/auth/agentRequestPolicy.test.ts",
    "src/auth/AuthProvider.test.ts",
    "src/auth/requireAuthenticatedUser.test.ts",
  ]);
  return (
    kind === "api" && args.length > 0 && args.every((arg) => files.has(arg))
  );
}
