import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  hashTrees,
  inputIdentity,
  packageClosure,
  runRecordedCheck,
} from "./receipts.mjs";

const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "spry-verification-test-"),
  );
  temporaryDirectories.push(directory);
  for (const name of [
    "source",
    "fixtures",
    "configuration",
    "installed",
    "unrelated",
  ]) {
    fs.mkdirSync(path.join(directory, name));
    fs.writeFileSync(path.join(directory, name, "input"), "original");
  }
  const state = {
    command: ["pinned-node", "test", "auth"],
    sourceRoots: {
      source: path.join(directory, "source"),
      fixtures: path.join(directory, "fixtures"),
    },
    dependencyRoots: { installed: path.join(directory, "installed") },
    configurationRoots: {
      configuration: path.join(directory, "configuration"),
    },
    environment: { APP_ENV: "test", PRIVATE_CONFIG: "must-never-be-saved" },
    runtime: { node: "24.17.0", binary: "content", tool: "version" },
    outputs: [],
  };
  let executions = 0;
  const messages = [];
  const options = {
    suite: "fixture",
    cacheRoot: path.join(directory, "cache"),
    identify: () => inputIdentity(state),
    execute: async () => {
      executions += 1;
      return {
        exitCode: 0,
        outputDigest: crypto
          .createHash("sha256")
          .update("passed")
          .digest("hex"),
      };
    },
    report: (message) => messages.push(message),
  };
  return { directory, state, options, messages, executions: () => executions };
}

test("normal checks execute once, reuse by content, and ignore unrelated changes", async () => {
  const f = fixture();
  assert.equal((await runRecordedCheck(f.options)).reused, false);
  assert.equal((await runRecordedCheck(f.options)).reused, true);
  fs.writeFileSync(
    path.join(f.directory, "unrelated", "input"),
    "documentation/frontend edit",
  );
  assert.equal((await runRecordedCheck(f.options)).reused, true);
  fs.utimesSync(
    path.join(f.directory, "source", "input"),
    new Date(0),
    new Date(),
  );
  assert.equal((await runRecordedCheck(f.options)).reused, true);
  assert.equal(f.executions(), 1);
  assert.match(f.messages[0], /executed/);
  assert.match(f.messages[1], /reused/);
  const receipt = fs.readFileSync(
    path.join(
      f.options.cacheRoot,
      "fixture",
      `${inputIdentity(f.state).key}.json`,
    ),
    "utf8",
  );
  assert.equal(receipt.includes("must-never-be-saved"), false);
});

for (const dimension of [
  "source",
  "fixtures",
  "configuration",
  "installed",
  "environment",
  "runtime",
  "command",
]) {
  test(`${dimension} changes invalidate only the affected content identity`, async () => {
    const f = fixture();
    const initial = await runRecordedCheck(f.options);
    if (
      ["source", "fixtures", "configuration", "installed"].includes(dimension)
    )
      fs.writeFileSync(path.join(f.directory, dimension, "input"), "changed");
    else if (dimension === "environment")
      f.state.environment.APP_ENV = "different";
    else if (dimension === "runtime")
      f.state.runtime.binary = "changed installed runtime";
    else f.state.command.push("different argument");
    assert.equal((await runRecordedCheck(f.options)).reused, false);
    assert.equal(f.executions(), 2);
    assert.notEqual(inputIdentity(f.state).key, initial.key);
    assert.equal((await runRecordedCheck(f.options)).reused, true);
  });
}

test("new input files invalidate and restoring exact content reuses the earlier pass", async () => {
  const f = fixture();
  await runRecordedCheck(f.options);
  fs.writeFileSync(
    path.join(f.directory, "source", "new-test"),
    "new scenario",
  );
  await runRecordedCheck(f.options);
  fs.unlinkSync(path.join(f.directory, "source", "new-test"));
  assert.equal((await runRecordedCheck(f.options)).reused, true);
  assert.equal(f.executions(), 2);
});

test("force reruns the same identity and publishes a usable completed receipt", async () => {
  const f = fixture();
  const original = await runRecordedCheck(f.options);
  const forced = await runRecordedCheck({ ...f.options, force: true });
  assert.equal(original.key, forced.key);
  assert.equal(forced.reused, false);
  assert.equal(f.executions(), 2);
  assert.equal((await runRecordedCheck(f.options)).reused, true);
});

test("corrupt, incomplete, failed and missing receipts execute instead of passing", async () => {
  const f = fixture();
  const first = await runRecordedCheck(f.options);
  const receiptFile = path.join(
    f.options.cacheRoot,
    "fixture",
    `${first.key}.json`,
  );
  const good = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  for (const bad of [
    "{",
    JSON.stringify({ ...good, status: "running" }),
    JSON.stringify({ ...good, exitCode: 1 }),
    JSON.stringify({ ...good, outputDigest: null }),
    JSON.stringify({ ...good, inputs: {} }),
  ]) {
    fs.writeFileSync(receiptFile, bad);
    assert.equal((await runRecordedCheck(f.options)).reused, false);
  }
  fs.unlinkSync(receiptFile);
  assert.equal((await runRecordedCheck(f.options)).reused, false);
});

