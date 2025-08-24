# Migration hand-off: api.js -> api.legacy.js shim

Brief: concise instructions and context so a developer can pick up the migration work.

## Checklist

- [ ] Delete the broken `api.js` in the repo root.
- [ ] Create a minimal compatibility shim `api.js` that prefers compiled outputs and falls back to `api.legacy.js`.
- [ ] Run CI locally and capture failing test/lint output.
- [ ] Pick a migration target (recommend: `MelCloudApi`) and port incrementally.

## What I did

- Created `api.legacy.js` as a trimmed-but-functional backup of the legacy API (force-added because the original was ignored by `.gitignore`).
- Added a compatibility shim for `api.js` during migration, but an accidental large appended legacy implementation ended up in `api.js` and caused duplicate declarations and parse errors (Jest reported issues such as "Identifier 'candidates' has already been declared").
- Branch: `cleanup/ci-eslint-legacymap` — commit: `chore(migration): add api.legacy.js backup (force) and api.js shim` (SHA: 42668c2).
- See `OVERVIEW.md` and `LEGACY_MAP.md` for migration context.

## Problem now

The repository contains a broken `api.js` where the legacy implementation was accidentally appended after the shim. That trailing code re-declares symbols (for example `candidates`) and can include top-level tokens that make Jest/TS parse fail. The safe remedy is to hard-delete `api.js` and create a small shim that only does the compatibility logic.

## Exact commands (run from repo root — zsh)

Delete the broken file:

```zsh
rm -f api.js
```

Create the minimal shim (this writes the full shim file content):

```zsh
cat > api.js <<'JS'
/* eslint-disable */
// @ts-nocheck
'use strict';

const path = require('path');

const candidates = [
  path.join(__dirname, 'lib', 'index.js'),
  path.join(__dirname, 'lib', 'api.js'),
  path.join(__dirname, '.homeybuild', 'src', 'api.js'),
  path.join(__dirname, '.homeybuild', 'api.js'),
  path.join(__dirname, 'dist', 'api.js'),
  path.join(__dirname, 'build', 'api.js'),
];

let impl;
for (const p of candidates) {
  try {
    impl = require(p);
    if (impl) break;
  } catch (err) {
    // ignore missing/parse errors from candidates
  }
}

if (!impl) {
  try {
    impl = require('./api.legacy.js');
  } catch (err) {
    throw new Error(
      'Failed to locate compiled api module and failed to require ./api.legacy.js - restore legacy file or build project. Original error: ' +
        err.message
    );
  }
}

module.exports = impl;
JS
```

Commit and push:

```zsh
git add api.js
git commit -m "chore(migration): replace api.js with minimal compatibility shim"
git push origin cleanup/ci-eslint-legacymap
```

## Verify

Install deps and run CI locally:

```zsh
npm ci
npm run ci
```

Quick smoke require:

```zsh
node -e "console.log(Boolean(require('./api.js')) ? 'api.js OK' : 'api.js failed')"
```

If the smoke require throws, inspect the stack to see which candidate path failed or whether `api.legacy.js` failed to load.

## Next suggested small tasks (pick one)

- Run CI/tests and paste failing output so it can be triaged and fixed.
- If tests require exact legacy behavior, restore a verbatim original `api.js` into `api.legacy.js` (I can add that full file on request).
- Start porting a single module (recommend `MelCloudApi`) into `src` as TypeScript, update callers, run tests and commit small iterative changes.

## Requirements coverage

- Hand-off description: included above.
- Instruction to delete `api.js` then create small shim: included and reproduced as commands.
- Verification steps and next tasks: included.

---

If you want, I can perform the delete + shim replacement and run `npm ci && npm run ci` and paste the failing output here — tell me to proceed and I will run it and report results.
