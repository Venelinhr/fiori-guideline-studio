// Rule audit (no AI): the same result every time. Works on the connector's GuidelineModel.
// Ported from the first tool set (pipeline-v1/scripts/audit-rules.mjs). Rules live in standards/rules.json.
// Read-only: it only reports.
import type { GuidelineModel, Section, Block } from "../model";
import { isGuidelineImage } from "./mdRender";
import { referenceProblems } from "./reference";

export type Severity = "error" | "warning" | "info";
export interface Finding { severity: Severity; rule: string; agent: "structure" | "content" | "technical"; message: string; where: string; suggestion?: string }
export interface Rules {
  requiredSections: string[]; sectionOrder: string[];
  terminology: { wrong: string; right: string; severity?: Severity; why?: string }[];
  bannedPhrases: { phrase: string; why: string }[]; placeholders: string[];
  links: { workingToolHosts: string[]; workingLinkSeverity?: Severity; workingLinkNote?: string; internalHosts: string[]; versionedPathPattern: string };
  style: { maxSentenceWords: number; headingAmpersand: boolean; imagesNeedCaption: boolean; skipTextStartingWith?: string[];
    /** Images that need no caption: the image name (for example "03_Dialog_Types_v1.151") or a section title. Empty by default. */
    imageCaptionOptional?: string[];
    /** A text right before an image that explains a flow with lettered steps (A. … B. …, or C. … D. …) replaces the caption. On unless set to false. */
    noCaptionAfterFlowText?: boolean;
    /** Component availability and Related Links must have the reference layout (src/export/reference.ts). On unless set to false. */
    requireReferenceLayout?: boolean };
}

interface Item { section: string; parent: string; where: string; kind: "h2" | "h3" | "h4" | "p" | "li" | "th" | "td" | "caption" | "alt" | "label"; text: string; links: { text: string; url: string }[] }

const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const plain = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]).replace(/\s+/g, " ").trim();
const linksIn = (h: string) => [...h.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ text: plain(m[2]), url: m[1].replace(/&amp;/g, "&") }));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const sectionKey = (t: string) => t.replace(/&/g, " and ").replace(/\s+/g, " ").trim().toLowerCase();

