// Node module hooks for tools/qa: load the app's TypeScript directly, resolve the "@/..." alias,
// and (parity mode only) swap the modules a route needs at runtime for in-memory fakes so the real
// handler can run offline: Next.js, Supabase, the rate limiter, email, notifications, the clock.
//
// TypeScript is compiled with the project's own `typescript` (ts.transpileModule, isolatedModules),
// which drops type-only imports the same way the Next.js build does.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC = path.join(ROOT, 'src');
let FAKES = {};

export async function initialize(data) {
  FAKES = (data && data.fakes) || {};
}

function tryFile(base) {
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const f = base + ext;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (Object.prototype.hasOwnProperty.call(FAKES, specifier)) {
    return { url: pathToFileURL(FAKES[specifier]).href, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const f = tryFile(path.join(SRC, specifier.slice(2)));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && context.parentURL.startsWith('file:')) {
    const parent = fileURLToPath(context.parentURL.split('?')[0]);
    if (/\.(ts|tsx)$/.test(parent)) {
      const f = tryFile(path.resolve(path.dirname(parent), specifier));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const clean = url.split('?')[0];
  if (clean.startsWith('file:') && /\.(ts|tsx)$/.test(clean)) {
    const file = fileURLToPath(clean);
    const source = fs.readFileSync(file, 'utf8');
    const out = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
        esModuleInterop: true,
      },
    });
    return { format: 'module', source: out.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
