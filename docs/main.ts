// Guideline Studio - the editor page (test build, runs on this computer only).
// It reuses the rule audit and the content model of this repo. guideline.json stays the one true copy.
import type { GuidelineModel, Block, ImageBlock } from "../src/model";
import { auditModel, type Finding, type Rules } from "../src/export/ruleAudit";
import { imageFile, renderGuidelineMd } from "../src/export/mdRender";
import * as gh from "./gh";

type Kind = "html" | "inline" | "plain";
interface Field { key: string; kind: Kind; label: string; section: string; where: string; get(): string; set(v: string): void }
interface Sug { id: string; key: string; label: string; section: string; old: string; new: string; author: string; time: string; status: "open" | "accepted" | "rejected"; by?: string; byTime?: string }
interface Hist { key: string; label: string; section: string; old: string; new: string; author: string; time: string; kind: "edit" | "suggestion" | "fix" | "restore" | "image"; acceptedBy?: string }
interface Sign { role: string; name: string; action: string; time: string }
interface State { status?: "draft" | "review" | "changes" | "ready" | "shipped"; jira?: string; signoffs?: Sign[]; pr?: { number: number; url: string } }

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const h = (tag: string, cls = "", text = ""): HTMLElement => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const store = { get: (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };
const now = () => new Date().toISOString();
const when = (t: string) => new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const uid = () => Math.random().toString(36).slice(2, 10);

// Where this update lives on GitHub. "main" until the first save creates update/<slug>.
let branch = gh.MAIN, docRef: any = {}, dirty = false;
// New or changed pictures, not yet committed. Path -> base64 for the commit, plus a local preview URL.
const pending = new Map<string, { b64: string; url: string }>();
let slug = "", model: GuidelineModel, baseline: GuidelineModel | null = null, rules: Rules;
let review: { suggestions: Sug[]; history: Hist[]; state: State } = { suggestions: [], history: [], state: {} };
let F = new Map<string, Field>(), findings: Finding[] = [], tab = store.get("tab") || "checks", selKey = "", before = "", imgBust = Date.now();

// ---------- ids and fields ----------
// First time: ids come from the position, so the last committed version gets the same ids. Later blocks keep their id.
function assignIds(m: GuidelineModel) {
  const walk = (bs: Block[], p: string) => bs.forEach((b: any, i) => { b.id ??= `${p}b${i}`; if (b.type === "columns") b.columns.forEach((c: Block[], ci: number) => walk(c, `${b.id}c${ci}`)); });
  m.sections.forEach((s: any, i) => { s.id ??= `s${i}`; walk(s.blocks, s.id); });
}
const LABEL: Record<string, string> = { text: "Text", info: "Info box", "message-strip": "Message strip", table: "Table", "when-to-use": "Do / Don't", image: "Image" };
function collect(m: GuidelineModel): Map<string, Field> {
  const out = new Map<string, Field>(); let parent = "";
  const add = (key: string, kind: Kind, label: string, section: string, where: string, get: () => string, set: (v: string) => void) => out.set(key, { key, kind, label, section, where, get, set });
  // "page title", not "page": page-wide findings (section order, link versions) must not mark the title.
  add("page:title", "plain", "Page title", "Page", "page title",() => m.pageTitle ?? m.component, (v) => { m.pageTitle = v; });
  for (const s of m.sections as any[]) {
    if (!s.noTitle && s.titleLevel !== "h3" && s.titleLevel !== "h4") parent = s.title;
    const path = s.noTitle || parent === s.title ? s.title : `${parent} > ${s.title}`;
    if (!s.noTitle) add(`${s.id}:title`, "plain", "Heading", path, `${path} > heading`, () => s.title, (v) => { s.title = v; });
    let n = 0;
    const visit = (b: any, prefix: string) => {
      const where = `${path} > ${prefix}block ${++n} (${b.type})`; const L = LABEL[b.type] ?? b.type;
      switch (b.type) {
        case "text": case "info": case "message-strip": add(`${b.id}:html`, "html", L, path, where, () => b.html, (v) => { b.html = v; }); break;
        case "image":
          add(`${b.id}:caption`, "plain", "Image caption", path, where, () => b.caption ?? "", (v) => { b.caption = v; });
          add(`${b.id}:alt`, "plain", "Image alt text", path, where, () => b.alt ?? "", (v) => { b.alt = v; }); break;
        case "table": b.rows.forEach((r: string[], ri: number) => r.forEach((_c, ci) => add(`${b.id}:rows.${ri}.${ci}`, "inline", `Table row ${ri + 1}, column ${ci + 1}`, path, where, () => b.rows[ri][ci], (v) => { b.rows[ri][ci] = v; }))); break;
        case "when-to-use": b.items.forEach((it: any, i: number) => add(`${b.id}:items.${i}`, "html", it.doOrDont === "do" ? "Do" : "Don't", path, where, () => it.html, (v) => { it.html = v; })); break;
        case "columns": b.columns.forEach((col: Block[]) => col.forEach((c) => visit(c, "column > "))); break;
      }
    };
    s.blocks.forEach((b: Block) => visit(b, ""));
  }
  return out;
}

// ---------- safe HTML in and out ----------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const BLOCK = new Set(["p", "div", "ul", "ol"]);
// Keeps only the tags a guideline uses. All other tags, styles and scripts are dropped.
function clean(html: string, inline = false): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = (n: Node): string => {
    if (n.nodeType === 3) return esc((n.nodeValue ?? "").replace(/\u00a0/g, " "));
    if (n.nodeType !== 1) return "";
    const el = n as Element, tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style") return "";
    const inner = [...el.childNodes].map(out).join("");
    switch (tag) {
      case "b": case "strong": return inner.trim() ? `<strong>${inner}</strong>` : inner;
      case "i": case "em": return inner.trim() ? `<em>${inner}</em>` : inner;
      case "a": { const href = el.getAttribute("href") ?? ""; return /^(https?:\/\/|mailto:)/i.test(href) && inner.trim() ? `<a href="${esc(href).replace(/"/g, "&quot;")}">${inner}</a>` : inner; }
      case "br": return "<br>";
      case "p": case "div": return inline ? inner : inner.replace(/<br>/g, "").trim() ? `<p>${inner}</p>` : "";
      case "ul": case "ol": return inline ? inner : `<${tag}>${inner}</${tag}>`;
      case "li": return inline ? `${inner} ` : `<li>${inner}</li>`;
      default: return inner;
    }
  };
  let r = "", run = "";
  const flush = () => { if (run.replace(/<br>/g, "").trim()) r += inline ? run : `<p>${run.trim()}</p>`; run = ""; };
  for (const n of doc.body.childNodes) { if (n.nodeType === 1 && BLOCK.has((n as Element).tagName.toLowerCase()) && !inline) { flush(); r += out(n); } else run += out(n); }
  flush();
  return r.replace(/(<br>)+<\/(p|li)>/g, "</$2>").replace(/<p>\s+/g, "<p>").trim();
}
function toText(v: string, kind: Kind): string {
  if (kind === "plain") return v;
  const doc = new DOMParser().parseFromString(`<body>${v}</body>`, "text/html");
  doc.body.querySelectorAll("li").forEach((li) => { li.prepend("• "); li.append("\n"); });
  doc.body.querySelectorAll("p").forEach((p) => p.append("\n"));
  doc.body.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  return (doc.body.textContent ?? "").replace(/\n+$/, "");
}
const serialize = (el: HTMLElement, kind: Kind) => kind === "plain" ? (el.textContent ?? "").replace(/\s+/g, " ").trim() : clean(el.innerHTML, kind === "inline");

