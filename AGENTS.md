# SDK development and publication

Use Node 24.17.0 and pnpm 11.1.2, pinned in .node-version/packageManager.
Source moves through a feature PR into develop and an intentional promotion PR
into main. Do not publish from an unreviewed branch or remove release gates.
The main SpryPlanner repository remains private. Export only SDK sources, their
required contract closure and reviewed build/qualification tooling. Never copy
private Git history, API/server implementations, .env files, secrets or user data.
Release builds use public sources; npm publishing uses OIDC and the protected
npm-sdk-release environment on main. Keep private:true until acceptance is ready.
Use normal verification commands; they reuse successful content-addressed
receipts when actual inputs/outputs match. --force-rerun deliberately reexecutes.
Installation, external API and deployed acceptance always require fresh evidence.
The npm bootstrap placeholder is not an SDK release; staged content requires
separate explicit approval before becoming available. Do not unpublish routinely.