test("required outputs must still exist with matching bytes", async () => {
  const f = fixture();
  const artifact = path.join(f.directory, "required-output");
  f.state.outputs = [artifact];
  const execute = async () => {
    fs.writeFileSync(artifact, "verified artifact");
    return f.options.execute();
  };
  const options = { ...f.options, execute };
  await runRecordedCheck(options);
  assert.equal((await runRecordedCheck(options)).reused, true);
  fs.writeFileSync(artifact, "corrupt");
  assert.equal((await runRecordedCheck(options)).reused, false);
  fs.unlinkSync(artifact);
  assert.equal((await runRecordedCheck(options)).reused, false);
});

test("failed/interrupted checks preserve an independent pass without writing a success", async () => {
  const f = fixture();
  await runRecordedCheck(f.options);
  const failure = await runRecordedCheck({
    ...f.options,
    suite: "other",
    execute: async () => ({ exitCode: 1 }),
  });
  assert.equal(failure.exitCode, 1);
  await assert.rejects(
    runRecordedCheck({
      ...f.options,
      suite: "interrupted",
      execute: async () => {
        throw new Error("interrupted");
      },
    }),
  );
  assert.equal((await runRecordedCheck(f.options)).reused, true);
  assert.deepEqual(fs.readdirSync(f.options.cacheRoot), ["fixture"]);
});

test("source changes during execution do not produce a reusable pass", async () => {
  const f = fixture();
  const result = await runRecordedCheck({
    ...f.options,
    execute: async () => {
      fs.writeFileSync(
        path.join(f.directory, "source", "input"),
        "changed while running",
      );
      return f.options.execute();
    },
  });
  assert.equal(result.reused, false);
  assert.equal(result.exitCode, 1);
  assert.equal(fs.existsSync(f.options.cacheRoot), false);
  assert.equal((await runRecordedCheck(f.options)).reused, false);
});

test("the completed receipt cache stays bounded", async () => {
  const f = fixture();
  for (let number = 0; number < 12; number += 1) {
    f.state.environment.APP_ENV = String(number);
    await runRecordedCheck(f.options);
  }
  assert.equal(
    fs.readdirSync(path.join(f.options.cacheRoot, "fixture")).length,
    8,
  );
});

test("installed dependencies are traversed and hashed beyond their unchanged manifests", () => {
  const f = fixture();
  const parent = path.join(f.directory, "parent");
  const child = path.join(parent, "node_modules", "child");
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(
    path.join(parent, "package.json"),
    JSON.stringify({
      name: "parent",
      version: "1",
      dependencies: { child: "1" },
    }),
  );
  fs.writeFileSync(
    path.join(child, "package.json"),
    JSON.stringify({ name: "child", version: "1" }),
  );
  fs.writeFileSync(path.join(child, "runtime.js"), "original");
  const before = hashTrees(packageClosure([parent]));
  fs.writeFileSync(
    path.join(child, "runtime.js"),
    "changed without manifest/lock changes",
  );
  assert.notEqual(hashTrees(packageClosure([parent])).digest, before.digest);
  fs.rmSync(child, { recursive: true });
  assert.throws(
    () => packageClosure([parent]),
    /Missing verification dependency/,
  );
});

test("dependency links include target content and detect a missing target becoming present", () => {
  const f = fixture();
  const target = path.join(f.directory, "target");
  const link = path.join(f.directory, "source", "dependency-link");
  fs.symlinkSync(target, link);
  const missing = hashTrees(f.state.sourceRoots).digest;
  fs.writeFileSync(target, "original target");
  const present = hashTrees(f.state.sourceRoots).digest;
  assert.notEqual(present, missing);
  fs.writeFileSync(target, "modified target");
  assert.notEqual(hashTrees(f.state.sourceRoots).digest, present);
});

test("successful checks are retained when cache storage fails", async () => {
  const f = fixture();
  fs.writeFileSync(f.options.cacheRoot, "not a directory");
  assert.equal((await runRecordedCheck(f.options)).exitCode, 0);
  assert.equal(f.executions(), 1);
});

test("missing input proof runs once; missing required outputs cannot pass", async () => {
  const f = fixture();
  const unproved = await runRecordedCheck({
    ...f.options,
    identify: () => {
      throw new Error("missing input");
    },
  });
  assert.equal(unproved.reused, false);
  assert.equal(f.executions(), 1);
  f.state.outputs = [path.join(f.directory, "missing-output")];
  assert.equal((await runRecordedCheck(f.options)).exitCode, 1);
  assert.equal(fs.existsSync(f.options.cacheRoot), false);
});

test("unknown selection, live/instrumented runtime and custom config never reuse", async () => {
  const { testSelectionSupportsReuse } = await import("./receipts.mjs");
  assert.equal(testSelectionSupportsReuse("api-contract", [], {}), true);
  assert.equal(
    testSelectionSupportsReuse(
      "api",
      ["src/auth/agentRequestPolicy.test.ts"],
      {},
    ),
    true,
  );
  for (const [kind, args, environment, configs] of [
    ["api", [], {}, []],
    ["unknown", [], {}, []],
    ["api", ["src/newFeature.test.ts"], {}, []],
    ["api-contract", ["--config", "custom.js"], {}, []],
    ["api-contract", [], { DATABASE_URL: "local-test" }, []],
    ["api-contract", [], { NODE_OPTIONS: "instrumentation" }, []],
    ["api-contract", [], { NODE_V8_COVERAGE: "coverage" }, []],
    ["api-contract", [], {}, ["vitest.config.ts"]],
  ])
    assert.equal(
      testSelectionSupportsReuse(kind, args, environment, configs),
      false,
    );
});