// Word diff: old words struck through, new words marked.
function diffNode(a: string, b: string): DocumentFragment {
  const A = a.split(/(\s+)/).filter(Boolean), B = b.split(/(\s+)/).filter(Boolean), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const f = document.createDocumentFragment(); let i = 0, j = 0;
  const put = (tag: string, t: string) => { const last = f.lastChild as HTMLElement | null; if (tag && last?.nodeName.toLowerCase() === tag) last.textContent += t; else if (!tag && last?.nodeType === 3) last.nodeValue += t; else f.append(tag ? h(tag, "", t) : document.createTextNode(t)); };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { put("", A[i]); i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) put("ins", B[j++]);
    else put("del", A[i++]);
  }
  return f;
}

// ---------- the article ----------
const locked = () => review.state.status === "shipped";
const openSug = (key: string) => review.suggestions.find((s) => s.key === key && s.status === "open");
function fieldEl(key: string, tag: string, ph = ""): HTMLElement {
  const f = F.get(key)!; const sug = openSug(key);
  const el = h(tag); el.dataset.key = key; el.dataset.tag = tag; el.dataset.ph = ph;
  if (sug) {
    el.classList.add("sug");
    const t = h("div", "txt"); t.append(diffNode(toText(sug.old, f.kind), toText(sug.new, f.kind)));
    const meta = h("div", "meta"); meta.append(h("span", "", `Suggested by ${sug.author} · ${when(sug.time)}`));
    const ok = h("button", "small ok", "Accept"); ok.dataset.act = "accept"; ok.dataset.id = sug.id;
    const no = h("button", "small", "Reject"); no.dataset.act = "reject"; no.dataset.id = sug.id;
    meta.append(ok, no); el.append(t, meta); return el;
  }
  if (f.kind === "plain") el.textContent = f.get(); else el.innerHTML = clean(f.get(), f.kind === "inline");
  if (!locked()) { el.contentEditable = "true"; el.spellcheck = true; }
  el.classList.toggle("empty", !f.get().trim());
  return el;
}
const imgSrc = (b: ImageBlock) => { const p = `content/${slug}/${imageFile(b)}`; return pending.get(p)?.url ?? `${gh.rawBase(branch)}/${p}?t=${imgBust}`; };
// Template parts follow the approved AEM template (design-system-portal_* blocks) and the Figma "Guideline Template" frame.
const icon = (name: string, w: number, hgt: number, cls = "") => { const i = h("img", cls) as HTMLImageElement; i.src = `./assets/${name}.svg`; i.width = w; i.height = hgt; i.alt = ""; return i; };
const INFO_TITLE: Record<string, string> = { toptip: "Top Tips", information: "Information", warning: "Warning", guideline: "Guideline", hint: "Hint", changes: "Changes" };
// AEM table badge token, for example ":badge, info, large, _, SAPUI5:". Shown as the template's Tag, not as text.
function badgeEl(raw: string): HTMLElement | null {
  const m = raw.replace(/<[^>]+>/g, "").trim().match(/^:badge,([^:]*):$/); if (!m) return null;
  const parts = m[1].split(",").map((x) => x.trim()); const label = parts[parts.length - 1];
  const kind = /sapui5/i.test(label) ? "blue" : /figma/i.test(label) ? "white" : "grey";
  const t = h("span", `tag ${kind}`, label); t.title = "Library tag (fixed by the template)"; return t;
}
function blockEl(b: any): HTMLElement {
  switch (b.type) {
    case "text": { const w = h("div", "txt"); w.append(fieldEl(`${b.id}:html`, "div", "Write text")); return w; }
    case "message-strip": {
      const w = h("div", `ms ${b.style}`); w.append(icon("info", 16, 16, "ms-icon"), fieldEl(`${b.id}:html`, "div"), icon("close", 16, 16, "ms-close")); return w;
    }
    case "info": {
      const w = h("div", `guidance ${b.infoClass}`); const ib = h("div", "gd-icon"); ib.append(icon("lightbulb", 48, 48)); w.append(ib, h("div", "gd-title", INFO_TITLE[b.infoClass] ?? b.infoClass), fieldEl(`${b.id}:html`, "div")); return w;
    }
    case "when-to-use": {
      const w = h("div", "dodont"); b.items.forEach((it: any, i: number) => { const c = h("div", `dd ${it.doOrDont}`); c.append(h("div", "dd-title", it.doOrDont === "do" ? "Do" : "Don’t"), fieldEl(`${b.id}:items.${i}`, "div")); w.append(c); }); return w;
    }
    case "table": {
      const wrap = h("div", "tbl"); const t = h("table");
      b.rows.forEach((r: string[], ri: number) => { const tr = h("tr", ri === 0 ? "head" : ""); r.forEach((c, ci) => { const badge = ri > 0 ? badgeEl(c) : null; if (badge) { const td = h("td"); td.append(badge); tr.append(td); } else tr.append(fieldEl(`${b.id}:rows.${ri}.${ci}`, ri === 0 ? "th" : "td")); }); t.append(tr); });
      wrap.append(t); return wrap;
    }
    case "columns": { const w = h("div", "cols"); w.style.gridTemplateColumns = `repeat(${b.columnCount}, minmax(0, 1fr))`; b.columns.forEach((col: Block[]) => { const c = h("div", "col"); col.forEach((x) => c.append(blockEl(x))); w.append(c); }); return w; }
    case "image": {
      const fig = h("figure", `img ${b.variant}`); const box = h("div", "imgbox"); box.dataset.img = b.id;
      const img = h("img") as HTMLImageElement; img.src = imgSrc(b); img.alt = b.alt ?? ""; img.loading = "lazy"; box.append(img);
      const alt = h("div", "alt editonly"); alt.append(h("b", "", "ALT"), fieldEl(`${b.id}:alt`, "span", "Add the alt text"));
      fig.append(box, fieldEl(`${b.id}:caption`, "figcaption", "Add a caption"), alt); return fig;
    }
    case "title": return h(`h${Math.min(4, Math.max(2, b.level))}`, "", b.text);
    default: return h("div");
  }
}
const versionOf = (m: GuidelineModel): string => { let v = ""; const walk = (bs: any[]) => bs.forEach((b) => { if (!v && b.type === "image") v = b.figmaName?.match(/_v(\d+\.\d+)$/)?.[1] ?? ""; if (b.type === "columns") b.columns.forEach(walk); }); m.sections.forEach((s) => walk(s.blocks)); return v; };
function renderPage() {
  const y = window.scrollY;
  // Hero (Figma "Hero"): breadcrumb, article name, version button, anvil pattern.
  const hero = $("#hero"); hero.replaceChildren();
  const bc = h("div", "breadcrumb"); bc.append(h("span", "", "Home"), h("span", "", "/"), h("span", "", "Components"), h("span", "", "/"), h("span", "", model.pageTitle ?? model.component));
  const ver = h("div", "version"); ver.append(h("span", "", `Version ${versionOf(model) || "—"}`), icon("arrow-down", 16, 16));
  hero.append(icon("anvil-grid", 555, 172, "anvil"), bc, fieldEl("page:title", "h1"), ver);
  // Content sections: one AEM section per H2, H3 sub-sections inside, a divider line between sections.
  const content = $("#content"); content.replaceChildren();
  const nav = $("#onpage-list"); nav.replaceChildren();
  let body: HTMLElement | null = null, first = true;
  for (const s of model.sections as any[]) {
    if (s.noTitle) { s.blocks.forEach((b: Block) => content.append(blockEl(b))); continue; }
    if (s.titleLevel === "h3" || s.titleLevel === "h4") {
      if (!body) { const sec = h("section", "sec"); body = h("div", "sec-body"); sec.append(body); content.append(sec); }
      const sub = h("div", `sub ${s.titleLevel}`); sub.append(fieldEl(`${s.id}:title`, s.titleLevel, "Heading")); s.blocks.forEach((b: Block) => sub.append(blockEl(b))); body.append(sub);
      continue;
    }
    if (!first) content.append(h("hr", "sep")); first = false;
    const sec = h("section", "sec"); sec.id = `sec-${s.id}`; sec.dataset.sid = s.id;
    sec.append(fieldEl(`${s.id}:title`, "h2", "Heading")); body = h("div", "sec-body"); sec.append(body);
    s.blocks.forEach((b: Block) => body!.append(blockEl(b)));
    content.append(sec);
    const a = h("a", "op-item", s.title) as HTMLAnchorElement; a.href = `#sec-${s.id}`; a.dataset.sid = s.id; nav.append(a);
  }
  window.scrollTo(0, y); flag(); spy();
}
// "On this page": the item of the section in view is blue with the indicator line.
function spy() {
  const items = [...document.querySelectorAll<HTMLElement>("#onpage-list .op-item")]; if (!items.length) return;
  let cur = items[0].dataset.sid;
  for (const it of items) { const s = document.getElementById(`sec-${it.dataset.sid}`); if (s && s.getBoundingClientRect().top < 140) cur = it.dataset.sid; }
  items.forEach((it) => it.classList.toggle("on", it.dataset.sid === cur));
}
window.addEventListener("scroll", spy, { passive: true });
function refreshField(key: string) {
  const old = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`); if (!old) return renderPage();
  old.replaceWith(fieldEl(key, old.dataset.tag!, old.dataset.ph)); flag();
}
function flag() {
  const worst = new Map<string, string>();
  for (const f of findings) if (f.severity !== "info") for (const [k, fl] of F) if (fl.where === f.where && worst.get(k) !== "error") worst.set(k, f.severity);
  document.querySelectorAll<HTMLElement>("#page [data-key]").forEach((el) => { el.classList.remove("flag-error", "flag-warning", "sel"); const w = worst.get(el.dataset.key!); if (w) el.classList.add(`flag-${w}`); if (el.dataset.key === selKey) el.classList.add("sel"); });
}
function jump(key: string) {
  const el = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`); if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}
