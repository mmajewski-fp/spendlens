#!/usr/bin/env node
/**
 * Installs this package's AI artifacts into the consumer project:
 *   skills/<name>/**  ->  <consumer>/.claude/skills/<name>/**
 *   rules/CLAUDE.md   ->  merged into <consumer>/CLAUDE.md between sentinels
 *
 * Runs as `postinstall`, and manually as `npx ai-toolkit install|uninstall`.
 *
 * Two contracts this file must honour:
 *   1. Idempotent — re-running updates managed content instead of duplicating it.
 *   2. Never breaks `npm install` — every failure is reported and swallowed, so a
 *      broken toolkit install can't block a consumer's dependency install.
 *
 * Files the user has edited since install are left alone. The manifest records a
 * SHA-256 per installed file; when the on-disk hash no longer matches, the file
 * is treated as user-owned and skipped rather than clobbered.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));

export const PACKAGE_NAME = PKG.name;
export const MANIFEST_RELATIVE_PATH = path.join(".claude", ".ai-toolkit-manifest.json");
export const BEGIN_MARKER = `<!-- BEGIN ${PKG.name} -->`;
export const END_MARKER = `<!-- END ${PKG.name} -->`;

/**
 * True when this module is the process entry point.
 *
 * Compares real paths deliberately: npm symlinks `file:` deps, workspaces and
 * `npm link`, which leaves `process.argv[1]` on the symlinked path while
 * `import.meta.url` reports the target. A plain string compare silently reports
 * false in all of those cases, and the CLI does nothing at all.
 */
export function isEntryPoint(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

/** Resolve the consumer project root, or null when we can't identify one. */
export function findConsumerRoot() {
  // npm sets INIT_CWD to the directory `npm install` was invoked from. Treat an
  // empty value as unset, which `??` alone would not.
  const initCwd = process.env.INIT_CWD;
  const start = initCwd && initCwd.length > 0 ? initCwd : process.cwd();

  let dir = path.resolve(start);
  let previous = "";

  // path.dirname() is a fixed point at the filesystem root, which ends the walk.
  while (dir !== previous) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      // Installing into ourselves (local development) is a no-op, not an error.
      if (dir === path.resolve(PACKAGE_ROOT)) return null;
      return dir;
    }
    previous = dir;
    dir = path.dirname(dir);
  }

  return null;
}

export function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

/** List every file under `dir`, as paths relative to `dir`. */
function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(path.join(dir, entry.name), relative));
    } else if (entry.isFile()) {
      out.push(relative);
    }
  }
  return out;
}

export function readManifest(consumerRoot) {
  const manifestPath = path.join(consumerRoot, MANIFEST_RELATIVE_PATH);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    // A corrupt manifest must not wedge the install; treat it as a fresh one.
    return null;
  }
}

/**
 * Copy skills into `.claude/skills/`, skipping files the user has since edited.
 * Returns the manifest's `skills` section.
 */
function installSkills(consumerRoot, previousManifest) {
  const sourceRoot = path.join(PACKAGE_ROOT, "skills");
  if (!fs.existsSync(sourceRoot)) return {};

  const previousSkills = previousManifest?.files?.skills ?? {};
  const installed = {};

  for (const skillName of fs.readdirSync(sourceRoot)) {
    const skillSource = path.join(sourceRoot, skillName);
    if (!fs.statSync(skillSource).isDirectory()) continue;

    const skillTarget = path.join(consumerRoot, ".claude", "skills", skillName);
    const contentHashes = {};
    const files = [];

    for (const relative of listFiles(skillSource)) {
      const from = path.join(skillSource, relative);
      const to = path.join(skillTarget, relative);
      const contents = fs.readFileSync(from);
      const hash = sha256(contents);

      const recordedHash = previousSkills[skillName]?.contentHashes?.[relative];
      if (fs.existsSync(to) && recordedHash && sha256(fs.readFileSync(to)) !== recordedHash) {
        console.warn(`[${PKG.name}] kept your edited ${path.join(".claude", "skills", skillName, relative)}`);
        // Keep the hash of what *we* installed, not what is on disk. Recording the
        // edited content would make the file look managed again, and uninstall
        // would then delete work the user owns.
        contentHashes[relative] = recordedHash;
        files.push(relative);
        continue;
      }

      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, contents);
      contentHashes[relative] = hash;
      files.push(relative);
    }

    installed[skillName] = { files: files.sort(), contentHashes };
  }

  return installed;
}

/** Replace the managed block in CLAUDE.md, or append one when absent. */
function installRules(consumerRoot) {
  const source = path.join(PACKAGE_ROOT, "rules", "CLAUDE.md");
  if (!fs.existsSync(source)) return null;

  const rules = fs.readFileSync(source, "utf8").trim();
  const block = `${BEGIN_MARKER}\n${rules}\n${END_MARKER}`;
  const target = path.join(consumerRoot, "CLAUDE.md");
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";

  let next;
  const begin = existing.indexOf(BEGIN_MARKER);
  const end = existing.indexOf(END_MARKER);

  if (begin !== -1 && end !== -1 && end > begin) {
    // Managed block present: replace it in place, leaving the user's prose alone.
    next = existing.slice(0, begin) + block + existing.slice(end + END_MARKER.length);
  } else if (existing.trim()) {
    next = `${existing.trimEnd()}\n\n${block}\n`;
  } else {
    next = `${block}\n`;
  }

  if (next !== existing) fs.writeFileSync(target, next);
  return { path: "CLAUDE.md", contentHash: sha256(rules) };
}

function writeManifest(consumerRoot, skills, rules) {
  const manifestPath = path.join(consumerRoot, MANIFEST_RELATIVE_PATH);
  const manifest = {
    package: PKG.name,
    version: PKG.version,
    manifestVersion: 1,
    lastApplied: new Date().toISOString(),
    files: { skills, ...(rules ? { rules } : {}) },
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function install() {
  const consumerRoot = findConsumerRoot();
  if (!consumerRoot) return;

  const previousManifest = readManifest(consumerRoot);
  const skills = installSkills(consumerRoot, previousManifest);
  const rules = installRules(consumerRoot);
  writeManifest(consumerRoot, skills, rules);

  const count = Object.keys(skills).length;
  console.log(`[${PKG.name}] installed ${String(count)} skill${count === 1 ? "" : "s"} into .claude/skills/`);
}

async function main() {
  const command = process.argv[2] ?? "install";
  if (command === "uninstall") {
    const { uninstall } = await import("./uninstall.js");
    uninstall();
    return;
  }
  install();
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    // Never fail the consumer's `npm install` because of a toolkit problem.
    console.warn(`[${PKG.name}] install skipped: ${error instanceof Error ? error.message : String(error)}`);
  });
}
