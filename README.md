# SpryPlanner TypeScript SDK

Apache-2.0 SDK for SpryPlanner personal-task integrations, with compiled ESM,
CommonJS and TypeScript declarations. **The alpha is not yet released on npm.**

Use Node 24.17.0 and pnpm 11.1.2. Install the locked build dependencies with
`pnpm install --frozen-lockfile --ignore-scripts`, then run `pnpm build`,
`pnpm test`, `pnpm typecheck`, `pnpm test:release`, `pnpm candidate` and
`pnpm qualify:install`. Consumers can use either npm or pnpm with the same package.

The SDK supports scoped-key discovery, task reads/queries, creation, versioned
edits, completion/reopening and operation-receipt recovery. API entitlement and
authorization remain service requirements; a permissive SDK license does not
grant free access to hosted paid capabilities. Keep API keys on a trusted server.

This repository contains the SDK and its required public contract/build source
closure. The main SpryPlanner repository stays private. No account/server
implementation or private repository history is included.

See [release administration](RELEASING.md), [the SDK usage guide](packages/sdk-typescript/README.md)
and [security reporting](SECURITY.md).