const keysAt = (f: Finding): string[] => {
  const exact = [...F.values()].filter((x) => x.where === f.where).map((x) => x.key); if (exact.length) return exact;
  const sec = (model.sections as any[]).find((s) => s.title === f.where); return sec && !sec.noTitle ? [`${sec.id}:title`] : [];
};

// ---------- changes ----------
const me = () => ($<HTMLInputElement>("#name").value.trim() || "Someone");
const suggesting = () => $<HTMLInputElement>("#suggest").checked;
function log(f: Field, old: string, val: string, kind: Hist["kind"], author = me(), acceptedBy?: string) {
  review.history.push({ key: f.key, label: f.label, section: f.section, old, new: val, author, time: now(), kind, ...(acceptedBy ? { acceptedBy } : {}) });
}
function commit(key: string, val: string, kind: Hist["kind"] = "edit") {
  const f = F.get(key); if (!f || locked()) return; const old = f.get(); if (old === val) return refreshField(key);
  if (suggesting() && kind !== "restore") review.suggestions.push({ id: uid(), key, label: f.label, section: f.section, old, new: val, author: me(), time: now(), status: "open" });
  else { f.set(val); log(f, old, val, kind); }
  changed(key);
}
function changed(key?: string) {
  F = collect(model); findings = auditModel(model, rules);
  if (key) refreshField(key); else renderPage();
  renderSide(); renderBar(); save();
}
function decide(id: string, accept: boolean) {
  const s = review.suggestions.find((x) => x.id === id); if (!s || s.status !== "open") return;
  const f = F.get(s.key);
  if (accept && f) { const old = f.get(); f.set(s.new); log(f, old, s.new, "suggestion", s.author, me()); }
  s.status = accept ? "accepted" : "rejected"; s.by = me(); s.byTime = now();
  changed(s.key);
}
// Nothing goes to GitHub on each keystroke. A copy is kept in this browser, and "Save version" makes one commit.
function save() {
  dirty = true; store.set(`draft:${slug}`, JSON.stringify({ model, review }));
  $("#saved").textContent = "Changes not saved to GitHub yet";
  renderBar();
}
const stamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
// One commit on update/<slug> with the text, the Markdown, the review files and new pictures.
async function commitVersion(message: string): Promise<void> {
  docRef.model = model;
  const dir = `content/${slug}`;
  const files: { path: string; content?: string; base64?: string }[] = [
    { path: `${dir}/guideline.json`, content: JSON.stringify(docRef, null, 2) + "\n" },
    { path: `${dir}/guideline.md`, content: renderGuidelineMd(model, docRef.meta ?? {}) },
    { path: `${dir}/review/suggestions.json`, content: JSON.stringify(review.suggestions, null, 2) + "\n" },
    { path: `${dir}/review/history.json`, content: JSON.stringify(review.history, null, 2) + "\n" },
    { path: `${dir}/review/state.json`, content: JSON.stringify(review.state, null, 2) + "\n" },
  ];
  for (const [path, p] of pending) files.push({ path, base64: p.b64 });
  const r = await gh.commitFiles(slug, files, message);
  branch = r.branch; pending.clear(); dirty = false; store.set(`draft:${slug}`, "");
  imgBust = Date.now();
  $("#saved").textContent = `Saved to GitHub ${stamp()} · ${branch}`;
  renderBar();
}

