// GitHub layer (new file, separate from the connector code).
// Turns the connector's own GuidelineModel (parsed from Figma by src/figma/parse.ts) into a readable
// Markdown file for GitHub review. The model stays the single source; the Markdown is a view of it.
import type { GuidelineModel, Section, Block, ImageBlock } from "../model";
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]);

export function htmlToMd(html: string): string {
  let h = html;
  h = h.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, u, t) => `[${t.replace(/<[^>]+>/g, "")}](${decode(u)})`);
  h = h.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (_m, _t: string, inner: string) => {
    const core = inner.trim();
    if (!core) return inner;
    return `${inner.match(/^\s*/)?.[0] ?? ""}**${core}**${inner.match(/\s*$/)?.[0] ?? ""}`;
  });
  h = h.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, "_$2_");
  // A line break inside a paragraph is written as a backslash at the end of the line.
  h = h.replace(/<br\s*\/?>/gi, "\\\n");
  h = h.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
    let n = 0;
    return "\n" + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, t: string) => `${++n}. ${t.trim()}\n`) + "\n";
  });
  h = h.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner: string) =>
    "\n" + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, t: string) => `- ${t.trim()}\n`) + "\n");
  h = h.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n").replace(/<\/?p[^>]*>/gi, "\n");
  h = h.replace(/<[^>]+>/g, "");
  // Canonical form: no spaces at the start or end of a line. The file is then stable when read back.
  return decode(h).split("\n").map((l) => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const cell = (s: string) => htmlToMd(s).replace(/\n+/g, " ").replace(/\|/g, "\\|");
export const imageFile = (b: ImageBlock) => `images/${slug(b.figmaName ?? b.ref)}.png`;

export function renderBlock(b: Block): string {
  switch (b.type) {
    case "text": return htmlToMd(b.html);
    case "title": return `${"#".repeat(Math.min(Math.max(b.level, 2), 6))} ${b.text}`;
    case "image": {
      if (!isGuidelineImage(b)) return "";
      const cap = b.caption ? `\nCaption: ${b.caption}` : "";
      return `![${(b.alt ?? "").replace(/[\[\]]/g, "")}](${imageFile(b)} "${b.figmaName ?? b.ref}")${cap}`;
    }
    case "table": {
      const [head, ...rows] = b.rows;
      if (!head) return "";
      return [`| ${head.map(cell).join(" | ")} |`, `|${" --- |".repeat(head.length)}`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
    }
    case "message-strip": return `::: message-strip ${b.style}\n${htmlToMd(b.html)}\n:::`;
    case "info": return `::: info ${b.infoClass}\n${htmlToMd(b.html)}\n:::`;
    case "columns":
      return `::: columns ${b.columnCount}\n${b.columns.map((col) => col.map(renderBlock).join("\n\n")).join("\n\n--- column ---\n\n")}\n:::`;
    case "when-to-use": return b.items.map((i) => `::: ${i.doOrDont}\n${htmlToMd(i.html)}\n:::`).join("\n\n");
    default: return `<!-- unsupported block -->`;
  }
}

const LEVEL = { h2: 2, h3: 3, h4: 4 } as const;
function renderSection(s: Section): string {
  const head = s.noTitle ? "" : `${"#".repeat(LEVEL[s.titleLevel ?? "h2"])} ${s.title}\n\n`;
  return head + s.blocks.map(renderBlock).filter(Boolean).join("\n\n");
}

export const imagesOf = (m: GuidelineModel): ImageBlock[] => {
  const out: ImageBlock[] = [];
  const walk = (bs: Block[]) => bs.forEach((b) => {
    if (b.type === "image") { if (isGuidelineImage(b)) out.push(b); }
    else if (b.type === "columns") b.columns.forEach(walk);
  });
  m.sections.forEach((s) => walk(s.blocks));
  return out;
};

export interface Meta { figmaUrl?: string; fileKey?: string; fetchedAt?: string }
export function renderGuidelineMd(m: GuidelineModel, meta: Meta = {}): string {
  const fm = { title: m.pageTitle ?? m.component, component: m.component, ...meta };
  const head = ["---", ...Object.entries(fm).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), "---", ""].join("\n");
  return head + "\n" + m.sections.map(renderSection).join("\n\n") + "\n";
}

// ---- Clean-up for export (added after the first real run) ----

// Section key: lower case, "&" and "and" count the same, spaces collapsed.
const sectionKey = (t: string) => t.replace(/&/g, " and ").replace(/\s+/g, " ").trim().toLowerCase();

// One key per section that includes its parent: "related links/guidelines" and
// "related links (external only)/guidelines" are DIFFERENT sections. A sub-section (h3/h4) belongs to
// the last top-level section before it.
export function pathKeys(sections: Section[]): string[] {
  let parent = "";
  return sections.map((s) => {
    if (s.noTitle) return `__${s.title}`;
    const k = sectionKey(s.title);
    if (s.titleLevel === "h3" || s.titleLevel === "h4") return `${parent}/${k}`;
    parent = k;
    return k;
  });
}

// The Figma parser can give the same section twice (once from the frame name, once from the heading
// text). Merge the copies: keep every block once, in order. Nothing is dropped. The heading text
// (the copy that has a heading level) wins as the title.
export function mergeDuplicateSections(m: GuidelineModel): { model: GuidelineModel; merged: string[] } {
  const keys = pathKeys(m.sections);
  const byKey = new Map<string, Section>();
  const out: Section[] = [];
  const merged: string[] = [];
  m.sections.forEach((s, i) => {
    const first = byKey.get(keys[i]);
    if (!first) { const copy = { ...s, blocks: [...s.blocks] }; byKey.set(keys[i], copy); out.push(copy); return; }
    merged.push(s.title);
    const have = new Set(first.blocks.map((b) => JSON.stringify(b)));
    for (const b of s.blocks) if (!have.has(JSON.stringify(b))) first.blocks.push(b);
    if (!first.titleLevel && s.titleLevel) { first.titleLevel = s.titleLevel; first.title = s.title; }
  });
  return { model: { ...m, sections: out }, merged };
}

// Page decoration (icons, separator lines) is not guideline content. Remove it from the model.
export function stripDecorationImages(m: GuidelineModel): GuidelineModel {
  // A columns block that held only decoration is removed too, so no empty layout block is left.
  const clean = (bs: Block[]): Block[] => bs.filter((b) => b.type !== "image" || isGuidelineImage(b))
    .map((b) => (b.type === "columns" ? { ...b, columns: b.columns.map(clean) } : b))
    .filter((b) => b.type !== "columns" || b.columns.some((c) => c.length > 0));
  return { ...m, sections: m.sections.map((s) => ({ ...s, blocks: clean(s.blocks) })) };
}

// A real guideline image is named NN_Name_Section_vX.XXX. Page decoration (components.png, sep-line.png) is not.
export const isGuidelineImage = (b: ImageBlock) => /^\d{2}_/.test(b.figmaName ?? "");
