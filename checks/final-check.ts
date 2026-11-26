// Final check before AEM. Runs in GitHub Actions after the editor approves (merge to main).
// 1. The guideline rules (standards/rules.json): sections, alt text, captions, terms, banned words, links, headings.
// 2. Writing patterns: missing full stop, space before , . ; : ! ?, missing space after a comma, double space,
//    repeated word, missing comma after an opening word such as "However".
// One result per guideline. Errors fail the check. Hints are shown and do not fail it.
// Usage: node scripts/final-check.mjs [--publish]   (--publish posts one commit status per guideline)
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync } from "node:fs";
import { auditModel, type Finding, type Rules } from "../src/export/ruleAudit";
import type { GuidelineModel, Block } from "../src/model";

const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const plain = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENT[m]).replace(/&nbsp;/g, " ").trim();

interface Item { where: string; kind: "p" | "li"; text: string }
function htmlItems(html: string, where: string): Item[] {
  const out: Item[] = []; const re = /<(li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi; let m: RegExpExecArray | null; let any = false;
  while ((m = re.exec(html))) { any = true; const t = plain(m[2]); if (t) out.push({ where, kind: m[1].toLowerCase() as "p" | "li", text: t }); }
  if (!any) { const t = plain(html); if (t) out.push({ where, kind: "p", text: t }); }
  return out;
}
// Body text only: paragraphs and list items of text, info, message strip and Do/Don't blocks. No titles, captions, alt text or table cells.
export function bodyItems(m: GuidelineModel): Item[] {
  const out: Item[] = []; let parent = "";
  for (const s of m.sections) {
    if (!s.noTitle && s.titleLevel !== "h3" && s.titleLevel !== "h4") parent = s.title;
    const base = s.noTitle || parent === s.title ? s.title : `${parent} > ${s.title}`;
    if (/^related links/i.test(parent)) continue; // link labels, not sentences
    let n = 0;
    const visit = (b: Block, prefix: string, prev?: Block) => {
      const where = `${base} > ${prefix}block ${++n} (${b.type})`;
      if (b.type === "text" && prev?.type === "image") {
        // A short single line right after an image is its caption, not a sentence.
        const items = htmlItems(b.html, where);
        if (items.length === 1 && items[0].kind === "p" && items[0].text.split(/\s+/).length <= 14) return;
      }
      if (b.type === "text" || b.type === "info" || b.type === "message-strip") out.push(...htmlItems(b.html, where));
      else if (b.type === "when-to-use") b.items.forEach((it) => out.push(...htmlItems(it.html, where)));
      else if (b.type === "columns") b.columns.forEach((col) => col.forEach((c, i) => visit(c, "column > ", col[i - 1])));
    };
    s.blocks.forEach((b, i) => visit(b, "", s.blocks[i - 1]));
  }
  return out;
}

const OPENERS = ["However", "Therefore", "Moreover", "Furthermore", "For example", "For instance", "In addition"];
export function patternFindings(m: GuidelineModel): Finding[] {
  const F: Finding[] = [];
  const add = (severity: Finding["severity"], rule: string, message: string, where: string, text: string) =>
    F.push({ severity, agent: "content", rule, message, where, suggestion: text.length > 120 ? `${text.slice(0, 117)}…` : text });
  for (const it of bodyItems(m)) {
    const t = it.text; const words = t.split(/\s+/).length;
    if (t.startsWith(":badge")) continue;
    // A full sentence or list item ends with . ! ? or : ("The following elements:" introduces a list).
    if (words >= 4 && !/[.!?:)"”’]$/.test(t.replace(/ /g, " ").trim()) && !/^https?:\/\//.test(t))
      add(it.kind === "p" ? "error" : "warning", "missing-full-stop", `Missing full stop at the end: "…${t.slice(-40)}"`, it.where, t);
    if (/\s[,;.!?](?=\s|$)/.test(t.replace(/ /g, " "))) add("warning", "space-before-punctuation", "A space before , ; . ! or ?", it.where, t);
    if (/[a-z][,;][A-Za-z]/.test(t)) add("warning", "missing-space-after-comma", "A comma or semicolon without a space after it.", it.where, t);
    if (/[^\s ] {2,}[^\s]/.test(t)) add("warning", "double-space", "Two spaces in a row.", it.where, t);
    const rep = t.match(/\b([A-Za-z]{2,})\s+\1\b/i);
    if (rep) add("warning", "repeated-word", `The word "${rep[1]}" is repeated.`, it.where, t);
    for (const o of OPENERS) if (new RegExp(`(^|[.!?]\\s+)${o}\\s+(?!,)[a-z]`).test(t)) add("warning", "missing-comma-after-opener", `Add a comma after "${o}".`, it.where, t);
  }
  return F;
}

export interface Result { slug: string; title: string; errors: number; hints: number; findings: Finding[]; state: "success" | "failure" }
export function checkGuideline(slug: string, doc: any, rules: Rules): Result {
  const model = doc.model as GuidelineModel;
  const findings = [...auditModel(model, rules), ...patternFindings(model)];
  const errors = findings.filter((f) => f.severity === "error").length;
  const hints = findings.filter((f) => f.severity !== "error" && f.severity !== "info").length;
  return { slug, title: model.pageTitle ?? model.component, errors, hints, findings, state: errors ? "failure" : "success" };
}

const description = (r: Result) => {
  const first = r.findings.find((f) => f.severity === "error");
  const d = r.errors ? `${r.errors} error${r.errors > 1 ? "s" : ""}, ${r.hints} hints. First: ${first!.message}` : `No errors, ${r.hints} hints.`;
  return d.length > 138 ? d.slice(0, 137) + "…" : d;
};

async function main() {
  const publish = process.argv.includes("--publish");
  const rules = JSON.parse(readFileSync("standards/rules.json", "utf8")) as Rules;
  const slugs = readdirSync("content", { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`content/${d.name}/guideline.json`)).map((d) => d.name);
  const results = slugs.map((s) => checkGuideline(s, JSON.parse(readFileSync(`content/${s}/guideline.json`, "utf8")), rules));
  const lines: string[] = ["# Final check before AEM", ""];
  for (const r of results) {
    lines.push(`## ${r.state === "success" ? "✅" : "❌"} ${r.title} (${r.slug}): ${r.errors} errors, ${r.hints} hints`, "");
    for (const f of r.findings.filter((x) => x.severity !== "info")) lines.push(`- **${f.severity === "error" ? "Error" : "Hint"}** \`${f.rule}\` · ${f.where}: ${f.message}`);
    lines.push("");
  }
  writeFileSync("final-check-report.md", lines.join("\n"));
  writeFileSync("final-check-report.json", JSON.stringify(results, null, 2) + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  for (const r of results) console.log(`${r.state === "success" ? "PASS" : "FAIL"} ${r.slug}: ${r.errors} errors, ${r.hints} hints`);
  if (publish) {
    const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_SERVER_URL, GITHUB_RUN_ID } = process.env;
    if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_SHA) throw new Error("--publish needs GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA.");
    for (const r of results) {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/statuses/${GITHUB_SHA}`, {
        method: "POST", headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json" },
        body: JSON.stringify({ state: r.state, context: `final-check/${r.slug}`, description: description(r), target_url: `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` }) });
      if (!res.ok) throw new Error(`Could not publish the status for ${r.slug}: ${res.status} ${await res.text()}`);
    }
    return; // the statuses carry the result
  }
  if (results.some((r) => r.state === "failure")) process.exitCode = 1;
}
if (process.argv[1] && /final-check/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(2); });
