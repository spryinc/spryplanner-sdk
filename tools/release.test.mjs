import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./release.mjs";
const fixture = () => ({
  repository: "spryinc/spryplanner-sdk",
  source: "source",
  expectedHash: "hash",
  candidate: {
    sha256: "hash",
    sourceDigest: "source",
    manifest: {
      name: "@spryinc/spryplanner-sdk",
      version: "0.1.0-alpha.1",
      license: "Apache-2.0",
      repository: { url: "https://github.com/spryinc/spryplanner-sdk.git" },
      publishConfig: {
        access: "public",
        tag: "alpha",
        registry: "https://registry.npmjs.org/",
      },
    },
  },
  acceptance: {
    artifactSha256: "hash",
    sourceDigest: "source",
    regionalApiQualification: { status: "passed", evidence: "regional-proof" },
    deployedOnboarding: { status: "passed", evidence: "deployed-proof" },
  },
  installReports: ["linux", "darwin", "win32"].map((platform) => ({
    status: "passed",
    sha256: "hash",
    sourceDigest: "source",
    packageManagers: ["npm", "pnpm"].map((manager) => ({
      platform,
      manager,
      node: "24.17.0",
      status: "passed",
      freshConsumerCache: true,
      registryTarballsFetched: true,
      installedOutsideRepository: true,
    })),
  })),
});
test("accepts the same reviewed artifact only after all platform and service gates", () =>
  validate(fixture()));
for (const [name, mutate] of [
  [
    "wrong repository",
    (v) => {
      v.repository = "other/repo";
    },
  ],
  [
    "changed archive",
    (v) => {
      v.candidate.sha256 = "other";
    },
  ],
  [
    "changed source",
    (v) => {
      v.source = "other";
    },
  ],
  [
    "wrong license",
    (v) => {
      v.candidate.manifest.license = "UNLICENSED";
    },
  ],
  [
    "private package",
    (v) => {
      v.candidate.manifest.private = true;
    },
  ],
  [
    "stable release",
    (v) => {
      v.candidate.manifest.version = "1.0.0";
    },
  ],
  [
    "wrong metadata",
    (v) => {
      v.candidate.manifest.repository.url = "https://example.invalid";
    },
  ],
  [
    "latest tag",
    (v) => {
      v.candidate.manifest.publishConfig.tag = "latest";
    },
  ],
  [
    "other registry",
    (v) => {
      v.candidate.manifest.publishConfig.registry = "https://example.invalid";
    },
  ],
  [
    "wrong acceptance",
    (v) => {
      v.acceptance.artifactSha256 = "old";
    },
  ],
  [
    "missing regional API proof",
    (v) => {
      v.acceptance.regionalApiQualification.status = "pending";
    },
  ],
  [
    "missing deployed onboarding",
    (v) => {
      v.acceptance.deployedOnboarding.status = "pending";
    },
  ],
  [
    "missing Windows",
    (v) => {
      v.installReports.pop();
    },
  ],
  [
    "missing pnpm",
    (v) => {
      v.installReports[0].packageManagers.pop();
    },
  ],
  [
    "cached installation",
    (v) => {
      v.installReports[0].packageManagers[0].freshConsumerCache = false;
    },
  ],
  [
    "wrong runtime",
    (v) => {
      v.installReports[0].packageManagers[0].node = "22.0.0";
    },
  ],
  [
    "workspace link",
    (v) => {
      v.installReports[0].packageManagers[0].installedOutsideRepository = false;
    },
  ],
])
  test("rejects " + name, () => {
    const v = fixture();
    mutate(v);
    assert.throws(() => validate(v));
  });
