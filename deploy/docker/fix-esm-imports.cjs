// fix-esm-imports.cjs
//
// Post-tsc fixup for Node.js ESM compatibility.
//
// Problem: tsconfig uses moduleResolution "bundler", so tsc emits bare
// specifiers (e.g. `from './bootstrap'`, `from '@iris/extension-utils'`)
// that only resolve under a bundler runtime (tsx / bun). Plain `node`
// with "type": "module" requires:
//   1. Explicit `.js` extensions on relative imports
//   2. Directory imports to include `/index.js`
//
// This script walks the compiled `dist/` tree and rewrites imports to
// satisfy Node.js ESM resolution rules.

'use strict';

const fs = require('fs');
const path = require('path');

const baseDir = process.argv[2] || 'dist';
let fixCount = 0;

function walkDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full);
    else if (entry.name.endsWith('.js')) fixFile(full);
  }
}

function fixFile(filePath) {
  let code = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  code = code.replace(
    /((?:from|import)\s*\(?['"])(\.[^'"]+)(['"])/g,
    (match, pre, importPath, post) => {
      if (/\.(js|json|mjs|cjs)$/.test(importPath)) return match;

      const resolved = path.resolve(path.dirname(filePath), importPath);

      // Directory import → append /index.js
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        if (fs.existsSync(path.join(resolved, 'index.js'))) {
          changed = true;
          return pre + importPath + '/index.js' + post;
        }
      }

      // Extensionless import → append .js
      if (fs.existsSync(resolved + '.js')) {
        changed = true;
        return pre + importPath + '.js' + post;
      }

      return match;
    }
  );

  if (changed) {
    fs.writeFileSync(filePath, code);
    fixCount++;
  }
}

console.log('[fix-esm-imports] Rewriting imports in', baseDir);
walkDir(baseDir);
console.log('[fix-esm-imports] Done.', fixCount, 'files rewritten.');
