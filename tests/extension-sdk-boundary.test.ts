import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { describe, expect, it } from 'vitest';

const extensionsRoot = path.resolve(process.cwd(), 'extensions');
const builtinModuleSet = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => name.replace(/^node:/, '')),
]);

function listExtensionDirs(): string[] {
  return fs.readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(extensionsRoot, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')));
}

function listTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractBareSpecifiers(content: string): string[] {
  const matches = new Set<string>();
  const staticImportRe = /(?:import|export)\s+(?:[^'"`]+?\s+from\s+)?['"]([^'"`]+)['"]/g;
  const dynamicImportRe = /import\(\s*['"]([^'"`]+)['"]\s*\)/g;

  for (const regex of [staticImportRe, dynamicImportRe]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const specifier = match[1];
      if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) continue;
      if (specifier.startsWith('node:')) continue;
      const packageName = normalizePackageName(specifier);
      if (builtinModuleSet.has(packageName)) continue;
      matches.add(packageName);
    }
  }

  return Array.from(matches.values()).sort();
}

function normalizePackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return `${scope}/${name}`;
  }
  return specifier.split('/')[0];
}

describe('extension sdk boundary', () => {
  it('宿主根 package.json 不应声明仅供 extension 使用的第三方依赖', () => {
    const rootPackageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };

    const declared = new Set<string>([
      ...Object.keys(rootPackageJson.dependencies ?? {}),
      ...Object.keys(rootPackageJson.optionalDependencies ?? {}),
    ]);

    const extensionOnlyPackages = [
      '@larksuiteoapi/node-sdk',
      '@wecom/aibot-node-sdk',
      'discord.js',
      'grammy',
      'silk-wasm',
    ];

    expect(extensionOnlyPackages.filter((pkgName) => declared.has(pkgName))).toEqual([]);
  });

  it('extension 源码不应直接 import 宿主内部 src 路径', () => {
    const offenders: string[] = [];

    for (const extensionDir of listExtensionDirs()) {
      const srcDir = path.join(extensionDir, 'src');
      if (!fs.existsSync(srcDir)) continue;

      for (const filePath of listTypeScriptFiles(srcDir)) {
        const content = fs.readFileSync(filePath, 'utf8');
        if (/(?:from|import\()\s*['"](?:\.\.\/)+src\//.test(content)) {
          offenders.push(path.relative(process.cwd(), filePath));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('每个 extension 都应在自己的 package.json 中声明所使用的第三方依赖', () => {
    const missingByExtension: Record<string, string[]> = {};

    for (const extensionDir of listExtensionDirs()) {
      const srcDir = path.join(extensionDir, 'src');
      if (!fs.existsSync(srcDir)) continue;

      const packageJsonPath = path.join(extensionDir, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };

      const declared = new Set<string>([
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.optionalDependencies ?? {}),
        ...Object.keys(packageJson.peerDependencies ?? {}),
      ]);

      const used = new Set<string>();
      for (const filePath of listTypeScriptFiles(srcDir)) {
        const content = fs.readFileSync(filePath, 'utf8');
        for (const specifier of extractBareSpecifiers(content)) {
          used.add(specifier);
        }
      }

      const missing = Array.from(used.values())
        .filter((pkgName) => !declared.has(pkgName))
        .sort();

      if (missing.length > 0) {
        missingByExtension[path.basename(extensionDir)] = missing;
      }
    }

    expect(missingByExtension).toEqual({});
  });
});
