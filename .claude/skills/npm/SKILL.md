---
name: npm
description: npm and Node.js tooling practices — use when managing dependencies, npm scripts, package.json, lockfiles, or diagnosing install/build issues.
---

# npm

Guidelines for Node package management and scripts.

## Dependencies
- Before adding a package: check `package.json` — it may already be there, or an existing dependency may cover the need.
- `npm install <pkg>` for runtime deps, `--save-dev` for build/test tooling. Pin nothing by hand — let the lockfile do exact versions.
- ALWAYS commit `package-lock.json` together with `package.json`; never edit the lockfile manually.
- Use `npm ci` (not `npm install`) in CI and clean-room installs — it's faster and respects the lockfile exactly.

## Scripts & workflow
- Put repeatable commands in `"scripts"` and run them with `npm run <name>`; pass extra args after `--` (e.g. `npm run dev -- --port 3000`).
- Check Node version compatibility (`engines` field, `.nvmrc`) when installs or builds fail mysteriously.

## Diagnosing problems
- Install/build weirdness: `rm -rf node_modules package-lock.json && npm install` is the last resort, not the first — try `npm ci` first.
- `npm ls <pkg>` to see why a package is present and which versions are in the tree.
- Security: `npm audit` findings in dev-only tooling are usually low urgency; runtime dependency advisories matter — check the dependency path before panicking or force-upgrading.