// ---------- one-click fixes (safe ones only) ----------
function fixOf(f: Finding): ((v: string, kind: Kind) => string) | null {
  const onText = (kind: Kind, v: string, fn: (t: string) => string) => {
    if (kind === "plain") return fn(v);
    const doc = new DOMParser().parseFromString(`<body>${v}</body>`, "text/html"); const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) w.currentNode.nodeValue = fn(w.currentNode.nodeValue ?? "");
    return clean(doc.body.innerHTML, kind === "inline");
  };
  if (f.rule === "terminology") { const m = f.message.match(/^Use "(.+?)", not "(.+?)"/); if (!m) return null; const re = new RegExp(`\\b${m[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"); return (v, k) => onText(k, v, (t) => t.replace(re, (x) => (/^[A-Z]/.test(x) ? m[1][0].toUpperCase() + m[1].slice(1) : m[1]))); }
  if (f.rule === "heading-ampersand") return (v, k) => onText(k, v, (t) => t.replace(/\s*&\s*/g, " and "));
  if (f.rule === "heading-punctuation") return (v, k) => onText(k, v, (t) => t.replace(/[.:;,]+$/, ""));
  if (f.rule === "link-protocol") return (v) => v.replace(/href="http:\/\//g, 'href="https://');
  return null;
}
function applyFix(f: Finding) { const fx = fixOf(f); if (!fx) return; for (const k of keysAt(f)) { const fl = F.get(k)!; const v = fx(fl.get(), fl.kind); if (v !== fl.get()) commit(k, v, "fix"); } }

// ---------- side panel ----------
const errors = () => findings.filter((f) => f.severity === "error").length;
const opens = () => review.suggestions.filter((s) => s.status === "open");
function changesVsBaseline(): { f: Field; old: string }[] {
  if (!baseline) return []; const B = collect(baseline);
  return [...F.values()].filter((f) => B.has(f.key) && B.get(f.key)!.get() !== f.get()).map((f) => ({ f, old: B.get(f.key)!.get() }));
}
function card(top: (string | HTMLElement)[], body?: Node, key?: string): HTMLElement {
  const c = h("div", key ? "card click" : "card"); const t = h("div", "top"); t.append(...top); c.append(t);
  if (body) { const x = h("div", "txt"); x.append(body); c.append(x); }
  if (key) c.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest("button")) jump(key); });
  return c;
}
const btn = (text: string, fn: () => void, cls = "small") => { const b = h("button", cls, text) as HTMLButtonElement; b.addEventListener("click", fn); return b; };
function renderSide() {
  const ch = changesVsBaseline();
  const counts: Record<string, [number, boolean]> = { checks: [findings.filter((f) => f.severity !== "info").length, errors() > 0], changes: [ch.length + opens().length, false], history: [review.history.length, false], jira: [0, false] };
  document.querySelectorAll<HTMLElement>("#tabs button").forEach((b) => {
    const id = b.dataset.tab!; b.classList.toggle("on", id === tab); b.querySelector(".n")?.remove();
    if (counts[id][0]) b.append(h("span", counts[id][1] ? "n bad" : "n", String(counts[id][0])));
  });
  const db = $("#drawerBtn"); db.replaceChildren(document.createTextNode("Review panel"));
  if (errors()) db.append(h("span", "n bad", String(errors()))); else if (opens().length) db.append(h("span", "n", String(opens().length)));
  const p = $("#panel"); p.replaceChildren();
  if (tab === "checks") {
    const s = h("div", "sum"); s.append(h("strong", "", errors() ? `${errors()} to fix` : "No errors"), h("span", "muted", `${findings.filter((f) => f.severity === "warning").length} to look at · ${findings.filter((f) => f.severity === "info").length} notes`)); p.append(s);
    const order = { error: 0, warning: 1, info: 2 };
    for (const f of [...findings].sort((a, b) => order[a.severity] - order[b.severity])) {
      const keys = keysAt(f); const c = card([h("span", `sev ${f.severity}`, f.severity === "error" ? "Fix" : f.severity === "warning" ? "Look" : "Note"), f.where], document.createTextNode(f.message + (f.suggestion ? `\n→ ${f.suggestion}` : "")), keys[0]);
      if (fixOf(f) && keys.length && !locked()) { const r = h("div", "row"); r.append(btn(suggesting() ? "Suggest this fix" : "Fix", () => applyFix(f), "small primary")); c.append(r); }
      p.append(c);
    }
  }
  if (tab === "changes") {
    const s = h("div", "sum"); s.append(h("strong", "", `${ch.length} changed`), h("span", "muted", `${opens().length} open suggestions · compared with the last saved version in git`)); p.append(s);
    if (!baseline) p.append(h("p", "muted", "No earlier version to compare with."));
    if (opens().length) p.append(h("h5", "", "Open suggestions"));
    for (const sg of opens()) { const f = F.get(sg.key); const c = card([h("strong", "", sg.label), sg.section, `· ${sg.author}`], diffNode(toText(sg.old, f?.kind ?? "plain"), toText(sg.new, f?.kind ?? "plain")), sg.key); const r = h("div", "row"); r.append(btn("Accept", () => decide(sg.id, true), "small ok"), btn("Reject", () => decide(sg.id, false))); c.append(r); p.append(c); }
    if (opens().length > 1) p.append(btn("Accept all suggestions", () => opens().forEach((x) => decide(x.id, true)), "small ok"));
    if (ch.length) p.append(h("h5", "", "Changed in the article"));
    for (const { f, old } of ch) p.append(card([h("strong", "", f.label), f.section], diffNode(toText(old, f.kind), toText(f.get(), f.kind)), f.key));
    if (review.history.length) { p.append(h("h5", "", "Copy change report")); p.append(btn("Copy report as a table", () => navigator.clipboard?.writeText(report()).then(() => { $("#saved").textContent = "Report copied"; }))); }
  }
  if (tab === "history") {
    const list = review.history.filter((x) => !selKey || x.key === selKey).slice().reverse();
    const s = h("div", "sum"); s.append(h("strong", "", selKey ? `${F.get(selKey)?.label ?? "Block"} · ${F.get(selKey)?.section ?? ""}` : "All changes")); if (selKey) s.append(btn("Show all", () => { selKey = ""; flag(); renderSide(); })); p.append(s);
    if (!list.length) p.append(h("p", "muted", selKey ? "No changes to this text yet. Click another text, or Show all." : "No changes yet."));
    const W: Record<string, string> = { edit: "changed by", suggestion: "suggested by", fix: "check fix by", restore: "brought back by", image: "image replaced by" };
    for (const x of list) {
      const f = F.get(x.key); const body = x.kind === "image" ? document.createTextNode(x.old ? "A new picture was put in. The old picture is kept." : "A picture was added.") : diffNode(toText(x.old, f?.kind ?? "plain"), toText(x.new, f?.kind ?? "plain"));
      const c = card([h("strong", "", x.label), `${W[x.kind]} ${x.author}`, x.acceptedBy ? `· accepted by ${x.acceptedBy}` : "", `· ${when(x.time)}`], body, x.key);
      if (x.kind === "image" && x.old) { const a = h("a", "", "See the old picture") as HTMLAnchorElement; a.href = x.old; a.target = "_blank"; c.append(a); }
      else if (f && x.kind !== "image" && f.get() !== x.old && !locked()) { const r = h("div", "row"); r.append(btn("Bring this old wording back", () => { const cur = f.get(); f.set(x.old); log(f, cur, x.old, "restore"); changed(f.key); })); c.append(r); }
      p.append(c);
    }
  }
  if (tab === "jira") {
    const inp = h("input", "jirakey") as HTMLInputElement; inp.placeholder = "Jira key, for example FIORIDESIGN-17845"; inp.value = review.state.jira ?? "";
    inp.addEventListener("change", () => { review.state.jira = inp.value.trim().toUpperCase(); save(); renderSide(); });
    p.append(h("h5", "", "Jira task"), inp, h("h5", "", "Status card (one comment, always current)"), h("pre", "jira", statusCard()));
    p.append(h("h5", "", "Sign-off lines (one comment per click)"));
    const lines = (review.state.signoffs ?? []).map(signLine); p.append(h("pre", "jira", lines.length ? lines.join("\n") : "No sign-offs yet."));
    p.append(h("p", "muted", "Preview only. Jira is not connected yet. The GitHub pull request is the record for now."));
  }
}
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
function report(): string {
  const rows = review.history.filter((x) => x.kind !== "image").map((x) => { const k = F.get(x.key)?.kind ?? "plain"; return `| ${cell(x.section)} · ${x.label} | ${cell(toText(x.old, k))} | ${cell(toText(x.new, k))} | ${x.author} | ${x.acceptedBy ?? "-"} | ${when(x.time)} |`; });
  const rej = review.suggestions.filter((s) => s.status === "rejected").map((s) => { const k = F.get(s.key)?.kind ?? "plain"; return `| ${cell(s.section)} · ${s.label} | ${cell(toText(s.old, k))} | ~~${cell(toText(s.new, k))}~~ (rejected) | ${s.author} | rejected by ${s.by} | ${when(s.byTime ?? s.time)} |`; });
  return ["| Where | Old text | New text | Who | Accepted by | When |", "| --- | --- | --- | --- | --- | --- |", ...rows, ...rej].join("\n");
}
const title = () => model.pageTitle ?? model.component;
const lastSign = (role: string) => (review.state.signoffs ?? []).filter((s) => s.role === role).pop();
function statusCard(): string {
  const st = review.state.status ?? "draft", d = lastSign("designer"), w = lastSign("writer"), e = lastSign("editor");
  const ch = changesVsBaseline(); const acc = ch.some((c) => /^Accessibility/i.test(c.f.section)); const img = review.history.some((x) => x.kind === "image") || ch.some((c) => c.f.label.startsWith("Image"));
  const warn = findings.filter((f) => f.severity === "warning").length;
  return [
    `[GitHub] ${title()} · ${review.state.jira || "no Jira key yet"}`,
    `Designer       ${d && st !== "draft" ? `✅ ${d.name} · sent for review ${when(d.time)}` : "✏️ working"}`,
    `Checks         ${errors() ? `❌ ${errors()} to fix` : `✅ 0 errors · ${warn} hints`}`,
    `UX writer      ${w?.action === "approved" && (st === "ready" || st === "shipped") ? `✅ ${w.name} · ${when(w.time)}` : st === "changes" ? `↩ changes wanted by ${w?.name}` : st === "review" ? "⏳ asked" : "— not asked yet"}`,
    `Accessibility  ${acc ? "⏳ needed (section changed)" : "— not needed (section not changed)"}`,
    `Images         ${img ? "⏳ needed (images changed)" : "— not needed (images not changed)"}`,
    `Editor         ${st === "shipped" ? `🚀 ${e?.name} · ${when(e!.time)}` : st === "ready" ? "⏳ can approve and ship" : "⏳ waits for reviews"}`,
  ].join("\n");
}
function signLine(s: Sign): string {
  const acc = review.suggestions.filter((x) => x.status === "accepted").length, rej = review.suggestions.filter((x) => x.status === "rejected").length;
  if (s.action === "sent") return `[GitHub] 📨 Sent for review by ${s.name} · ${when(s.time)}`;
  if (s.action === "approved") return `[GitHub] ✅ UX copy approved by ${s.name} · ${acc + rej} text suggestions (${acc} accepted, ${rej} rejected) · ${when(s.time)}`;
  if (s.action === "changes") return `[GitHub] ↩ Changes wanted by ${s.name} · ${opens().length} open suggestions · ${when(s.time)}`;
  return `[GitHub] 🚀 Approved and shipped by ${s.name} · ${when(s.time)}`;
}

// ---------- top bar ----------
const STATUS: Record<string, string> = { draft: "Draft", review: "In review", changes: "Changes wanted", ready: "Ready for AEM", shipped: "Shipped" };
// Each click is a real step on GitHub: a commit, and for the review steps a pull request action.
async function sign(action: string, status: State["status"]) {
  if (!$<HTMLInputElement>("#name").value.trim()) { $("#name").focus(); $("#saved").textContent = "Type your name first"; return; }
  const who = me(), prevStatus = review.state.status, n0 = review.state.signoffs?.length ?? 0;
  try {
    (review.state.signoffs ??= []).push({ role: $<HTMLSelectElement>("#role").value, name: who, action, time: now() });
    review.state.status = status;
    if (action === "sent") {
      await commitVersion(`${title()}: sent for review by ${who}`);
      const pr = await gh.openPR(slug, `${title()} update${review.state.jira ? ` (${review.state.jira})` : ""}`,
        `Sent for review by ${who}.\n\nChecks: ${errors()} errors, ${findings.filter((f) => f.severity === "warning").length} warnings.\nOpen text suggestions: ${opens().length}.`);
      review.state.pr = pr;
      await commitVersion(`${title()}: pull request #${pr.number}`);
    } else {
      await commitVersion(`${title()}: ${action} by ${who}`);
      const n = review.state.pr?.number;
      if (n && action === "approved") await gh.review(n, "APPROVE", `UX copy approved by ${who}`);
      if (n && action === "changes") await gh.review(n, "REQUEST_CHANGES", `Changes wanted by ${who}`);
      if (n && action === "shipped") await gh.merge(n);
    }
  } catch (e) {
    review.state.signoffs = (review.state.signoffs ?? []).slice(0, n0); review.state.status = prevStatus;
    renderBar(); $("#saved").textContent = `Not done: ${(e as Error).message}`; return;
  }
  tab = "jira"; document.body.classList.add("drawer-open"); renderPage(); renderSide(); renderBar();
}
function renderBar() {
  const st = review.state.status ?? "draft", role = $<HTMLSelectElement>("#role").value;
  const pill = $("#status"); pill.textContent = STATUS[st]; pill.className = `pill ${st}`;
  const c = $<HTMLButtonElement>("#commit"); c.disabled = !dirty; c.textContent = branch === gh.MAIN ? "Save version (new update)" : "Save version";
  const a = $("#actions"); a.replaceChildren();
  const add = (text: string, fn: () => void, cls: string, off = "") => { const b = btn(text, fn, cls); if (off) { b.disabled = true; b.title = off; } a.append(b); };
  if (role === "designer" && (st === "draft" || st === "changes")) add("Send for review", () => sign("sent", "review"), "primary", errors() ? "Fix the errors in Checks first" : "");
  if (role === "writer" && st === "review") { add("Ask for changes", () => sign("changes", "changes"), ""); add("Approve", () => sign("approved", "ready"), "ok", opens().length ? "Accept or reject the open suggestions first" : ""); }
  if (role === "editor" && st === "ready") add("Approve and ship", () => sign("shipped", "shipped"), "primary", errors() ? "Fix the errors first" : "");
  if (st === "shipped") add("Start a new update", () => { review.state.status = "draft"; renderPage(); renderBar(); renderSide(); save(); }, "");
}

