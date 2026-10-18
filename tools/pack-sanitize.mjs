#!/usr/bin/env node
// prepack/postpack lifecycle hook for the two publishable packages.
//
// tools/bundle.mjs already inlines every `@nx-archweave/*` (and, where a
// runtime import demands it, `@clearlydev/nx-archweave`) workspace package
// into dist/ — so the packed tarball never NEEDS those packages installed.
// They still have to stay declared as devDependencies on disk, though,
// because pnpm's workspace linker uses each package's own manifest to
// symlink the sibling packages this project imports from source during
// local build/test/typecheck.
//
// `npm pack` (and `npm publish`) don't understand pnpm's `workspace:`
// protocol and would embed the literal `workspace:*` string verbatim in the
// tarball's package.json. This hook strips those entries out of
// devDependencies right before packing (prepack) and restores the original
// file right after (postpack), so the on-disk manifest committed to git is
// untouched but the packed manifest never carries a `workspace:` range.
//
// Wired via each package's own `"scripts": { "prepack": ..., "postpack": ... }`.
//
// Usage (run with cwd = the package directory, which npm guarantees for
// lifecycle scripts): node ../../tools/pack-sanitize.mjs <prepack|postpack>

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const pkgJsonPath = path.resolve(process.cwd(), 'package.json');
const backupPath = `${pkgJsonPath}.workspace-backup`;

function stripWorkspaceRanges(pkg) {
  if (!pkg.devDependencies) return pkg;
  let changed = false;
  for (const [name, range] of Object.entries(pkg.devDependencies)) {
    if (typeof range === 'string' && range.startsWith('workspace:')) {
      delete pkg.devDependencies[name];
      changed = true;
    }
  }
  if (changed && Object.keys(pkg.devDependencies).length === 0) {
    delete pkg.devDependencies;
  }
  return pkg;
}

if (mode === 'prepack') {
  // Self-healing: if a previous pack was interrupted (postpack never ran),
  // a backup is still on disk and package.json is the stripped version.
  // Restore the original FIRST so we never back up an already-stripped file
  // (which would make the true manifest unrecoverable).
  if (existsSync(backupPath)) {
    console.warn('pack-sanitize: found a leftover workspace-backup (previous pack was interrupted); restoring it first.');
    writeFileSync(pkgJsonPath, readFileSync(backupPath));
    unlinkSync(backupPath);
  }
  const raw = readFileSync(pkgJsonPath, 'utf8');
  writeFileSync(backupPath, raw);
  const pkg = stripWorkspaceRanges(JSON.parse(raw));
  writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
} else if (mode === 'postpack') {
  if (existsSync(backupPath)) {
    writeFileSync(pkgJsonPath, readFileSync(backupPath));
    unlinkSync(backupPath);
  }
} else {
  console.error('Usage: node tools/pack-sanitize.mjs <prepack|postpack>');
  process.exit(1);
}
