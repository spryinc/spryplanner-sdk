# SpryPlanner TypeScript SDK candidate

An unreleased, compiled personal-task SDK for trusted Node.js applications.
The candidate is @spryinc/spryplanner-sdk@0.1.0-alpha.1; no public npm SDK
release is available yet.

Node.js 24.17.0 is the qualified runtime. The engine range is Node 24.17–24.x;
other Node releases, browsers, Bun, Deno and edge workers are not qualified.
Both ESM and CommonJS entry points include declarations. The only runtime
package dependency is the canonical contract's pinned `zod@3.25.76` validator.
Account, domain, React, workspace packages and source TypeScript are not required
by an installed consumer. Package usage does not grant additional permissions.

## Use the candidate artifact

Install the reviewed tarball supplied with its SHA-256, using your normal package
manager. Do not use a guessed public npm install command before publication.
For example, `npm install /trusted/path/spryinc-spryplanner-sdk-0.1.0-alpha.1.tgz`.
Obtain an expiring scoped key through Settings → Integrations → API keys.
Supply its regional HTTPS origin and workspace ID; keep secrets in an environment
or secret manager, never browser bundles, URLs, logs or AI prompts.

```ts
import { SpryPlannerClient, newTaskId } from "@spryinc/spryplanner-sdk";

const client = new SpryPlannerClient({
  baseUrl: process.env.SPRY_API_BASE_URL!,
  workspaceId: process.env.SPRY_WORKSPACE_ID!,
  apiKey: process.env.SPRY_API_KEY!,
});
await client.discover();
const id = newTaskId();
const command = client.prepareCreateTask({ id, title: "Review priorities" });
// Persist the command before sending if recovery must survive a process restart.
await client.execute(command);
const task = await client.getTask(id);
```

Supported operations: workspace/grant discovery, explicit task read, filtered
query and async pagination, create, versioned content edit, completion, reopening,
and operation-receipt lookup. The types and runtime validation derive from the
actual API contracts. This candidate does not expose account/session/key
management, OAuth, hosted MCP, other domains or Pro orchestration.

## Recovery and cancellation

Mutations are never automatically retried or assigned a new identity on failure.
Keep the exact prepared command. A `SpryPlannerTransportError.operationId` means
that the response is uncertain: look up `client.operation(operationId)` and, when
appropriate, replay the same command. Expired/unavailable receipts are not proof
that nothing happened. Reconcile authoritative state before forming new intent.
HTTP errors retain status, canonical error/conflict details, Retry-After and the
command operation ID. Treat command 5xx responses as potentially uncertain too.

After a version conflict, read the current task, resolve the change deliberately
and prepare a new operation using its current version. Editing, completing and
reopening require explicit versions. Do not silently overwrite a stale version.

Every method accepts `{ signal, timeoutMs }`; the HTTP deadline defaults to
30 seconds and is limited to 1–120,000 ms. The key-provider callback may be used
with your secret manager. Requests disallow redirects, use no-store caching and
do not follow regional hints automatically. Pagination follows opaque cursors,
rejects repeated cursors and stops at 1,000 pages; continue explicitly when needed.

## Build, provenance and maintenance

The repository's pinned Node wrapper runs `scripts/ci/build-typescript-sdk.mjs`.
Its normal path reuses a successful build only when checked source, actual
installed tool/dependency closure, configuration, runtime, environment and output
hashes match. `--force-rerun` explicitly rebuilds. External installation and live
API qualification always run fresh.

The qualification installs by version from an ephemeral loopback npm registry
into a project outside the monorepo, using both npm and pinned pnpm 11.1.2, each with fresh isolated caches/stores. It typechecks both
module formats and runs the task/recovery workflow. Artifact SHA-256, integrity,
Node version and evidence scope are recorded in `artifacts/qualification.json`.
Public registry provenance, package-name ownership, platform matrix and P21
release acceptance are not implied by this local distribution test.

Owner: SDK/tooling; product/release approval: Paul Bohman. Before releasing, pin
this candidate's checksums and source identity, obtain registry ownership, run
P21 acceptance and publish immutable versions with provenance. For rollback,
pin the previous qualified version and communicate incompatibilities; never
replace a published version or treat unpublishing as the normal rollback path.

## License

The SDK and its bundled Spry contract code use Apache-2.0. See LICENSE and
NOTICE. Bundled third-party MIT notices are preserved in THIRD-PARTY-LICENSES.
This grant does not change the licensing of other repository packages or the
service's paid API entitlement requirements.

## Release administration

See [RELEASING.md](RELEASING.md) for ownership evidence, OIDC setup, release
approval fields, qualification and the remaining public-source/P21 gates.
