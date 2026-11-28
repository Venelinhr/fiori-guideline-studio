// The reference layout for two sections. Taken from a finished, approved AEM page (Icon Tab Bar, v1-157).
// Applied in the Figma export and when an article is loaded from GitHub, so the JSON, GitHub and AEM all have it.
// Pure and idempotent: running it again changes nothing.
//
// 1. Component availability is not its own section. Its heading is an inline <h3> in a text node, together with the
//    intro line. It sits inside the parent section (Intro), followed by its table and info box, as direct blocks.
//    Two tables mean internal and external: they are wrapped in [internal_only] ... [/internal_only] and
//    [external_only] ... [/external_only] marker lines.
// 2. Related Links is ONE section: [internal_only], a columns block, [/internal_only], [external_only], a columns
//    block, [/external_only]. Each column holds real titles (level 4) and their text. "Related Links (external only)"
//    is not a section of its own. When only one set of links exists there are no marker lines.
import type { GuidelineModel, Section, Block, TextBlock, TitleBlock, ColumnsBlock } from "../model";

const CA = /^component availability$/i;
const isRelated = (t: string) => /^related links$/i.test(t.trim());
const isRelatedExternal = (t: string) => /^related links\s*\(\s*external only\s*\)$/i.test(t.trim());
const marker = (word: string, id?: string): TextBlock => ({ type: "text", html: `<p>[${word}]</p>`, ...(id ? { id } : {}) } as TextBlock);
const level = (s: Section) => s.titleLevel ?? "h2";
const isSub = (s: Section) => level(s) === "h3" || level(s) === "h4";

/** Component availability: from its own section into the parent section, with the heading inside the first text. */
function inlineAvailability(sections: Section[]): Section[] {
  const out: Section[] = [];
  for (const s of sections) {
    const top = [...out].reverse().find(x => !isSub(x));
    if (!CA.test(s.title.trim()) || s.noTitle || !top) { out.push(s); continue; }
    const heading = `<h3>${s.title.trim()}</h3>`;
    let blocks: Block[] = s.blocks.map(b => ({ ...b }));
    const first = blocks[0];
    if (first?.type === "text") blocks[0] = { ...first, html: `${heading}${first.html}` };
    else blocks = [{ type: "text", html: heading } as TextBlock, ...blocks];
    const tables = blocks.map((b, i) => (b.type === "table" ? i : -1)).filter(i => i >= 0);
    if (tables.length === 2) {
      // From the back, so the earlier positions stay valid.
      blocks.splice(tables[1] + 1, 0, marker("/external_only"));
      blocks.splice(tables[1], 0, marker("external_only"));
      blocks.splice(tables[0] + 1, 0, marker("/internal_only"));
      blocks.splice(tables[0], 0, marker("internal_only"));
    }
    const sid = (top as any).id as string | undefined;
    if (sid) blocks.forEach((b, i) => { (b as any).id ??= `${sid}a${i}`; });
    top.blocks = [...top.blocks, ...blocks];
  }
  return out;
}

/** Links in Related Links are plain underlined links, as on the reference page: the link text is wrapped in <u>. Idempotent. */
export const underlineLinks = (html: string): string =>
  html.replace(/<a\b([^>]*)>(?!\s*<u>)([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => `<a${attrs}><u>${inner}</u></a>`);

/** The page puts an arrow after a link that stands ALONE in its paragraph. On the reference page consecutive links share
 *  one paragraph, separated by line breaks, and have no arrow; a single link keeps its arrow. So here:
 *  - two or more link-only paragraphs in a row become one paragraph with <br> between the links,
 *  - a short plain line (up to 4 words) in front of links is a group label and is bold ("Components", "SAPUI5").
 *  Text that is not made of plain paragraphs (lists, other tags) is left as it is. Idempotent. */
export function linkParagraphs(html: string): string {
  const paras = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => m[1].replace(/(?:\s|&nbsp;|\u00a0)+$/g, "").replace(/^(?:\s|&nbsp;|\u00a0)+/g, ""));
  if (!paras.length || html.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, "").trim() !== "") return html;
  const linkOnly = (p: string) => /^<a\b[^>]*>(?:<u>)?[^<]*(?:<\/u>)?<\/a>$/i.test(p);
  const startsWithLink = (p: string | undefined) => !!p && /^<a\b/i.test(p);
  const out: string[] = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (linkOnly(p)) {
      const run = [p];
      while (i + 1 < paras.length && linkOnly(paras[i + 1])) run.push(paras[++i]);
      out.push(`<p>${run.join("<br>")}</p>`);
    } else if (p && !/[<>]/.test(p) && p.split(/\s+/).length <= 4 && startsWithLink(paras[i + 1])) out.push(`<p><strong>${p}</strong></p>`);
    else out.push(`<p>${p}</p>`);
  }
  return out.join("");
}
const linksHtml = (html: string) => linkParagraphs(underlineLinks(html));
const underlineBlock = (b: Block): Block => (b.type === "text" ? { ...b, html: linksHtml(b.html) } : b);

