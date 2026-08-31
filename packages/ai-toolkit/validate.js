#!/usr/bin/env node
/**
 * Pre-publish validation for the AI toolkit package.
 *
 * Runs in CI before `npm publish`, and locally via `npm run validate`. Catches the
 * failures that would otherwise ship a package whose skills silently do not load:
 * a missing SKILL.md, absent frontmatter, or a frontmatter `name` that disagrees
 * with its directory (the agent resolves skills by directory, so a mismatch
 * publishes a skill nobody can invoke).
 *
 * Not shipped — excluded by the `files` allowlist in package.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REQUIRED_SKILL = path.join("skills", "code-review", "SKILL.md");

const failures = [];
const checks = [];

function check(label, run) {
  try {
    run();
    checks.push(`  ok    ${label}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push(`  FAIL  ${label} — ${message}`);
    failures.push(`${label}: ${message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Parse a leading `---` YAML frontmatter block into a flat key/value map. */
function parseFrontmatter(contents) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents);
  if (!match) return null;

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    // Only top-level scalars matter here; nested list items are skipped.
    if (field && !line.startsWith(" ")) {
      fields[field[1]] = field[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return fields;
}

// 1. package.json carries the fields that make it publishable.
const manifestPath = path.join(PACKAGE_ROOT, "package.json");
let pkg = {};
check("package.json has name, version and publishConfig.registry", () => {
  assert(fs.existsSync(manifestPath), "package.json not found");
  pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(typeof pkg.name === "string" && pkg.name.length > 0, "missing name");
  assert(typeof pkg.version === "string" && pkg.version.length > 0, "missing version");
  assert(
    pkg.publishConfig?.registry === "https://npm.pkg.github.com",
    `publishConfig.registry must be https://npm.pkg.github.com (got ${String(pkg.publishConfig?.registry)})`,
  );
});

// 2. The skill this package exists to ship is present.
check(`${REQUIRED_SKILL} exists`, () => {
  assert(fs.existsSync(path.join(PACKAGE_ROOT, REQUIRED_SKILL)), "file not found");
});

// 3 & 4. Every skill has frontmatter, and its name matches its directory.
const skillsRoot = path.join(PACKAGE_ROOT, "skills");
const skillDirs = fs.existsSync(skillsRoot)
  ? fs.readdirSync(skillsRoot).filter((entry) => fs.statSync(path.join(skillsRoot, entry)).isDirectory())
  : [];

check("skills/ contains at least one skill", () => {
  assert(skillDirs.length > 0, "no skill directories found");
});

for (const skillName of skillDirs) {
  check(`skills/${skillName}/SKILL.md frontmatter`, () => {
    const skillPath = path.join(skillsRoot, skillName, "SKILL.md");
    assert(fs.existsSync(skillPath), "SKILL.md not found");

    const frontmatter = parseFrontmatter(fs.readFileSync(skillPath, "utf8"));
    assert(frontmatter !== null, "no YAML frontmatter block");
    assert(typeof frontmatter.name === "string" && frontmatter.name.length > 0, "frontmatter missing name");
    assert(
      typeof frontmatter.description === "string" && frontmatter.description.length > 0,
      "frontmatter missing description",
    );
    assert(
      frontmatter.name === skillName,
      `frontmatter name "${frontmatter.name}" does not match directory "${skillName}"`,
    );
  });
}

// 5. Everything the package promises to ship is actually present.
check("files allowlist resolves", () => {
  for (const entry of pkg.files ?? []) {
    const target = path.join(PACKAGE_ROOT, entry);
    assert(fs.existsSync(target), `${entry} listed in files but missing`);
  }
});

console.log(`Validating ${String(pkg.name ?? "package")}@${String(pkg.version ?? "?")}`);
console.log(checks.join("\n"));

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${String(checks.length)} checks passed.`);
}
