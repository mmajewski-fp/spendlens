/**
 * Code review agent built on the Claude Agent SDK.
 *
 * Scores a diff against the team's five criteria (see src/criteria.js) and
 * returns a structured verdict the pipeline can gate on. Read-only by design:
 * the agent may Read/Grep/Glob for surrounding context but cannot write, edit,
 * or run shell commands.
 *
 * Local usage (from this directory):
 *   npm run review                     # review uncommitted changes (git diff HEAD)
 *   npm run review -- --staged         # review staged changes only
 *   npm run review -- main..HEAD       # review an arbitrary git diff range
 *
 * CI usage (see .github/actions/ai-reviewer):
 *   node --import tsx src/index.ts --diff-file diff.patch --markdown-out comment.md
 *
 * Exit codes: 0 the gate passed, 2 the gate failed, 1 the review could not run.
 * The distinction matters — a failed review and a failing review are different
 * events, and only one of them means the pipeline is broken.
 *
 * Env:
 *   CODE_REVIEW_MODEL   Override the model (defaults to the SDK's default)
 *   PR_TITLE, PR_BODY   Pull request context, passed through env rather than argv
 *                       so titles containing quotes or newlines cannot break the shell
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { CRITERIA, evaluateGate, GATE } from "./criteria.js";
import { REVIEW_SCHEMA } from "./schema.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_GATE_FAILED = 2;

type Severity = "critical" | "high" | "medium" | "low";

interface Score {
  criterion: string;
  score: number;
  rationale: string;
}

interface Finding {
  file: string;
  line: number | null;
  severity: Severity;
  criterion: string;
  description: string;
}

interface ReviewOutput {
  summary: string;
  scores: Score[];
  findings: Finding[];
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const TITLE_BY_ID = new Map(CRITERIA.map((c) => [c.id, c.title]));

interface Options {
  diffFile?: string;
  markdownOut?: string;
  githubOutput: boolean;
  target: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { githubOutput: false, target: "HEAD" };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--diff-file":
        i += 1;
        options.diffFile = argv[i];
        break;
      case "--markdown-out":
        i += 1;
        options.markdownOut = argv[i];
        break;
      case "--github-output":
        options.githubOutput = true;
        break;
      default:
        positional.push(arg);
    }
  }

  if (positional.length > 0) options.target = positional[0];
  return options;
}

function resolveRepoRoot(): string {
  return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
}

function getDiff(target: string, repoRoot: string): string {
  const cmd = target === "--staged" ? "git diff --cached" : `git diff ${target}`;
  return execSync(cmd, { cwd: repoRoot, encoding: "utf-8", maxBuffer: 1024 * 1024 * 50 });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function describeToolUse(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "Read":
      return `Read ${asString(i.file_path)}`;
    case "Grep": {
      const path = asString(i.path);
      return `Grep "${asString(i.pattern)}"${path ? ` in ${path}` : ""}`;
    }
    case "Glob":
      return `Glob ${asString(i.pattern)}`;
    default:
      return name;
  }
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function locationOf(finding: Finding): string {
  return finding.line !== null ? `${finding.file}:${String(finding.line)}` : finding.file;
}

function printReport(output: ReviewOutput, gate: ReturnType<typeof evaluateGate>): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`CODE REVIEW — ${gate.verdict.toUpperCase()}`);
  console.log("=".repeat(60));
  console.log(`\n${output.summary}\n`);

  for (const { criterion, score, rationale } of output.scores) {
    console.log(`  ${String(score).padStart(2)}/10  ${TITLE_BY_ID.get(criterion) ?? criterion}`);
    console.log(`         ${rationale}`);
  }

  if (output.findings.length > 0) {
    console.log(`\n${String(output.findings.length)} finding(s):\n`);
    for (const finding of sortFindings(output.findings)) {
      console.log(`[${finding.severity.toUpperCase()}] ${locationOf(finding)} — ${finding.criterion}`);
      console.log(`  ${finding.description}\n`);
    }
  } else {
    console.log("\nNo findings.\n");
  }

  if (gate.verdict === "fail") {
    console.log("Gate failed:");
    for (const reason of gate.reasons) console.log(`  - ${reason}`);
  }
}

/** Render the PR comment. Kept close to the terminal report so the two never disagree. */
function renderMarkdown(output: ReviewOutput, gate: ReturnType<typeof evaluateGate>): string {
  const badge = gate.verdict === "pass" ? "✅ **Passed**" : "❌ **Failed**";
  const lines = [
    "## AI code review",
    "",
    `${badge} — lowest score ${String(gate.lowest)}/10 (gate blocks at ${String(GATE.failAtOrBelow)} or below).`,
    "",
    output.summary,
    "",
    "| Criterion | Score | Rationale |",
    "| --- | ---: | --- |",
  ];

  for (const { criterion, score, rationale } of output.scores) {
    const title = TITLE_BY_ID.get(criterion) ?? criterion;
    // Escape pipes so a rationale mentioning `a || b` cannot break the table.
    lines.push(`| ${title} | ${String(score)}/10 | ${rationale.replaceAll("|", "\\|")} |`);
  }

  if (output.findings.length > 0) {
    lines.push("", `### Findings (${String(output.findings.length)})`, "");
    for (const finding of sortFindings(output.findings)) {
      lines.push(
        `- **${finding.severity.toUpperCase()}** \`${locationOf(finding)}\` — ${finding.description} ` +
          `_(${finding.criterion})_`,
      );
    }
  }

  if (gate.verdict === "fail") {
    lines.push("", "### Why the gate failed", "");
    for (const reason of gate.reasons) lines.push(`- ${reason}`);
  }

  lines.push(
    "",
    "<sub>Scored by the team review agent. The scores are the model's; the verdict is computed in code.</sub>",
  );
  return lines.join("\n");
}