/** The sub-sections of a links group become the columns: first, second, and the rest stacked in the third. */
function linksColumns(subs: Section[], idBase?: string): ColumnsBlock {
  const cols: Block[][] = subs.length <= 3 ? subs.map(() => []) : [[], [], []];
  subs.forEach((s, i) => {
    const col = cols[Math.min(i, cols.length - 1)];
    col.push({ type: "title", level: 4, text: s.title.trim() } as TitleBlock, ...s.blocks.map(b => ({ ...b })));
  });
  const block = { type: "columns", columnCount: cols.length, columns: cols } as ColumnsBlock;
  if (idBase) {
    (block as any).id = idBase;
    cols.forEach((c, ci) => c.forEach((b, bi) => { (b as any).id ??= `${idBase}c${ci}b${bi}`; }));
  }
  return block;
}

function relatedLinks(sections: Section[]): Section[] {
  const out: Section[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (!isRelated(s.title) || s.noTitle) { out.push(s); continue; }
    // This section, then its sub-sections; then an external-only section with its sub-sections.
    const takeSubs = (from: number) => { const subs: Section[] = []; let j = from; while (j < sections.length && isSub(sections[j])) subs.push(sections[j++]); return { subs, next: j }; };
    const internal = takeSubs(i + 1);
    let next = internal.next, ext: Section | undefined, extSubs: Section[] = [];
    if (sections[next] && isRelatedExternal(sections[next].title)) { ext = sections[next]; const t = takeSubs(next + 1); extSubs = t.subs; next = t.next; }
    const alreadyColumns = s.blocks.some(b => b.type === "columns");
    if (alreadyColumns || (!internal.subs.length && !extSubs.length)) { out.push(s); continue; }
    const sid = (s as any).id as string | undefined;
    const blocks: Block[] = [...s.blocks];
    const both = internal.subs.length > 0 && extSubs.length > 0;
    let n = 0; const id = () => (sid ? `${sid}r${n++}` : undefined);
    if (internal.subs.length) {
      if (both) blocks.push(marker("internal_only", id()));
      blocks.push(linksColumns(internal.subs, id()));
      if (both) blocks.push(marker("/internal_only", id()));
    }
    if (extSubs.length) {
      if (both) blocks.push(marker("external_only", id()));
      blocks.push(linksColumns(extSubs, id()));
      if (both) blocks.push(marker("/external_only", id()));
    }
    // The own blocks of an external-only section (if it had any) are kept after the links.
    if (ext?.blocks.length) blocks.push(...ext.blocks);
    out.push({ ...s, blocks });
    i = next - 1;
  }
  return out;
}

/** How the links of Related Links are written into AEM. Only for AEM: the arrow after a link is AEM's own style, so the
 *  article on GitHub and in the editor keeps its plain links. Changes the given model in place and returns it. */
export function presentForAem(m: GuidelineModel): GuidelineModel {
  for (const s of m.sections) {
    if (!isRelated(s.title)) continue;
    for (const b of s.blocks) if (b.type === "columns") b.columns.forEach(col => col.forEach((x, i) => { col[i] = underlineBlock(x); }));
  }
  return m;
}

export function normalizeToReference(m: GuidelineModel): GuidelineModel {
  const copy: GuidelineModel = { ...m, sections: m.sections.map(s => ({ ...s, blocks: [...s.blocks] })) };
  copy.sections = relatedLinks(inlineAvailability(copy.sections));
  return copy;
}

/** What is not yet in the reference layout. Used by the check. */
export function referenceProblems(m: GuidelineModel): { rule: string; where: string; message: string }[] {
  const out: { rule: string; where: string; message: string }[] = [];
  for (const s of m.sections) {
    if (CA.test(s.title.trim())) out.push({ rule: "component-availability-layout", where: s.title,
      message: "Component availability is its own section. In the reference it is an inline heading inside the Intro section, followed by its table (and info box)." });
    if (isRelatedExternal(s.title)) out.push({ rule: "related-links-layout", where: s.title,
      message: "\"Related Links (external only)\" is its own section. In the reference there is one Related Links section with an [external_only] block inside." });
  }
  const rl = m.sections.find(s => isRelated(s.title));
  if (rl) {
    const hasSubs = isSub(m.sections[m.sections.indexOf(rl) + 1] ?? ({ titleLevel: "h2" } as Section));
    if (hasSubs) out.push({ rule: "related-links-layout", where: rl.title,
      message: "Related Links has sub-sections (Guidelines, Implementation, …). In the reference these are the columns of one columns block, with titles inside." });
    if (!hasSubs && !rl.blocks.some(b => b.type === "columns"))
      out.push({ rule: "related-links-layout", where: rl.title, message: "Related Links has no columns block. In the reference the links sit in a columns block." });
    const texts = rl.blocks.filter((b): b is TextBlock => b.type === "text").map(b => b.html.replace(/<[^>]+>/g, "").trim());
    const cols = rl.blocks.filter(b => b.type === "columns").length;
    const has = (w: string) => texts.includes(w);
    if (cols >= 2 && !(has("[internal_only]") && has("[/internal_only]") && has("[external_only]") && has("[/external_only]")))
      out.push({ rule: "related-links-layout", where: rl.title, message: "Related Links has two sets of links but not the marker lines [internal_only] [/internal_only] [external_only] [/external_only]." });
  }
  return out;
}
