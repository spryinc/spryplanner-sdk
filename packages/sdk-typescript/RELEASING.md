# SDK releases

This public repository contains the real SDK/contract/build sources used for
npm provenance. The main application repository remains private. Source enters
through a feature PR into develop and a reviewed develop-to-main promotion.

CI builds and audits one tarball on Linux, then installs those same bytes by
name/version through an isolated registry on Linux, macOS and Windows, using
both npm and pinned pnpm. Each consumer has fresh caches/stores and compiles
strict ESM/CommonJS declarations. These are installation/compatibility checks;
they do not claim to exercise the regional API authorization implementation.
Unit/build/type checks reuse content-addressed receipts only when actual sources,
installed dependency closure, configuration, runtime, environment and outputs
match. --force-rerun is available. Live installation and service checks run fresh.

Before release, qualify this exact tarball against the real regional API and
complete P21 on a deployed candidate: eligible human sign-in, self-service scoped
key, external SDK task/recovery workflow, revocation/downgrade. Record sanitized
artifact/source-bound evidence in release-acceptance.json. It is pending today.
Keep private:true until acceptance is complete, then requalify the final archive.
Never copy credentials, customer content or private server code into this repo.

The main-only typescript-sdk-release.yml workflow resolves a successful main CI
run associated with a merged promotion PR. It verifies the reviewed SHA-256,
all OS/installer reports and service acceptance before the protected publish job.
That job requires the npm-sdk-release environment, Paul’s explicit human review, including releases Paul initiates (self-approval
was explicitly authorized for this solo-maintainer repository). Administrator
bypass is disabled; main-only deployment policy remains enforced.
The publish job reuses the exact tarball; it does not rebuild after approval.
No NPM_TOKEN secret is used. npm provenance is generated from this public repo.

## npm trusted publisher

Package: @spryinc/spryplanner-sdk. GitHub organization: spryinc. Repository:
spryplanner-sdk. Workflow filename: typescript-sdk-release.yml. Environment:
npm-sdk-release. Initially allow staging only; enable direct publishing only
once the above release gates are qualified. Never grant dist-tag management
unless a later release needs it. After OIDC works, disallow traditional publishing
tokens in npm package settings while retaining interactive owner 2FA recovery.

npm requires the package to exist before a trusted publisher can be registered.
A separately approved minimal bootstrap using npm stage publish can reserve the
name with public placeholder 0.0.0-stage while keeping staged SDK content private
until an owner approves it with 2FA. Staged bootstrap is not an SDK release. Do not
approve a staged SDK or create a placeholder without explicit owner approval.
Use npm >=11.15 for staged bootstrap (the pinned Node bundle's npm 11.13 does not
support that command); provision the newer npm CLI in isolated administrative
tooling, not by changing the SDK runtime or storing a long-lived CI token.
New trusted-publisher configurations expire without their first publish within
two days; time activation to readiness and verify registration through npm.

After publication, verify fresh public-registry npm/pnpm installation, integrity
and provenance. Roll back consumers to a qualified prior version; never overwrite
a version or routinely unpublish. Alpha is the only allowed release channel now.
