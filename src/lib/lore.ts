/**
 * The written story — `lore/issues/*.md` — read at request time on the server.
 *
 * Until 2026-09-30 these files were read by NOTHING. The Story Engine was
 * computing the war every week and writing it to the database, `/war` was
 * rendering it, and the actual comic issues sat as markdown in a public GitHub
 * repo where no manager could ever see them. This module is the missing half.
 *
 * The .md files stay the source of truth (they are written by hand, and they are
 * the thing Nate edits). They live outside src/, so `next.config.ts` force-
 * includes them via outputFileTracingIncludes — without that the files are not
 * traced into the serverless bundle and every issue 404s in production while
 * working perfectly on localhost.
 */
import fs from "node:fs/promises";
import path from "node:path";

const ISSUES_DIR = path.join(process.cwd(), "lore", "issues");

export interface IssueMeta {
  /** URL slug, e.g. "002-first-blood" — the filename without .md */
  slug: string;
  /** Issue number parsed from the filename, for ordering. */
  number: number;
  /** The "ISSUE #002 — FIRST BLOOD" line, cleaned up for display. */
  title: string;
  /** The ### line under the title, when the issue has one. */
  subtitle: string | null;
}

export interface Issue extends IssueMeta {
  body: string;
}

/** Strip markdown emphasis/quotes from a heading so it can sit in a page title. */
function cleanHeading(raw: string): string {
  return raw
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/[“”"]/g, "")
    .trim();
}

function parseMeta(slug: string, text: string): IssueMeta {
  const lines = text.split("\n");
  // The title is the first ## line if there is one (issue 002's shape), else the
  // first # line (issue 003 puts the issue number on the H1 instead). Falling
  // back to the slug means a new issue with an unexpected shape still lists.
  const h2 = lines.find((l) => /^##\s+/.test(l) && !/^###/.test(l));
  const h1 = lines.find((l) => /^#\s+/.test(l));
  const h3 = lines.find((l) => /^###\s+/.test(l));
  const numMatch = slug.match(/^(\d+)/);
  return {
    slug,
    number: numMatch ? parseInt(numMatch[1], 10) : 0,
    title: cleanHeading(h2 ?? h1 ?? slug),
    subtitle: h3 ? cleanHeading(h3) : null,
  };
}

/** Every issue, newest first. Returns [] rather than throwing if the dir is missing. */
export async function listIssues(): Promise<IssueMeta[]> {
  let files: string[];
  try {
    files = await fs.readdir(ISSUES_DIR);
  } catch {
    return [];
  }
  const metas = await Promise.all(
    files
      .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
      .map(async (f) => {
        const slug = f.replace(/\.md$/, "");
        const text = await fs.readFile(path.join(ISSUES_DIR, f), "utf8");
        return parseMeta(slug, text);
      }),
  );
  return metas.sort((a, b) => b.number - a.number);
}

/** One issue by slug, or null. The slug is sanitised — it reaches the filesystem. */
export async function getIssue(slug: string): Promise<Issue | null> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null; // no traversal, no dotfiles
  try {
    const text = await fs.readFile(path.join(ISSUES_DIR, `${slug}.md`), "utf8");
    return { ...parseMeta(slug, text), body: text };
  } catch {
    return null;
  }
}