function htmlItems(html: string): { kind: "p" | "li"; text: string; links: { text: string; url: string }[] }[] {
  const out: { kind: "p" | "li"; text: string; links: { text: string; url: string }[] }[] = [];
  const re = /<(li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi; let m: RegExpExecArray | null; let any = false;
  while ((m = re.exec(html))) { any = true; const t = plain(m[2]); if (t) out.push({ kind: m[1].toLowerCase() as "p" | "li", text: t, links: linksIn(m[2]) }); }
  if (!any) { const t = plain(html); if (t) out.push({ kind: "p", text: t, links: linksIn(html) }); }
  return out;
}

function flatten(m: GuidelineModel): { items: Item[]; images: { block: Extract<Block, { type: "image" }>; section: string }[] } {
  const items: Item[] = []; const images: { block: Extract<Block, { type: "image" }>; section: string }[] = [];
  let parent = "";
  for (const s of m.sections) {
    if (s.noTitle) { /* message strip */ } else if (s.titleLevel !== "h3" && s.titleLevel !== "h4") parent = s.title;
    const base = { section: s.title, parent: s.noTitle ? s.title : parent };
    if (!s.noTitle) items.push({ ...base, where: "heading", kind: s.titleLevel ?? "h2", text: s.title, links: [] });
    let n = 0;
    const visit = (b: Block, prefix: string) => {
      const where = `${prefix}block ${++n} (${b.type})`;
      const add = (kind: Item["kind"], text: string, links: Item["links"] = []) => { if (text) items.push({ ...base, where, kind, text, links }); };
      switch (b.type) {
        case "text": htmlItems(b.html).forEach((i) => add(i.kind, i.text, i.links)); break;
        case "title": add(b.level <= 2 ? "h2" : b.level === 3 ? "h3" : "h4", b.text); break;
        case "image": images.push({ block: b, section: s.title }); add("caption", b.caption); add("alt", b.alt ?? ""); break;
        case "table": b.rows.forEach((r, ri) => r.forEach((c) => add(ri === 0 ? "th" : "td", plain(c), linksIn(c)))); break;
        case "info": case "message-strip": htmlItems(b.html).forEach((i) => add(i.kind, i.text, i.links)); break;
        case "when-to-use": b.items.forEach((it) => htmlItems(it.html).forEach((i) => add(i.kind, i.text, i.links))); break;
        case "columns": b.columns.forEach((col) => col.forEach((c) => visit(c, "column > "))); break;
      }
    };
    s.blocks.forEach((b) => visit(b, ""));
  }
  return { items, images };
}

export function auditModel(m: GuidelineModel, R: Rules): Finding[] {
  const F: Finding[] = [];
  const add = (severity: Severity, agent: Finding["agent"], rule: string, message: string, where: string, suggestion?: string) => F.push({ severity, agent, rule, message, where, ...(suggestion ? { suggestion } : {}) });
  const { items, images } = flatten(m);
  const skip = (t: string) => (R.style.skipTextStartingWith ?? []).some((p) => t.startsWith(p));
  const at = (i: Item) => `${i.parent === i.section ? i.section : `${i.parent} > ${i.section}`} > ${i.where}`;

  // ---------- Structure ----------
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
  for (const it of items) if (!skip(it.text)) for (const ph of R.placeholders) if (new RegExp(`\\b${esc(ph)}\\b`, "i").test(it.text)) add("error", "structure", "placeholder", `Placeholder text "${ph}" in: "${it.text.slice(0, 80)}".`, at(it));
  // Mandatory layout of two sections, taken from the approved reference page.
  if (R.style.requireReferenceLayout !== false)
    for (const p of referenceProblems(m)) add("error", "structure", p.rule, p.message, p.where, "Run the Figma export again: it writes the reference layout. Or move the content by hand in the editor.");
  const real = images.filter((i) => isGuidelineImage(i.block));
  // A caption is the caption field, or a short line of text right after the image (how the Figma parser
  // delivers it for some frames). A short line = one paragraph, up to 14 words, no full stop at the end.
  const captionLine = (blocks: Block[], i: number): string | undefined => {
    const nx = blocks[i + 1];
    if (nx?.type !== "text") return undefined;
    const ps = htmlItems(nx.html);
    return ps.length === 1 && ps[0].kind === "p" && ps[0].text.split(/\s+/).length <= 14 && !/[.!?]$/.test(ps[0].text) ? ps[0].text : undefined;
  };
  const sepCaption = new Set<string>();
  for (const s of m.sections) s.blocks.forEach((b, i) => { if (b.type === "image" && !b.caption.trim() && captionLine(s.blocks, i)) sepCaption.add(b.figmaName ?? b.ref); });
  // The text right before an image can narrate a FLOW in lettered steps: "A. The tab bar contains 11 tabs. …" then
  // "B. Moving the pointer … applies the hover state." The image then shows that flow and needs no caption.
  // It does NOT count when the letters label ELEMENTS ("A. Text element: Clicking …", "B. Arrow element: …"): a step is
  // a sentence, an element description starts with a short label (up to 4 words, not starting like a sentence) and a colon. Then the caption is mandatory.
  // At least two steps with consecutive letters are needed. A step may be its own paragraph, follow a line break,
  // or follow the end of the sentence before it.
  const isFlowText = (html: string): boolean => {
    // Keep the line breaks (plain() would flatten them): a step can follow a heading that has no full stop.
    const text = html.replace(/<\/p>|<\/li>|<br\s*\/?>/gi, "\n").replace(/[\u2028\u2029]/g, "\n").replace(/<[^>]+>/g, "")
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (x) => ENT[x]).replace(/[ \t\u00a0]+/g, " ");
    const marks: { letter: number; at: number; end: number }[] = [];
    const re = /(^|\n|[.!?]\s)\s*([A-Z])\.\s+(?=\S)/g; let m: RegExpExecArray | null;
    while ((m = re.exec(text))) marks.push({ letter: m[2].charCodeAt(0), at: m.index, end: m.index + m[0].length });
    if (marks.length < 2 || !marks.every((x, i) => i === 0 || x.letter === marks[i - 1].letter + 1)) return false;
    // An element description: the first words up to a colon, before the first full stop.
    return !marks.some((x, i) => {
      const body = text.slice(x.end, marks[i + 1]?.at ?? text.length).trimStart();
      const colon = body.indexOf(":"), stop = body.search(/[.!?]/);
      const label = body.slice(0, colon).trim();
      return colon > 0 && colon <= 40 && label.split(/\s+/).length <= 4 && !/^(the|a|an|this|these|when|after|before|if|once)\b/i.test(label) && (stop === -1 || colon < stop);
    });
  };
  const afterFlow = new Set<string>();
  if (R.style.noCaptionAfterFlowText !== false)
    for (const s of m.sections) s.blocks.forEach((b, i) => { const pv = s.blocks[i - 1]; if (b.type === "image" && pv?.type === "text" && isFlowText(pv.html)) afterFlow.add(b.figmaName ?? b.ref); });
  const optional = new Set((R.style.imageCaptionOptional ?? []).map((x) => x.trim().toLowerCase()));
  // A caption describes the picture. A pointer ("For more information, see …") or a full sentence is a paragraph, not a caption.
  const looksLikeParagraph = (c: string) => /^for more information\b/i.test(c.trim()) || (/[.!?]$/.test(c.trim()) && c.trim().split(/\s+/).length > 14);
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
  // Numbering is checked only for images that carry the guideline's own name. A frame kept from another guideline has its own number.
  const ownLetters = (m.component || m.pageTitle || "").toLowerCase().replace(/[^a-z]/g, "");
  const numbered = real.filter((i) => !ownLetters || (i.block.figmaName ?? "").replace(/^\d{2}_/, "").toLowerCase().replace(/[^a-z]/g, "").includes(ownLetters));
  numbered.forEach((i, k) => { const n = Number(i.block.figmaName?.match(/^(\d{2})_/)?.[1]); if (n !== k + 1) add("warning", "structure", "image-number", `Image "${i.block.figmaName}" is number ${n} but is image ${k + 1} on the page.`, i.section, "Renumber the image frames in reading order."); });
  const versions = [...new Set(real.map((i) => i.block.figmaName?.match(/_v([\d.]+)$/)?.[1]).filter(Boolean))];
  if (versions.length > 1) add("warning", "structure", "image-version", `Image frames have different versions: ${versions.join(", ")}.`, "page");

  // ---------- Content ----------
  for (const it of items) {
    if (skip(it.text)) continue;
    for (const t of R.terminology) if (new RegExp(`\\b${esc(t.wrong)}\\b`, "i").test(it.text)) add(t.severity ?? "warning", "content", "terminology", `Use "${t.right}", not "${t.wrong}". ${t.why ?? ""}`.trim(), at(it), it.text.replace(new RegExp(`\\b${esc(t.wrong)}\\b`, "gi"), t.right).slice(0, 160));
    for (const b of R.bannedPhrases) if (new RegExp(`(^|\\W)${esc(b.phrase)}(\\W|$)`, "i").test(it.text)) add("warning", "content", "banned-phrase", `Do not use "${b.phrase}". ${b.why}`, at(it));
    // Letters from another alphabet that look like Latin letters (for example Cyrillic "е"). They break search and screen readers.
    const bad = [...it.text.matchAll(/[A-Za-z]*[Ͱ-ϿЀ-ӿ]+[A-Za-z]*/g)].filter((x) => /[A-Za-z]/.test(x[0]) || x[0].length === 1).map((x) => x[0]);
    if (bad.length && !/[؀-ۿ]/.test(it.text)) add("error", "content", "look-alike-letter", `Non-Latin look-alike letter in: ${bad.map((w) => `"${w}"`).join(", ")}.`, at(it), "Type the word again with the Latin keyboard layout.");
    if (["h2", "h3", "h4"].includes(it.kind)) {
      if (!R.style.headingAmpersand && it.text.includes("&")) add("warning", "content", "heading-ampersand", `Heading "${it.text}" uses "&".`, at(it), it.text.replace(/\s*&\s*/g, " and "));
      if (/[.:;,]$/.test(it.text)) add("warning", "content", "heading-punctuation", `Heading "${it.text}" ends with punctuation.`, at(it));
    }
    if (it.kind === "p" || it.kind === "li") for (const sen of it.text.split(/(?<=[.!?])\s+/)) { const w = sen.split(/\s+/).length; if (w > R.style.maxSentenceWords) add("info", "content", "long-sentence", `Sentence has ${w} words (limit ${R.style.maxSentenceWords}): "${sen.slice(0, 80)}…"`, at(it), "Split it into two sentences."); }
  }
  const h3 = items.filter((i) => i.kind === "h3" && !/^related links/i.test(i.parent) && i.text.split(/\s+/).length > 1);
  const isTitle = (t: string) => t.split(/[\s/]+/).slice(1).filter((w) => w.length > 3 && /^[A-Za-z]/.test(w)).every((w) => /^[A-Z]/.test(w));
  const tc = h3.filter((i) => isTitle(i.text)), sc = h3.filter((i) => !isTitle(i.text));
  if (tc.length && sc.length) { const [minor, style] = tc.length <= sc.length ? [tc, "sentence case"] : [sc, "title case"]; add("warning", "content", "heading-case", `Sub-headings mix title case (${tc.length}) and sentence case (${sc.length}). Different from the majority: ${minor.map((i) => `"${i.text}"`).join(", ")}.`, "page", `Use ${style} for all sub-headings.`); }

  // ---------- Technical (links) ----------
  const L = R.links; const verRe = new RegExp(L.versionedPathPattern);
  const pinned = new Map<string, number>(); let unpinned = 0;
  for (const it of items) for (const l of it.links) {
    const inRelated = /^related links/i.test(it.parent);
    if (L.workingToolHosts.some((h) => l.url.includes(h)) && !(it.kind === "td" || inRelated)) add(L.workingLinkSeverity ?? "error", "technical", "working-link", `Link "${l.text}" goes to a Figma working file: ${l.url}${L.workingLinkNote ? ` (${L.workingLinkNote})` : ""}`, at(it));
    if (L.internalHosts.some((h) => l.url.includes(h)) && /external/i.test(it.parent)) add("error", "technical", "internal-link", `Internal link "${l.text}" in an external section: ${l.url}`, at(it));
    else if (L.internalHosts.some((h) => l.url.includes(h)) && !inRelated) add("warning", "technical", "internal-link", `Internal link "${l.text}" in public content: ${l.url}`, at(it));
    const v = l.url.match(verRe);
    if (v) pinned.set(`${v[1]}.${v[2]}`, (pinned.get(`${v[1]}.${v[2]}`) ?? 0) + 1); else if (l.url.includes("/fiori-design-web/")) unpinned++;
    if (!/^https:\/\//.test(l.url)) add("warning", "technical", "link-protocol", `Link "${l.text}" does not use https: ${l.url}`, at(it));
  }
  if (pinned.size && (pinned.size > 1 || unpinned)) add("warning", "technical", "link-version", `Guideline links point to different versions: ${[...pinned].map(([v, n]) => `v${v} (${n} links)`).join(", ")}${unpinned ? `, and ${unpinned} links with no version` : ""}.`, "page", "Use one rule for all links: no version, or the version of this guideline.");
  return F;
}

export const verdictOf = (f: Finding[]): "pass" | "fix" | "review" => (f.some((x) => x.severity === "error") ? "fix" : f.some((x) => x.severity === "warning") ? "review" : "pass");

export function renderRuleReport(m: GuidelineModel, f: Finding[]): string {
  const v = verdictOf(f);
  const lines = [`# Rule audit: ${m.pageTitle ?? m.component}`, "", `**Verdict: ${{ pass: "PASS", fix: "FIX", review: "REVIEW" }[v]}** (${f.filter((x) => x.severity === "error").length} errors, ${f.filter((x) => x.severity === "warning").length} warnings, ${f.filter((x) => x.severity === "info").length} notes)`, ""];
  if (f.length) {
    lines.push("| Severity | Area | Rule | Where | Finding | Suggested fix |", "|---|---|---|---|---|---|");
    const cell = (s?: string) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    for (const x of [...f].sort((a, b) => ["error", "warning", "info"].indexOf(a.severity) - ["error", "warning", "info"].indexOf(b.severity))) lines.push(`| ${x.severity} | ${x.agent} | ${x.rule} | ${cell(x.where)} | ${cell(x.message)} | ${cell(x.suggestion)} |`);
  }
  return lines.join("\n") + "\n";
}