// ---------- events ----------
const page = $("#page");
page.addEventListener("focusin", (e) => { const el = (e.target as HTMLElement).closest<HTMLElement>("[data-key][contenteditable=true]"); if (!el) return; before = serialize(el, F.get(el.dataset.key!)!.kind); selKey = el.dataset.key!; flag(); if (tab === "history") renderSide(); });
page.addEventListener("focusout", (e) => { const el = (e.target as HTMLElement).closest<HTMLElement>("[data-key][contenteditable=true]"); if (!el) return; const f = F.get(el.dataset.key!)!; const after = serialize(el, f.kind); if (after !== before) commit(f.key, after); else el.classList.toggle("empty", !after); });
page.addEventListener("input", (e) => (e.target as HTMLElement).closest?.("[data-key]")?.classList.remove("empty"));
page.addEventListener("keydown", (e) => { const el = (e.target as HTMLElement).closest<HTMLElement>("[data-key][contenteditable=true]"); if (!el) return; if (e.key === "Escape") { el.blur(); } if (e.key === "Enter" && F.get(el.dataset.key!)!.kind !== "html") { e.preventDefault(); el.blur(); } });
page.addEventListener("paste", (e) => { if (!(e.target as HTMLElement).closest("[contenteditable=true]")) return; e.preventDefault(); document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? ""); });
page.addEventListener("click", (e) => {
  const t = e.target as HTMLElement; const act = t.closest<HTMLElement>("[data-act]"); if (act) return decide(act.dataset.id!, act.dataset.act === "accept");
  const a = t.closest("a"); if (a && t.closest("[contenteditable=true]")) e.preventDefault();
  const box = t.closest<HTMLElement>(".imgbox"); if (box && !locked()) { pickFor = box.dataset.img!; $<HTMLInputElement>("#file").click(); }
});
let pickFor = "";
const findImage = (id: string): ImageBlock | undefined => { let hit: any; const walk = (bs: any[]) => bs.forEach((b) => { if (b.id === id) hit = b; if (b.type === "columns") b.columns.forEach(walk); }); (model.sections as any[]).forEach((s) => walk(s.blocks)); return hit; };
async function upload(id: string, file: File | undefined) {
  const b = findImage(id); if (!b || !file) return;
  if (file.type !== "image/png") { $("#saved").textContent = "Use a PNG file"; return; }
  const name = imageFile(b).split("/").pop()!; const path = `content/${slug}/${imageFile(b)}`;
  // The old picture stays in git. The history keeps its link so it can be compared.
  const oldUrl = pending.get(path) ? "" : `${gh.rawBase(branch)}/${path}`;
  pending.set(path, { b64: gh.toBase64(await file.arrayBuffer()), url: URL.createObjectURL(file) });
  const f = F.get(`${id}:caption`)!; review.history.push({ key: `${id}:caption`, label: "Image", section: f.section, old: oldUrl, new: name, author: me(), time: now(), kind: "image" });
  changed();
}
$<HTMLInputElement>("#file").addEventListener("change", (e) => { const inp = e.target as HTMLInputElement; upload(pickFor, inp.files?.[0]); inp.value = ""; });
page.addEventListener("dragover", (e) => { const box = (e.target as HTMLElement).closest(".imgbox"); if (box) { e.preventDefault(); box.classList.add("drop"); } });
page.addEventListener("dragleave", (e) => (e.target as HTMLElement).closest(".imgbox")?.classList.remove("drop"));
page.addEventListener("drop", (e) => { const box = (e.target as HTMLElement).closest<HTMLElement>(".imgbox"); if (!box) return; e.preventDefault(); box.classList.remove("drop"); if (!locked()) upload(box.dataset.img!, e.dataTransfer?.files[0]); });

