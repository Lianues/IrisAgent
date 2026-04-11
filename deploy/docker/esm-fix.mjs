// Bridges tsc (moduleResolution: "bundler") output with Node.js ESM resolution.
// 1. tsc emits extensionless relative specifiers; Node.js ESM requires explicit .js.
// 2. tsc preserves @/* path aliases; remap them to /app/dist/src/*.
import { register } from 'node:module';

register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  // Remap @/* alias to /app/dist/src/*
  if (specifier.startsWith('@/')) {
    const mapped = 'file:///app/dist/src/' + specifier.slice(2);
    return resolve(mapped, context, nextResolve);
  }
  // Handle file:// URLs and relative specifiers without extensions
  const needsSuffix = specifier.startsWith('file://')
    ? !/\\.\\w+$/.test(specifier)
    : specifier.startsWith('.') && !/\\.\\w+$/.test(specifier);
  if (!needsSuffix) return nextResolve(specifier, context);
  for (const suffix of ['.js', '/index.js']) {
    try { return await nextResolve(specifier + suffix, context); }
    catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  }
  return nextResolve(specifier, context);
}
`)}`);