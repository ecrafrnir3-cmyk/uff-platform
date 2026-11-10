// Reads ONE named variable from a .env.local without printing anything. The files are never
// echoed, logged, copied or written; only the asked-for value is returned to the caller.
//
// Candidates, nearest first: the worktree's own .env.local (gitignored; the uff-qa key lives
// there), then each parent folder's (the main checkout's .env.local holds the app's keys; this
// worktree sits inside it at <UFF>/.claude/worktrees/<name>). The first file that defines the
// variable wins. QA_ENV_FILE names one file explicitly instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function envFiles() {
  if (process.env.QA_ENV_FILE) return [process.env.QA_ENV_FILE];
  const out = [];
  let dir = path.resolve(here, '..', '..');
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, '.env.local');
    if (fs.existsSync(f)) out.push(f);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}

function valueIn(file, name) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] !== name) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v || null;
  }
  return null;
}

export function readEnvVar(name) {
  for (const f of envFiles()) {
    const v = valueIn(f, name);
    if (v) return v;
  }
  return null;
}

// True/false only: whether the variable is present, never its value.
export function hasEnvVar(name) {
  return !!readEnvVar(name);
}
