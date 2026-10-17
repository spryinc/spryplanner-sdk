import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { root, manifest, sha256, sourceDigest } from "./common.mjs";
export function validate({
  candidate,
  acceptance,
  installReports,
  repository,
  source,
  expectedHash,
}) {
  const require = (ok, message) => {
    if (!ok) throw Error(message);
  };
  require(repository ===
    "spryinc/spryplanner-sdk", "Unexpected publishing repository");
  require(candidate.sha256 === expectedHash, "Reviewed checksum differs");
  require(candidate.sourceDigest ===
    source, "Current sources differ from qualified sources");
  require(candidate.manifest.name === "@spryinc/spryplanner-sdk" &&
    candidate.manifest.license ===
      "Apache-2.0", "Package identity/license mismatch");
  require(candidate.manifest.private !==
    true, "SDK publication remains deliberately blocked");
  require(/^0\.\d+\.\d+-alpha\.\d+$/.test(
    candidate.manifest.version,
  ), "Alpha releases only");
  require(candidate.manifest.repository.url ===
    `https://github.com/${repository}.git`, "Repository metadata differs");
  require(candidate.manifest.publishConfig.access === "public" &&
    candidate.manifest.publishConfig.tag === "alpha" &&
    candidate.manifest.publishConfig.registry ===
      "https://registry.npmjs.org/", "Public npm alpha configuration required");
  require(acceptance.artifactSha256 === expectedHash &&
    acceptance.sourceDigest ===
      source, "Acceptance applies to another candidate");
  for (const gate of ["regionalApiQualification", "deployedOnboarding"])
    require(acceptance[gate]?.status === "passed" &&
      acceptance[gate]?.evidence, "Missing " + gate);
  const reports = installReports.filter(
    (report) =>
      report.sha256 === expectedHash && report.sourceDigest === source,
  );
  for (const platform of ["linux", "darwin", "win32"])
    for (const manager of ["npm", "pnpm"])
      require(reports.some(
        (report) =>
          report.status === "passed" &&
          report.packageManagers.some(
            (entry) =>
              entry.platform === platform &&
              entry.manager === manager &&
              entry.node === "24.17.0" &&
              entry.status === "passed" &&
              entry.freshConsumerCache &&
              entry.registryTarballsFetched &&
              entry.installedOutsideRepository,
          ),
      ), "Missing " + platform + "/" + manager + " qualification");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [directory, expectedHash] = process.argv.slice(2);
  if (!directory || !/^[a-f0-9]{64}$/.test(expectedHash ?? ""))
    throw Error("Supply reviewed artifacts and SHA-256");
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(directory);
  const json = async (file) =>
    JSON.parse(await readFile(path.join(directory, file), "utf8"));
  const candidate = await json("candidate.json");
  if (candidate.package !== `${manifest().name}@${manifest().version}`)
    throw Error("Version mismatch");
  const bytes = await readFile(path.join(directory, candidate.filename));
  if (sha256(bytes) !== expectedHash) throw Error("Tarball bytes differ");
  validate({
    candidate,
    expectedHash,
    source: sourceDigest(),
    repository: process.env.GITHUB_REPOSITORY,
    acceptance: JSON.parse(
      await readFile(path.join(root, "release-acceptance.json"), "utf8"),
    ),
    installReports: await Promise.all(
      files.filter((file) => /^install-.*\.json$/.test(file)).map(json),
    ),
  });
  console.log(path.join(directory, candidate.filename));
}
