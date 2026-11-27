// AI check of one guideline article, run in the background by GitHub Actions. No pull request needed.
// Sends the article text and the writing rules (.github/copilot-instructions.md) to Claude and saves the report
// in content/<slug>/review/ai-report.json on the version branch. The key is the repository secret ANTHROPIC_API_KEY.
// Usage: node scripts/ai-check.mjs <slug>      (ARTICLE_DIR = folder of the checked-out version branch, default ".")
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";

const slug = process.argv[2];
if (!slug) { console.error("Usage: node scripts/ai-check.mjs <slug>"); process.exit(2); }
const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error("The repository secret ANTHROPIC_API_KEY is not set. Add it in Settings > Secrets and variables > Actions > New repository secret."); process.exit(1); }
const MODEL = process.env.AI_MODEL || "claude-sonnet-5-5";
const base = process.env.ARTICLE_DIR || ".";

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const plain = (h) => h.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]).replace(/\s+/g, " ").trim();
function htmlLines(html) {
  const out = []; const re = /<(li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi; let m, any = false;
  while ((m = re.exec(html))) { any = true; const t = plain(m[2]); if (t) out.push(m[1].toLowerCase() === "li" ? `- ${t}` : t); }
  if (!any) { const t = plain(html); if (t) out.push(t); }
  return out;
}
function blockLines(b) {
  switch (b.type) {
    case "text": case "info": case "message-strip": return htmlLines(b.html);
    case "when-to-use": return b.items.flatMap((it) => [`${it.doOrDont === "do" ? "Do" : "Don't"}:`, ...htmlLines(it.html)]);
    case "table": return b.rows.map((r) => r.map(plain).join(" | "));
    case "image": return [`Image caption: ${b.caption ?? ""}`, `Image alt text: ${b.alt ?? ""}`];
    case "columns": return b.columns.flatMap((col) => col.flatMap(blockLines));
    default: return [];
  }
}
function articleText(model) {
  const lines = [`# ${model.pageTitle ?? model.component}`];
  for (const s of model.sections) {
    if (!s.noTitle) lines.push("", `${s.titleLevel === "h3" ? "###" : s.titleLevel === "h4" ? "####" : "##"} ${s.title}`);
    for (const b of s.blocks) lines.push(...blockLines(b));
  }
  return lines.join("\n");
}

const doc = JSON.parse(readFileSync(`${base}/content/${slug}/guideline.json`, "utf8"));
const article = articleText(doc.model);
const system = `${readFileSync(".github/copilot-instructions.md", "utf8")}

You get the article as plain text: headings, one paragraph or list item per line, then image captions and alt texts.
Answer with ONLY JSON, no other words:
{"findings":[{"where":"Section > Sub-section","severity":"error|hint","problem":"what is wrong, short","original":"the EXACT wrong text, copied from the article, as short as possible (a phrase or one sentence)","fix":"the replacement for exactly that text"}]}
"original" must appear in the article exactly as you write it. "fix" replaces "original" only. Return {"findings":[]} when nothing is wrong. Do not invent problems. At most 25 findings. Mark as "error" only clear mistakes: wrong term, missing full stop, wrong letter, grammar. Everything else is a "hint".`;

const res = await fetch(process.env.AI_API_URL || "https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model: MODEL, max_tokens: 4096, system, messages: [{ role: "user", content: article }] }),
});
const raw = await res.text();
if (!res.ok) { console.error(`Claude answered ${res.status}: ${raw.slice(0, 500)}`); process.exit(1); }
let findings;
try {
  const text = JSON.parse(raw).content.filter((b) => b.type === "text").map((b) => b.text).join("").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  findings = JSON.parse(text).findings;
  if (!Array.isArray(findings)) throw new Error("no findings list");
} catch (e) { console.error(`The answer was not the expected JSON (${e.message}):`, raw.slice(0, 500)); process.exit(1); }
// Keep only findings that point at real text in the article. This drops anything the model made up.
const kept = findings.filter((f) => typeof f?.original === "string" && typeof f?.fix === "string" && f.original && f.original !== f.fix && article.includes(f.original))
  .map((f) => ({ where: String(f.where ?? ""), severity: f.severity === "error" ? "error" : "hint", problem: String(f.problem ?? ""), original: f.original, fix: f.fix }));
const report = { time: new Date().toISOString(), model: MODEL, slug, errors: kept.filter((f) => f.severity === "error").length, hints: kept.filter((f) => f.severity !== "error").length, dropped: findings.length - kept.length, findings: kept };
const dir = `${base}/content/${slug}/review`; mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/ai-report.json`, JSON.stringify(report, null, 2) + "\n");
const md = [`## AI check: ${slug}`, `${report.errors} errors, ${report.hints} hints · model ${MODEL}`, "", ...kept.map((f) => `- **${f.severity}** · ${f.where}: ${f.problem}\n  - now: ${f.original}\n  - fix: ${f.fix}`)].join("\n");
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
