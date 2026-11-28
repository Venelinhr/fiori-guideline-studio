// checks/final-check.ts
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync } from "node:fs";

// src/export/mdRender.ts
var isGuidelineImage = (b) => /^\d{2}_/.test(b.figmaName ?? "");

// src/export/ruleAudit.ts
var ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
var plain = (h) => h.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]).replace(/\s+/g, " ").trim();
var linksIn = (h) => [...h.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ text: plain(m[2]), url: m[1].replace(/&amp;/g, "&") }));
var esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var sectionKey = (t) => t.replace(/&/g, " and ").replace(/\s+/g, " ").trim().toLowerCase();
function htmlItems(html) {
  const out = [];
  const re = /<(li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  let any = false;
  while (m = re.exec(html)) {
    any = true;
    const t = plain(m[2]);
    if (t) out.push({ kind: m[1].toLowerCase(), text: t, links: linksIn(m[2]) });
  }
  if (!any) {
    const t = plain(html);
    if (t) out.push({ kind: "p", text: t, links: linksIn(html) });
  }
  return out;
}
function flatten(m) {
  const items = [];
  const images = [];
  let parent = "";
  for (const s of m.sections) {
    if (s.noTitle) {
    } else if (s.titleLevel !== "h3" && s.titleLevel !== "h4") parent = s.title;
    const base = { section: s.title, parent: s.noTitle ? s.title : parent };
    if (!s.noTitle) items.push({ ...base, where: "heading", kind: s.titleLevel ?? "h2", text: s.title, links: [] });
    let n = 0;
    const visit = (b, prefix) => {
      const where = `${prefix}block ${++n} (${b.type})`;
      const add = (kind, text, links = []) => {
        if (text) items.push({ ...base, where, kind, text, links });
      };
      switch (b.type) {
        case "text":
          htmlItems(b.html).forEach((i) => add(i.kind, i.text, i.links));
          break;
        case "title":
          add(b.level <= 2 ? "h2" : b.level === 3 ? "h3" : "h4", b.text);
          break;
        case "image":
          images.push({ block: b, section: s.title });
          add("caption", b.caption);
          add("alt", b.alt ?? "");
          break;
        case "table":
          b.rows.forEach((r, ri) => r.forEach((c) => add(ri === 0 ? "th" : "td", plain(c), linksIn(c))));
          break;
        case "info":
        case "message-strip":
          htmlItems(b.html).forEach((i) => add(i.kind, i.text, i.links));
          break;
        case "when-to-use":
          b.items.forEach((it) => htmlItems(it.html).forEach((i) => add(i.kind, i.text, i.links)));
          break;
        case "columns":
          b.columns.forEach((col) => col.forEach((c) => visit(c, "column > ")));
          break;
      }
    };
    s.blocks.forEach((b) => visit(b, ""));
  }
  return { items, images };
}
function auditModel(m, R) {
  const F = [];
  const add = (severity, agent, rule, message, where, suggestion) => F.push({ severity, agent, rule, message, where, ...suggestion ? { suggestion } : {} });
  const { items, images } = flatten(m);
  const skip = (t) => (R.style.skipTextStartingWith ?? []).some((p) => t.startsWith(p));
  const at = (i) => `${i.parent === i.section ? i.section : `${i.parent} > ${i.section}`} > ${i.where}`;
  const top = m.sections.filter((s) => !s.noTitle && s.titleLevel !== "h3" && s.titleLevel !== "h4");
  const have = new Set(top.map((s) => sectionKey(s.title)));
  for (const req of R.requiredSections) if (!have.has(sectionKey(req))) add("error", "structure", "required-section", `Required section "${req}" is missing.`, "page");
  const order = R.sectionOrder.map(sectionKey);
  const known = top.map((s) => sectionKey(s.title)).filter((k) => order.includes(k));
  const sorted = [...known].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (known.join("|") !== sorted.join("|")) add("warning", "structure", "section-order", `Sections are not in the standard order. Found: ${known.join(" > ")}.`, "page", `Use: ${sorted.join(" > ")}.`);
  for (const s of top) if (!order.includes(sectionKey(s.title))) add("info", "structure", "unknown-section", `Section "${s.title}" is not in the standard section list.`, s.title);
  m.sections.forEach((s, i) => {
    if (s.noTitle || s.blocks.length) return;
    const next = m.sections[i + 1];
    const hasChildren = (s.titleLevel === "h2" || !s.titleLevel) && next && (next.titleLevel === "h3" || next.titleLevel === "h4");
    if (!hasChildren && s.titleLevel !== "h3") add("error", "structure", "empty-section", "The section has no content.", s.title);
    else if (!hasChildren) add("warning", "structure", "empty-section", "The sub-section has no content.", s.title);
  });
  for (const it of items) if (!skip(it.text)) {
    for (const ph of R.placeholders) if (new RegExp(`\\b${esc(ph)}\\b`, "i").test(it.text)) add("error", "structure", "placeholder", `Placeholder text "${ph}" in: "${it.text.slice(0, 80)}".`, at(it));
  }
  const real = images.filter((i) => isGuidelineImage(i.block));
  const captionLine = (blocks, i) => {
    const nx = blocks[i + 1];
    if (nx?.type !== "text") return void 0;
    const ps = htmlItems(nx.html);
    return ps.length === 1 && ps[0].kind === "p" && ps[0].text.split(/\s+/).length <= 14 && !/[.!?]$/.test(ps[0].text) ? ps[0].text : void 0;
  };
  const sepCaption = /* @__PURE__ */ new Set();
  for (const s of m.sections) s.blocks.forEach((b, i) => {
    if (b.type === "image" && !b.caption.trim() && captionLine(s.blocks, i)) sepCaption.add(b.figmaName ?? b.ref);
  });
  const isFlowText = (html) => {
    const text = html.replace(/<\/p>|<\/li>|<br\s*\/?>/gi, "\n").replace(/[\u2028\u2029]/g, "\n").replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (x) => ENT[x]).replace(/[ \t\u00a0]+/g, " ");
    const marks = [];
    const re = /(^|\n|[.!?]\s)\s*([A-Z])\.\s+(?=\S)/g;
    let m2;
    while (m2 = re.exec(text)) marks.push({ letter: m2[2].charCodeAt(0), at: m2.index, end: m2.index + m2[0].length });
    if (marks.length < 2 || !marks.every((x, i) => i === 0 || x.letter === marks[i - 1].letter + 1)) return false;
    return !marks.some((x, i) => {
      const body = text.slice(x.end, marks[i + 1]?.at ?? text.length).trimStart();
      const colon = body.indexOf(":"), stop = body.search(/[.!?]/);
      const label = body.slice(0, colon).trim();
      return colon > 0 && colon <= 40 && label.split(/\s+/).length <= 4 && !/^(the|a|an|this|these|when|after|before|if|once)\b/i.test(label) && (stop === -1 || colon < stop);
    });
  };
  const afterFlow = /* @__PURE__ */ new Set();
  if (R.style.noCaptionAfterFlowText !== false)
    for (const s of m.sections) s.blocks.forEach((b, i) => {
      const pv = s.blocks[i - 1];
      if (b.type === "image" && pv?.type === "text" && isFlowText(pv.html)) afterFlow.add(b.figmaName ?? b.ref);
    });
  const optional = new Set((R.style.imageCaptionOptional ?? []).map((x) => x.trim().toLowerCase()));
  const looksLikeParagraph = (c) => /^for more information\b/i.test(c.trim()) || /[.!?]$/.test(c.trim()) && c.trim().split(/\s+/).length > 14;
  for (const { block, section } of real) {
    const name = block.figmaName ?? block.ref;
    const exempt = optional.has(name.toLowerCase()) || optional.has(section.toLowerCase()) || afterFlow.has(name);
    if (R.style.imagesNeedCaption && !block.caption.trim() && !exempt) {
      if (sepCaption.has(name)) add("warning", "structure", "image-caption-separate", `Image "${name}": the caption is a separate text line after the image. Move it into the image caption.`, section, "Put that line in the caption field of the image.");
      else add("error", "structure", "image-caption", `Image "${name}" has no caption.`, section, "Add the caption in Figma (the text under the image), or list this image in standards/rules.json > style > imageCaptionOptional if it needs none.");
    }
    if (R.style.imagesNeedCaption && block.caption.trim() && looksLikeParagraph(block.caption))
      add("warning", "structure", "image-caption-is-paragraph", `Image "${name}": the caption "${block.caption.trim().slice(0, 60)}" reads like a paragraph or a pointer, not a description of the image.`, section, "Use a short label for the picture as the caption. Keep this line as its own text below the image.");
    if (!block.alt?.trim()) add("error", "structure", "image-alt", `Image "${name}" has no alt text.`, section, "Add the alt text in the Alt Tag frame under the image in Figma.");
  }
  const ownLetters = (m.component || m.pageTitle || "").toLowerCase().replace(/[^a-z]/g, "");
  const numbered = real.filter((i) => !ownLetters || (i.block.figmaName ?? "").replace(/^\d{2}_/, "").toLowerCase().replace(/[^a-z]/g, "").includes(ownLetters));
  numbered.forEach((i, k) => {
    const n = Number(i.block.figmaName?.match(/^(\d{2})_/)?.[1]);
    if (n !== k + 1) add("warning", "structure", "image-number", `Image "${i.block.figmaName}" is number ${n} but is image ${k + 1} on the page.`, i.section, "Renumber the image frames in reading order.");
  });
  const versions = [...new Set(real.map((i) => i.block.figmaName?.match(/_v([\d.]+)$/)?.[1]).filter(Boolean))];
  if (versions.length > 1) add("warning", "structure", "image-version", `Image frames have different versions: ${versions.join(", ")}.`, "page");
  for (const it of items) {
    if (skip(it.text)) continue;
    for (const t of R.terminology) if (new RegExp(`\\b${esc(t.wrong)}\\b`, "i").test(it.text)) add(t.severity ?? "warning", "content", "terminology", `Use "${t.right}", not "${t.wrong}". ${t.why ?? ""}`.trim(), at(it), it.text.replace(new RegExp(`\\b${esc(t.wrong)}\\b`, "gi"), t.right).slice(0, 160));
    for (const b of R.bannedPhrases) if (new RegExp(`(^|\\W)${esc(b.phrase)}(\\W|$)`, "i").test(it.text)) add("warning", "content", "banned-phrase", `Do not use "${b.phrase}". ${b.why}`, at(it));
    const bad = [...it.text.matchAll(/[A-Za-z]*[Ͱ-ϿЀ-ӿ]+[A-Za-z]*/g)].filter((x) => /[A-Za-z]/.test(x[0]) || x[0].length === 1).map((x) => x[0]);
    if (bad.length && !/[؀-ۿ]/.test(it.text)) add("error", "content", "look-alike-letter", `Non-Latin look-alike letter in: ${bad.map((w) => `"${w}"`).join(", ")}.`, at(it), "Type the word again with the Latin keyboard layout.");
    if (["h2", "h3", "h4"].includes(it.kind)) {
      if (!R.style.headingAmpersand && it.text.includes("&")) add("warning", "content", "heading-ampersand", `Heading "${it.text}" uses "&".`, at(it), it.text.replace(/\s*&\s*/g, " and "));
      if (/[.:;,]$/.test(it.text)) add("warning", "content", "heading-punctuation", `Heading "${it.text}" ends with punctuation.`, at(it));
    }
    if (it.kind === "p" || it.kind === "li") for (const sen of it.text.split(/(?<=[.!?])\s+/)) {
      const w = sen.split(/\s+/).length;
      if (w > R.style.maxSentenceWords) add("info", "content", "long-sentence", `Sentence has ${w} words (limit ${R.style.maxSentenceWords}): "${sen.slice(0, 80)}\u2026"`, at(it), "Split it into two sentences.");
    }
  }
  const h3 = items.filter((i) => i.kind === "h3" && !/^related links/i.test(i.parent) && i.text.split(/\s+/).length > 1);
  const isTitle = (t) => t.split(/[\s/]+/).slice(1).filter((w) => w.length > 3 && /^[A-Za-z]/.test(w)).every((w) => /^[A-Z]/.test(w));
  const tc = h3.filter((i) => isTitle(i.text)), sc = h3.filter((i) => !isTitle(i.text));
  if (tc.length && sc.length) {
    const [minor, style] = tc.length <= sc.length ? [tc, "sentence case"] : [sc, "title case"];
    add("warning", "content", "heading-case", `Sub-headings mix title case (${tc.length}) and sentence case (${sc.length}). Different from the majority: ${minor.map((i) => `"${i.text}"`).join(", ")}.`, "page", `Use ${style} for all sub-headings.`);
  }
  const L = R.links;
  const verRe = new RegExp(L.versionedPathPattern);
  const pinned = /* @__PURE__ */ new Map();
  let unpinned = 0;
  for (const it of items) for (const l of it.links) {
    const inRelated = /^related links/i.test(it.parent);
    if (L.workingToolHosts.some((h) => l.url.includes(h)) && !(it.kind === "td" || inRelated)) add(L.workingLinkSeverity ?? "error", "technical", "working-link", `Link "${l.text}" goes to a Figma working file: ${l.url}${L.workingLinkNote ? ` (${L.workingLinkNote})` : ""}`, at(it));
    if (L.internalHosts.some((h) => l.url.includes(h)) && /external/i.test(it.parent)) add("error", "technical", "internal-link", `Internal link "${l.text}" in an external section: ${l.url}`, at(it));
    else if (L.internalHosts.some((h) => l.url.includes(h)) && !inRelated) add("warning", "technical", "internal-link", `Internal link "${l.text}" in public content: ${l.url}`, at(it));
    const v = l.url.match(verRe);
    if (v) pinned.set(`${v[1]}.${v[2]}`, (pinned.get(`${v[1]}.${v[2]}`) ?? 0) + 1);
    else if (l.url.includes("/fiori-design-web/")) unpinned++;
    if (!/^https:\/\//.test(l.url)) add("warning", "technical", "link-protocol", `Link "${l.text}" does not use https: ${l.url}`, at(it));
  }
  if (pinned.size && (pinned.size > 1 || unpinned)) add("warning", "technical", "link-version", `Guideline links point to different versions: ${[...pinned].map(([v, n]) => `v${v} (${n} links)`).join(", ")}${unpinned ? `, and ${unpinned} links with no version` : ""}.`, "page", "Use one rule for all links: no version, or the version of this guideline.");
  return F;
}

// checks/rules.ts
var ENT2 = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
var plain2 = (h) => h.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENT2[m]).replace(/&nbsp;/g, "\xA0").trim();
function htmlItems2(html, where) {
  const out = [];
  const re = /<(li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  let any = false;
  while (m = re.exec(html)) {
    any = true;
    const t = plain2(m[2]);
    if (t) out.push({ where, kind: m[1].toLowerCase(), text: t });
  }
  if (!any) {
    const t = plain2(html);
    if (t) out.push({ where, kind: "p", text: t });
  }
  return out;
}
function bodyItems(m) {
  const out = [];
  let parent = "";
  for (const s of m.sections) {
    if (!s.noTitle && s.titleLevel !== "h3" && s.titleLevel !== "h4") parent = s.title;
    const base = s.noTitle || parent === s.title ? s.title : `${parent} > ${s.title}`;
    if (/^related links/i.test(parent)) continue;
    let n = 0;
    const visit = (b, prefix, prev) => {
      const where = `${base} > ${prefix}block ${++n} (${b.type})`;
      if (b.type === "text" && prev?.type === "image") {
        const items = htmlItems2(b.html, where);
        if (items.length === 1 && items[0].kind === "p" && items[0].text.split(/\s+/).length <= 14) return;
      }
      if (b.type === "text" || b.type === "info" || b.type === "message-strip") out.push(...htmlItems2(b.html, where));
      else if (b.type === "when-to-use") b.items.forEach((it) => out.push(...htmlItems2(it.html, where)));
      else if (b.type === "columns") b.columns.forEach((col) => col.forEach((c, i) => visit(c, "column > ", col[i - 1])));
    };
    s.blocks.forEach((b, i) => visit(b, "", s.blocks[i - 1]));
  }
  return out;
}
var OPENERS = ["However", "Therefore", "Moreover", "Furthermore", "For example", "For instance", "In addition"];
function patternFindings(m) {
  const F = [];
  const add = (severity, rule, message, where, text) => F.push({ severity, agent: "content", rule, message, where, suggestion: text.length > 120 ? `${text.slice(0, 117)}\u2026` : text });
  for (const it of bodyItems(m)) {
    const t = it.text;
    const words = t.split(/\s+/).length;
    if (t.startsWith(":badge")) continue;
    if (words >= 4 && !/[.!?:)"”’]$/.test(t.replace(/ /g, " ").trim()) && !/^https?:\/\//.test(t))
      add(it.kind === "p" ? "error" : "warning", "missing-full-stop", `Missing full stop at the end: "\u2026${t.slice(-40)}"`, it.where, t);
    if (/\s[,;.!?](?=\s|$)/.test(t.replace(/ /g, " "))) add("warning", "space-before-punctuation", "A space before , ; . ! or ?", it.where, t);
    if (/[a-z][,;][A-Za-z]/.test(t)) add("warning", "missing-space-after-comma", "A comma or semicolon without a space after it.", it.where, t);
    if (/[^\s ] {2,}[^\s]/.test(t)) add("warning", "double-space", "Two spaces in a row.", it.where, t);
    const rep = t.match(/\b([A-Za-z]{2,})\s+\1\b/i);
    if (rep) add("warning", "repeated-word", `The word "${rep[1]}" is repeated.`, it.where, t);
    for (const o of OPENERS) if (new RegExp(`(^|[.!?]\\s+)${o}\\s+(?!,)[a-z]`).test(t)) add("warning", "missing-comma-after-opener", `Add a comma after "${o}".`, it.where, t);
  }
  return F;
}
function checkGuideline(slug, doc, rules) {
  const model = doc.model;
  const findings = [...auditModel(model, rules), ...patternFindings(model)];
  const errors = findings.filter((f) => f.severity === "error").length;
  const hints = findings.filter((f) => f.severity !== "error" && f.severity !== "info").length;
  return { slug, title: model.pageTitle ?? model.component, errors, hints, findings, state: errors ? "failure" : "success" };
}

// checks/final-check.ts
var description = (r) => {
  const first = r.findings.find((f) => f.severity === "error");
  const d = r.errors ? `${r.errors} error${r.errors > 1 ? "s" : ""}, ${r.hints} hints. First: ${first.message}` : `No errors, ${r.hints} hints.`;
  return d.length > 138 ? d.slice(0, 137) + "\u2026" : d;
};
async function main() {
  const publish = process.argv.includes("--publish");
  const rules = JSON.parse(readFileSync("standards/rules.json", "utf8"));
  const slugs = readdirSync("content", { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`content/${d.name}/guideline.json`)).map((d) => d.name);
  const results = slugs.map((s) => checkGuideline(s, JSON.parse(readFileSync(`content/${s}/guideline.json`, "utf8")), rules));
  const lines = ["# Final check before AEM", ""];
  for (const r of results) {
    lines.push(`## ${r.state === "success" ? "\u2705" : "\u274C"} ${r.title} (${r.slug}): ${r.errors} errors, ${r.hints} hints`, "");
    for (const f of r.findings.filter((x) => x.severity !== "info")) lines.push(`- **${f.severity === "error" ? "Error" : "Hint"}** \`${f.rule}\` \xB7 ${f.where}: ${f.message}`);
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
        method: "POST",
        headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json" },
        body: JSON.stringify({ state: r.state, context: `final-check/${r.slug}`, description: description(r), target_url: `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` })
      });
      if (!res.ok) throw new Error(`Could not publish the status for ${r.slug}: ${res.status} ${await res.text()}`);
    }
    return;
  }
  if (results.some((r) => r.state === "failure")) process.exitCode = 1;
}
if (process.argv[1] && /final-check/.test(process.argv[1])) main().catch((e) => {
  console.error(e);
  process.exit(2);
});
