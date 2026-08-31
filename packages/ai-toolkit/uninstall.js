#!/usr/bin/env node
/**
 * Removes what install.js added, using the manifest as the record of what is ours:
 *   - skill files whose on-disk hash still matches the manifest
 *   - the managed CLAUDE.md block between the sentinel markers
 *   - the manifest itself
 *
 * Anything the user edited after install is left in place — a hash mismatch means
 * the file is no longer ours to delete. Without a manifest we remove nothing,
 * because we cannot tell our files from the user's.
 */
import fs from "node:fs";
import path from "node:path";

import {
  BEGIN_MARKER,
  END_MARKER,
  MANIFEST_RELATIVE_PATH,
  PACKAGE_NAME,
  findConsumerRoot,
  isEntryPoint,
  readManifest,
  sha256,
} from "./install.js";

/** Delete `dir` and any parents left empty by the deletion, stopping at `stopAt`. */
function pruneEmptyDirs(dir, stopAt) {
  let current = dir;
  while (current.startsWith(stopAt) && current !== stopAt) {
    if (!fs.existsSync(current) || fs.readdirSync(current).length > 0) return;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function removeSkills(consumerRoot, manifest) {
  const skillsRoot = path.join(consumerRoot, ".claude", "skills");
  let removed = 0;
  let kept = 0;

  for (const [skillName, record] of Object.entries(manifest.files?.skills ?? {})) {
    const skillDir = path.join(skillsRoot, skillName);

    for (const relative of record.files ?? []) {
      const target = path.join(skillDir, relative);
      if (!fs.existsSync(target)) continue;

      const recordedHash = record.contentHashes?.[relative];
      if (recordedHash && sha256(fs.readFileSync(target)) !== recordedHash) {
        console.warn(`[${PACKAGE_NAME}] kept your edited ${path.join(".claude", "skills", skillName, relative)}`);
        kept += 1;
        continue;
      }

      fs.unlinkSync(target);
      pruneEmptyDirs(path.dirname(target), skillsRoot);
      removed += 1;
    }

    pruneEmptyDirs(skillDir, skillsRoot);
  }

  return { removed, kept };
}

function removeRules(consumerRoot) {
  const target = path.join(consumerRoot, "CLAUDE.md");
  if (!fs.existsSync(target)) return;

  const existing = fs.readFileSync(target, "utf8");
  const begin = existing.indexOf(BEGIN_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) return;

  const next = existing.slice(0, begin).trimEnd() + existing.slice(end + END_MARKER.length);
  fs.writeFileSync(target, next.trim() ? `${next.trim()}\n` : "");
}

export function uninstall() {
  const consumerRoot = findConsumerRoot();
  if (!consumerRoot) return;

  const manifest = readManifest(consumerRoot);
  if (!manifest) {
    console.warn(`[${PACKAGE_NAME}] no manifest found; nothing removed`);
    return;
  }

  const { removed, kept } = removeSkills(consumerRoot, manifest);
  removeRules(consumerRoot);

  const manifestPath = path.join(consumerRoot, MANIFEST_RELATIVE_PATH);
  if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);

  const keptNote = kept > 0 ? `, kept ${String(kept)} edited` : "";
  console.log(`[${PACKAGE_NAME}] removed ${String(removed)} file${removed === 1 ? "" : "s"}${keptNote}`);
}

if (isEntryPoint(import.meta.url)) {
  try {
    uninstall();
  } catch (error) {
    console.warn(`[${PACKAGE_NAME}] uninstall skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}