$("#tools").addEventListener("mousedown", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-cmd]"); if (!b) return; e.preventDefault();
  const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-key][contenteditable=true]"); if (!el) return;
  const kind = F.get(el.dataset.key!)!.kind; if (kind === "plain" || (kind === "inline" && b.dataset.cmd!.startsWith("insert"))) return;
  if (b.dataset.cmd === "link") { const url = window.prompt("Link address (https://…). Leave empty to remove the link."); if (url === null) return; if (!url.trim()) document.execCommand("unlink"); else if (/^https?:\/\//i.test(url.trim())) document.execCommand("createLink", false, url.trim()); }
  else document.execCommand(b.dataset.cmd!);
});
$("#drawerBtn").addEventListener("click", () => document.body.classList.toggle("drawer-open"));
$("#drawerClose").addEventListener("click", () => document.body.classList.remove("drawer-open"));
$("#hints").addEventListener("change", (e) => document.body.classList.toggle("no-hints", !(e.target as HTMLInputElement).checked));
$("#tabs").addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]"); if (!b) return; tab = b.dataset.tab!; store.set("tab", tab); renderSide(); });
$("#name").addEventListener("change", () => store.set("name", $<HTMLInputElement>("#name").value));
$("#role").addEventListener("change", () => { const r = $<HTMLSelectElement>("#role").value; store.set("role", r); $<HTMLInputElement>("#suggest").checked = r === "writer"; renderBar(); renderSide(); });
$("#suggest").addEventListener("change", renderSide);
$("#guideline").addEventListener("change", () => load($<HTMLSelectElement>("#guideline").value));