function writeGithubOutput(gate: ReturnType<typeof evaluateGate>): void {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) {
    console.error("--github-output was passed but GITHUB_OUTPUT is not set; skipping.");
    return;
  }
  appendFileSync(target, `verdict=${gate.verdict}\nlowest-score=${String(gate.lowest)}\n`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  let repoRoot: string;
  try {
    repoRoot = resolveRepoRoot();
  } catch {
    console.error("Not inside a git repository.");
    process.exitCode = EXIT_ERROR;
    return;
  }

  let diff: string;
  try {
    diff = options.diffFile ? readFileSync(options.diffFile, "utf-8") : getDiff(options.target, repoRoot);
  } catch (err) {
    console.error(`Failed to read diff: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = EXIT_ERROR;
    return;
  }

  if (!diff.trim()) {
    // An empty diff is not a passing review, it is nothing to review. Say so and
    // exit clean so a docs-only PR does not look like it earned a green check.
    console.log("No changes to review.");
    if (options.markdownOut) {
      writeFileSync(options.markdownOut, "## AI code review\n\nNothing to review — the diff is empty.\n");
    }
    return;
  }

  console.log(`Reviewing diff (${String(diff.split("\n").length)} lines) in ${repoRoot}...\n`);

  let structuredOutput: ReviewOutput | undefined;
  let sawError = false;

  for await (const message of query({
    prompt: buildUserPrompt({ prTitle: process.env.PR_TITLE, prBody: process.env.PR_BODY, diff }),
    options: {
      cwd: repoRoot,
      tools: ["Read", "Grep", "Glob"],
      allowedTools: ["Read", "Grep", "Glob"],
      permissionMode: "dontAsk",
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: 15,
      model: process.env.CODE_REVIEW_MODEL,
      outputFormat: { type: "json_schema", schema: REVIEW_SCHEMA },
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          console.log(`  → ${describeToolUse(block.name, block.input)}`);
        }
      }
    }

    if (message.type === "result") {
      if (message.subtype === "success") {
        structuredOutput = message.structured_output as ReviewOutput;
        console.log(`\nDone in ${String(message.num_turns)} turn(s), $${message.total_cost_usd.toFixed(4)}.`);
      } else {
        sawError = true;
        console.error(`\nReview failed: ${message.subtype}`);
        for (const e of message.errors) console.error(`  ${e}`);
      }
    }
  }

  if (sawError) {
    process.exitCode = EXIT_ERROR;
    return;
  }

  if (!structuredOutput) {
    console.error("No structured output returned.");
    process.exitCode = EXIT_ERROR;
    return;
  }

  const gate = evaluateGate(structuredOutput);
  printReport(structuredOutput, gate);

  if (options.markdownOut) writeFileSync(options.markdownOut, renderMarkdown(structuredOutput, gate));
  if (options.githubOutput) writeGithubOutput(gate);

  process.exitCode = gate.verdict === "pass" ? EXIT_OK : EXIT_GATE_FAILED;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = EXIT_ERROR;
});
