// AI check of one guideline article, run in the background by GitHub Actions (no pull request needed).
// It uses GitHub Models with the repository token. The rules are the same file Copilot reads: .github/copilot-instructions.md.
// Usage: node scripts/ai-check.mjs <slug> [--commit]   (--commit saves the report in content/<slug>/review/ai-report.json)
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";

const slug = process.argv[2]; const commit = process.argv.includes("--commit");
if (!slug) { console.error("Usage: node scripts/ai-check.mjs <slug> [--commit]"); process.exit(2); }
const MODEL = process.env.AI_MODEL || "openai/gpt-4.1";
const dir0 = process.env.ARTICLE_DIR || "."; // the checked-out branch with the article. The script and the rules come from main.
const rules = readFileSync(".github/copilot-instructions.md", "utf8");
const article = readFileSync(`${dir0}/content/${slug}/guideline.md`, "utf8");
const system = `${rules}\n\nAnswer ONLY with JSON: {"findings":[{"where":"section > heading or first words","severity":"error|hint","problem":"what is wrong","original":"the exact wrong text","fix":"the corrected text"}]}. Return {"findings":[]} when nothing is wrong. Do not invent problems. Do not repeat what a correct sentence already does.`;
const res = await fetch("https://models.github.ai/inference/chat/completions", {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "content-type": "application/json", accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  body: JSON.stringify({ model: MODEL, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: article }] }),
});
const text = await res.text();
if (!res.ok) { console.error(`GitHub Models answered ${res.status}: ${text.slice(0, 500)}`); process.exit(1); }
let findings = [];
try { findings = JSON.parse(JSON.parse(text).choices[0].message.content).findings ?? []; }
catch (e) { console.error("The answer was not the expected JSON:", text.slice(0, 500)); process.exit(1); }
const report = { time: new Date().toISOString(), model: MODEL, ref: process.env.GITHUB_REF_NAME ?? "", slug, errors: findings.filter((f) => f.severity === "error").length, hints: findings.filter((f) => f.severity !== "error").length, findings };
const lines = [`## AI check: ${slug}`, `${report.errors} errors, ${report.hints} hints (model ${MODEL})`, "", ...findings.map((f) => `- **${f.severity}** · ${f.where}: ${f.problem}\n  - now: ${f.original}\n  - fix: ${f.fix}`)];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
if (commit) { const dir = `${dir0}/content/${slug}/review`; mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/ai-report.json`, JSON.stringify(report, null, 2) + "\n"); }