async function load(s: string) {
  slug = s; store.set("slug", s); selKey = ""; pending.clear();
  // "main" holds the last published version. An open update lives on update/<slug>.
  branch = (await gh.openUpdate(s)).branch;
  const doc = await gh.readJson<any>(`content/${s}/guideline.json`, branch, undefined as any);
  if (!doc) throw new Error(`No guideline.json for ${s}`);
  docRef = doc; model = doc.model;
  baseline = (await gh.readJson<any>(`content/${s}/guideline.json`, gh.MAIN, { model: null })).model ?? null;
  review = {
    suggestions: await gh.readJson(`content/${s}/review/suggestions.json`, branch, []),
    history: await gh.readJson(`content/${s}/review/history.json`, branch, []),
    state: await gh.readJson(`content/${s}/review/state.json`, branch, {}),
  };
  // A draft from an unsaved session in this browser comes back, so nothing is lost on reload.
  const draft = store.get(`draft:${s}`);
  let note = branch === gh.MAIN ? "No open update yet. Your first save creates one." : `Open update: ${branch}`;
  if (draft) { try { const d = JSON.parse(draft); model = d.model; review = d.review; dirty = true; note = "Unsaved draft from this browser restored"; } catch { /* bad draft: ignore */ } }
  else dirty = false;
  assignIds(model); if (baseline) assignIds(baseline);
  F = collect(model); findings = auditModel(model, rules);
  renderPage(); renderSide(); renderBar(); $("#saved").textContent = note;
}
(async () => {
  rules = (await gh.rules()) as Rules;
  const list: { slug: string; title: string }[] = await gh.listGuidelines();
  const tokenBox = $<HTMLInputElement>("#token"); tokenBox.placeholder = gh.getToken() ? "Token saved in this browser" : "Paste GitHub token";
  tokenBox.addEventListener("change", () => { gh.setToken(tokenBox.value); tokenBox.value = ""; tokenBox.placeholder = gh.getToken() ? "Token saved in this browser" : "Paste GitHub token"; renderBar(); });
  $("#commit").addEventListener("click", async () => { try { await commitVersion(`${title()}: saved by ${me()}`); } catch (e) { $("#saved").textContent = `Not saved: ${(e as Error).message}`; } });
  const sel = $<HTMLSelectElement>("#guideline"); list.forEach((g) => sel.add(new Option(g.title, g.slug)));
  $<HTMLInputElement>("#name").value = store.get("name");
  const role = store.get("role") || "designer"; $<HTMLSelectElement>("#role").value = role; $<HTMLInputElement>("#suggest").checked = role === "writer";
  const first = list.find((g) => g.slug === store.get("slug"))?.slug ?? list[0]?.slug; if (first) { sel.value = first; await load(first); }
})();
