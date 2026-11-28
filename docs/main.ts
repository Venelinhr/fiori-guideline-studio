// Guideline Studio - the editor page (test build, runs on this computer only).
// It reuses the rule audit and the content model of this repo. guideline.json stays the one true copy.
import type { GuidelineModel, Block, ImageBlock } from "../src/model";
import { auditModel, type Finding, type Rules } from "../src/export/ruleAudit";
import { imageFile, renderGuidelineMd } from "../src/export/mdRender";
import * as gh from "./gh";
import { patternFindings } from "../checks/rules";

type Kind = "html" | "inline" | "plain";
interface Field { key: string; kind: Kind; label: string; section: string; where: string; get(): string; set(v: string): void }
interface Sug { id: string; key: string; label: string; section: string; old: string; new: string; author: string; time: string; status: "open" | "accepted" | "rejected"; by?: string; byTime?: string }
interface Hist { key: string; label: string; section: string; old: string; new: string; author: string; time: string; kind: "edit" | "suggestion" | "fix" | "restore" | "image"; acceptedBy?: string }
interface Sign { role: string; name: string; action: string; time: string }
type Stage = "draft" | "writer" | "designer" | "editor" | "approved" | "uploaded";
interface State { dismissed?: { by: string; role: string; time: string }; aiDone?: string[]; status?: Stage; lastCheck?: { by: string; role: string; time: string; errors: number; hints: number; fixes: number; copilot: string; skipped?: boolean; ai?: { errors: number; hints: number; model: string; time: string } }; jira?: string; signoffs?: Sign[]; pr?: { number: number; url: string } }

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const h = (tag: string, cls = "", text = ""): HTMLElement => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const store = { get: (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };
const now = () => new Date().toISOString();
const when = (t: string) => new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const uid = () => Math.random().toString(36).slice(2, 10);

// Where this update lives on GitHub. "main" until the first save creates update/<slug>.
let branch = gh.MAIN, version = "", docRef: any = {}, dirty = false;
// Link to the last saved change on this branch. It is kept after a reload.
let lastCommitUrl = "";
// Result of the final check (rules and writing patterns) that GitHub runs after the editor approves.
let finalCheck: gh.CheckResult | null = null, finalTimer = 0;
// AI check (Claude) in the background: the report the GitHub Action saved on the version branch.
interface AiFinding { where: string; severity: "error" | "hint"; problem: string; original: string; fix: string }
interface AiReport { time: string; model: string; errors: number; hints: number; dropped?: number; findings: AiFinding[] }
let aiReport: AiReport | null = null, aiTimer = 0;
let aiState: { phase: "none" | "running" | "done" | "failed"; msg?: string; url?: string } = { phase: "none" };
type LastCheck = NonNullable<State["lastCheck"]>;
const lcErr = (lc: LastCheck) => lc.errors + (lc.ai?.errors ?? 0);
const lcHints = (lc: LastCheck) => lc.hints + (lc.ai?.hints ?? 0);
const aiKey = (f: AiFinding) => `${f.original}→${f.fix}`;
async function refreshFinalCheck(): Promise<void> {
  try { finalCheck = await gh.finalCheck(slug); } catch (e) { finalCheck = { state: "error", description: (e as Error).message }; }
  renderBar(); if (tab === "aem") renderSide();
}
// After the editor approves, the check needs about a minute. Look every 8 seconds, up to 4 minutes.
function pollFinalCheck(round = 0) {
  clearTimeout(finalTimer);
  finalTimer = window.setTimeout(async () => {
    await refreshFinalCheck();
    if ((!finalCheck || finalCheck.state === "none" || finalCheck.state === "pending") && round < 30) pollFinalCheck(round + 1);
  }, 8000);
}
// Saves go to <version>/<component>. Without a version nothing can be saved.
function targetBranch(): string {
  if (!version) throw new Error("Set the version first in the bar, for example v1-158.");
  return gh.branchName(version, slug);
}
// New or changed pictures, not yet committed. Path -> base64 for the commit, plus a local preview URL.
const pending = new Map<string, { b64: string; url: string }>();
const JIRA_BASE = "https://jira.tools.sap/browse";
const JIRA_KEY = /[A-Za-z][A-Za-z0-9]+-\d+/;
let slug = "", model: GuidelineModel, baseline: GuidelineModel | null = null, rules: Rules;
let review: { suggestions: Sug[]; history: Hist[]; state: State } = { suggestions: [], history: [], state: {} };
let F = new Map<string, Field>(), findings: Finding[] = [], tab = store.get("tab") || "checks", selKey = "", before = "", imgBust = Date.now();

// Rules and writing checks. The same code runs in GitHub Actions as the final check.
function allFindings(): Finding[] { return [...auditModel(model, rules), ...patternFindings(model)]; }

// ---------- ids and fields ----------
// First time: ids come from the position, so the last committed version gets the same ids. Later blocks keep their id.
function assignIds(m: GuidelineModel) {
  const walk = (bs: Block[], p: string) => bs.forEach((b: any, i) => { b.id ??= `${p}b${i}`; if (b.type === "columns") b.columns.forEach((c: Block[], ci: number) => walk(c, `${b.id}c${ci}`)); });
  m.sections.forEach((s: any, i) => { s.id ??= `s${i}`; walk(s.blocks, s.id); });
}
const LABEL: Record<string, string> = { text: "Text", title: "Column heading", info: "Info box", "message-strip": "Message strip", table: "Table", "when-to-use": "Do / Don't", image: "Image" };
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
        case "title": add(`${b.id}:text`, "plain", "Heading", path, where, () => b.text, (v) => { b.text = v; }); break;
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
const BLOCK = new Set(["p", "div", "ul", "ol", "h3", "h4"]);
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
      case "h3": case "h4": return inline ? inner : inner.trim() ? `<${tag}>${inner}</${tag}>` : ""; // an inline heading, for example Component availability
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
    // Old words first (struck through), then the new words, the way tracked changes read.
    else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) put("del", A[i++]);
    else put("ins", B[j++]);
  }
  return f;
}

// ---------- the article ----------
const locked = () => review.state.status === "uploaded" || review.state.status === "approved";
const openSug = (key: string) => review.suggestions.find((s) => s.key === key && s.status === "open");
function fieldEl(key: string, tag: string, ph = ""): HTMLElement {
  const f = F.get(key)!; const sug = openSug(key);
  const el = h(tag); el.dataset.key = key; el.dataset.tag = tag; el.dataset.ph = ph;
  if (sug) {
    el.classList.add("sug");
    const t = h("div", "txt"); t.append(diffNode(toText(sug.old, f.kind), toText(sug.new, f.kind)));
    const meta = h("div", "meta"); meta.append(h("span", "", `Suggested by ${sug.author} · ${when(sug.time)}`));
    const role = $<HTMLSelectElement>("#role").value;
    if (role === "designer") {
      const ok = h("button", "small ok", "Accept"); ok.dataset.act = "accept"; ok.dataset.id = sug.id;
      const no = h("button", "small", "Reject"); no.dataset.act = "reject"; no.dataset.id = sug.id;
      meta.append(ok, no);
    } else if (sug.author === me()) {
      // The writer can change or cancel their own suggestion until the designer decides.
      const ed = h("button", "small", "Edit"); ed.dataset.act = "edit"; ed.dataset.id = sug.id;
      const cx = h("button", "small", "Cancel"); cx.dataset.act = "cancel"; cx.dataset.id = sug.id;
      meta.append(ed, cx);
    } else meta.append(h("span", "muted", "Waiting for the designer"));
    el.append(t, meta); return el;
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
    case "title": return fieldEl(`${b.id}:text`, `h${Math.min(Math.max(Math.round(b.level) || 4, 2), 6)}`, "Heading"); // a title inside a column, for example in Related Links
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
  document.querySelectorAll(".hl").forEach((x) => x.classList.remove("hl"));
  el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("hl");
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
// Undo and redo: the last 50 states of the text, the suggestions and the history. Each change is one step.
let undoStack: string[] = [], redoStack: string[] = [], lastSnap = "";
const snap = () => JSON.stringify({ model, suggestions: review.suggestions, history: review.history, aiDone: review.state.aiDone ?? [] });
function restore(s: string) {
  const o = JSON.parse(s); model = o.model; review.suggestions = o.suggestions; review.history = o.history; review.state.aiDone = o.aiDone; lastSnap = s;
  F = collect(model); findings = allFindings(); renderPage(); renderSide(); renderBar(); save();
}
function undo() { if (!undoStack.length || locked()) return; redoStack.push(snap()); restore(undoStack.pop()!); }
function redo() { if (!redoStack.length || locked()) return; undoStack.push(snap()); restore(redoStack.pop()!); }
// For changes that do not go through changed(): remember the state before, run the change, remember the state after.
function recordNow(mutate: () => void) { undoStack.push(snap()); if (undoStack.length > 50) undoStack.shift(); redoStack = []; mutate(); lastSnap = snap(); }
function changed(key?: string) {
  if (lastSnap) { undoStack.push(lastSnap); if (undoStack.length > 50) undoStack.shift(); }
  redoStack = []; lastSnap = snap();
  F = collect(model); findings = allFindings();
  if (key) refreshField(key); else renderPage();
  renderSide(); renderBar(); save();
}
// The writer changes the new wording of their own open suggestion.
function editSuggestion(id: string) {
  const s = review.suggestions.find((x) => x.id === id); if (!s || s.status !== "open") return;
  const f = F.get(s.key); const cur = toText(s.new, f?.kind ?? "plain");
  const v = window.prompt("Change your suggestion:", cur); if (v === null) return;
  const text = v.trim(); if (!text) return;
  s.new = f?.kind === "plain" ? text : `<p>${esc(text)}</p>`; s.time = now();
  changed(s.key);
}
// The writer removes their own open suggestion.
function cancelSuggestion(id: string) {
  const s = review.suggestions.find((x) => x.id === id); if (!s || s.status !== "open") return;
  review.suggestions = review.suggestions.filter((x) => x.id !== id);
  changed(s.key);
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
// A message box that is easy to see, above the work bar. kind: busy | ok | err.
let toastTimer = 0;
function toast(msg: string, kind: "busy" | "ok" | "err", link?: { href: string; text: string }) {
  const t = $("#toast"); t.className = `toast ${kind}`; t.replaceChildren();
  const icon = kind === "busy" ? "⏳" : kind === "ok" ? "✅" : "⚠️";
  t.append(h("span", "toast-icon", icon), h("span", "", msg));
  if (link) { const a = h("a", "", link.text) as HTMLAnchorElement; a.href = link.href; a.target = "_blank"; a.rel = "noopener"; t.append(a); }
  const close = h("button", "toast-x", "✕"); close.addEventListener("click", () => t.hidden = true); t.append(close);
  t.hidden = false; clearTimeout(toastTimer);
  if (kind === "ok") toastTimer = window.setTimeout(() => (t.hidden = true), 8000);
}
// Saves run one after another. Two overlapping saves would make GitHub refuse the second one.
let saveChain: Promise<void> = Promise.resolve();
function commitVersion(message: string): Promise<void> {
  const run = saveChain.then(() => doCommit(message));
  saveChain = run.catch(() => undefined);
  return run;
}
async function doCommit(message: string): Promise<void> {
  toast("Saving to GitHub…", "busy");
  $<HTMLButtonElement>("#commit").disabled = true; $("#commit").textContent = "Saving…";
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
  const r = await gh.commitFiles(targetBranch(), files, message);
  branch = r.branch; pending.clear(); dirty = false; store.set(`draft:${slug}`, "");
  imgBust = Date.now();
  $("#saved").textContent = `Saved to GitHub ${stamp()} · ${branch}`;
  const short = r.sha.slice(0, 7);
  lastCommitUrl = `https://github.com/${gh.REPO}/commit/${r.sha}`; store.set(`commit:${branch}`, lastCommitUrl);
  toast(`Saved to GitHub at ${stamp()}. Version ${short} is on branch ${branch}.`, "ok",
    { href: `https://github.com/${gh.REPO}/commit/${r.sha}`, text: "See the change on GitHub" });
  renderBar();
}
// Shows a failed save in the message box, and sets the button back so it can be tried again.
function saveFailed(e: unknown) { const msg = `Not saved: ${(e as Error).message}`; toast(msg, "err"); $("#saved").textContent = msg; renderBar(); }

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
  if (f.rule === "space-before-punctuation") return (v, k) => onText(k, v, (t) => t.replace(/\s+([,;.!?])(?=\s|$)/g, "$1"));
  if (f.rule === "missing-space-after-comma") return (v, k) => onText(k, v, (t) => t.replace(/([a-z])([,;])([A-Za-z])/g, "$1$2 $3"));
  if (f.rule === "double-space") return (v, k) => onText(k, v, (t) => t.replace(/([^\s ]) {2,}(?=[^\s])/g, "$1 "));
  if (f.rule === "repeated-word") return (v, k) => onText(k, v, (t) => t.replace(/\b([A-Za-z]{2,})(\s+\1\b)+/gi, "$1"));
  if (f.rule === "missing-comma-after-opener") return (v, k) => onText(k, v, (t) => t.replace(/(^|[.!?]\s+)(However|Therefore|Moreover|Furthermore|For example|For instance|In addition)\s+(?=[a-z])/g, "$1$2, "));
  if (f.rule === "missing-full-stop") return (v, k) => {
    // Adds a full stop at the end of each paragraph or list item of four words or more that has none.
    if (k === "plain") return /[.!?:)]$/.test(v.trim()) ? v : `${v.trim()}.`;
    const doc = new DOMParser().parseFromString(`<body>${v}</body>`, "text/html");
    const blocks = [...doc.body.querySelectorAll("p, li")]; if (!blocks.length) blocks.push(doc.body);
    for (const b of blocks) {
      const text = (b.textContent ?? "").trim(); if (text.split(/\s+/).length < 4 || /[.!?:)"”’]$/.test(text)) continue;
      const w = doc.createTreeWalker(b, NodeFilter.SHOW_TEXT); let last: Node | null = null, n: Node | null;
      while ((n = w.nextNode())) if ((n.nodeValue ?? "").trim()) last = n;
      if (last) last.nodeValue = (last.nodeValue ?? "").replace(/\s+$/, "") + ".";
    }
    return clean(doc.body.innerHTML, k === "inline");
  };
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
  const counts: Record<string, [number, boolean]> = { checks: [findings.filter((f) => f.severity !== "info").length, errors() > 0], changes: [ch.length + opens().length, false], history: [review.history.length, false], jira: [0, false], aem: [0, false] };
  document.querySelectorAll<HTMLElement>("#tabs button").forEach((b) => {
    const id = b.dataset.tab!; b.classList.toggle("on", id === tab); b.querySelector(".n")?.remove();
    if (counts[id][0]) b.append(h("span", counts[id][1] ? "n bad" : "n", String(counts[id][0])));
  });
  const db = $("#drawerBtn"); db.replaceChildren(document.createTextNode("Review panel"));
  if (errors()) db.append(h("span", "n bad", String(errors()))); else if (opens().length) db.append(h("span", "n", String(opens().length)));
  const p = $("#panel"); p.replaceChildren();
  if (tab === "checks") {
    { const top = review.state.lastCheck, dis = review.state.dismissed; p.append(h("p", "muted", top ? `${top.skipped ? "Check skipped" : "Last check"}: ${top.by} (${top.role}) · ${when(top.time)}` : dis ? `Check dismissed by ${dis.by} (${dis.role}) · ${when(dis.time)}` : "Nobody has run the check yet. Click Run check in the bar.")); }
    // The headline counts the rule check and the AI check that are still open, so it never says "No errors" while the AI finds some.
    const doneAi = new Set(review.state.aiDone ?? []);
    const aiOpen = aiReport ? aiReport.findings.filter((f) => !doneAi.has(aiKey(f))) : [];
    const aiErr = aiOpen.filter((f) => f.severity === "error").length, aiHint = aiOpen.length - aiErr;
    const allErr = errors() + aiErr, allWarn = findings.filter((f) => f.severity === "warning").length + aiHint;
    const s = h("div", "sum"); s.append(h("strong", "", allErr ? `${allErr} to fix` : "No errors"), h("span", "muted", `${allWarn} to look at · ${findings.filter((f) => f.severity === "info").length} notes`)); p.append(s);
    const order = { error: 0, warning: 1, info: 2 };
    const lc = review.state.lastCheck;
    renderAi(p);
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
    for (const sg of opens()) { const f = F.get(sg.key); const c = card([h("strong", "", sg.label), sg.section, `· ${sg.author}`], diffNode(toText(sg.old, f?.kind ?? "plain"), toText(sg.new, f?.kind ?? "plain")), sg.key); const r = h("div", "row"); if ($<HTMLSelectElement>("#role").value === "designer") r.append(btn("Accept", () => decide(sg.id, true), "small ok"), btn("Reject", () => decide(sg.id, false))); c.append(r); p.append(c); }
    if (opens().length > 1 && $<HTMLSelectElement>("#role").value === "designer") p.append(btn("Accept all suggestions", () => opens().forEach((x) => decide(x.id, true)), "small ok"));
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
  if (tab === "aem") renderAem(p);
  if (tab === "jira") {
    const inp = h("input", "jirakey") as HTMLInputElement; inp.placeholder = "Jira key, for example FIORIDESIGN-17845"; inp.value = review.state.jira ?? "";
    // Accepts the key (FIORIDESIGN-17845) or a full Jira link. Keeps only the key, in capitals.
    inp.addEventListener("change", () => {
      const raw = inp.value.trim(); const m = raw.match(/[A-Za-z][A-Za-z0-9]+-\d+/);
      if (!raw) { review.state.jira = undefined; }
      else if (m) { review.state.jira = m[0].toUpperCase(); }
      else { review.state.jira = raw; }
      save(); renderSide();
    });
    const key = review.state.jira?.match(JIRA_KEY)?.[0];
    const jiraWrap = h("div", "jira-task"); jiraWrap.append(inp);
    if (key) { const a = h("a", "", `Open ${key} in Jira ↗`) as HTMLAnchorElement; a.href = `${JIRA_BASE}/${key}`; a.target = "_blank"; a.rel = "noopener"; jiraWrap.append(a); }
    p.append(h("h5", "", "Jira task"), jiraWrap, h("h5", "", "Status card (one comment, always current)"), h("pre", "jira", statusCard()));
    p.append(h("h5", "", "Sign-off lines (one comment per click)"));
    const lines = (review.state.signoffs ?? []).map(signLine); p.append(h("pre", "jira", lines.length ? lines.join("\n") : "No sign-offs yet."));
    p.append(h("p", "muted", "Preview only. Jira is not connected yet. The GitHub pull request is the record for now."));
  }
}
// Final check: rules and writing patterns, run by GitHub after the editor approves. Upload to AEM waits for it.
function renderFinalCheck(p: HTMLElement, ready: boolean) {
  p.append(h("h5", "", "Final check before AEM"));
  if (!ready) { p.append(h("p", "muted", "Runs by itself after the editor clicks Approve. It checks the rules, wording, full stops, commas, alt text and links.")); return; }
  const fc = finalCheck, wrap = h("div", "fc");
  const say = (icon: string, text: string) => wrap.append(h("p", "", `${icon} ${text}`));
  if (!fc || fc.state === "none" || fc.state === "pending") say("⏳", "Running. This takes about a minute.");
  else if (fc.state === "success") say("✅", `Passed. ${fc.description}`);
  else if (fc.state === "failure") say("❌", `Not passed. ${fc.description}`);
  else say("⚠️", `Could not read the result. ${fc.description}`);
  if (fc?.url) { const a = h("a", "", "Open the full report ↗") as HTMLAnchorElement; a.href = fc.url; a.target = "_blank"; a.rel = "noopener"; wrap.append(a); }
  const again = h("button", "small", "Refresh"); again.addEventListener("click", () => { finalCheck = null; renderSide(); refreshFinalCheck(); }); wrap.append(again);
  if (fc?.state === "failure") wrap.append(h("p", "muted", "Fix the problems yourself, or click Send back to designer. You can also skip the check if you checked the article by hand: you are asked before the upload."));
  p.append(wrap);
}
// The AEM tab: where the approved article goes, and the approved files to take there.
function renderAem(p: HTMLElement) {
  const stage = ((review.state.status as Stage | undefined) ?? "draft");
  const ready = stage === "approved" || stage === "uploaded";
  const base = store.get("aem:base"), section = store.get("aem:section") || "ui-elements";
  const link = (text: string, href: string) => { const a = h("a", "", text) as HTMLAnchorElement; a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; };
  const line = (...n: Node[]) => { const d = h("div", "aem-line"); d.append(...n); return d; };
  p.append(h("h5", "", "Status"), h("p", "", ready ? "✅ Approved in GitHub. Ready for AEM." : `Not ready yet. The article is "${STATUS[stage]}". The editor approves first.`));
  renderFinalCheck(p, ready);
  // The push: two links to copy into the AEM connector (Chrome extension), then Compare and Apply there.
  p.append(h("h5", "", "Send to AEM (the editor)"));
  const rawMain = `https://raw.githubusercontent.com/${gh.REPO}/${gh.MAIN}/content/${slug}/guideline.json`;
  const target = store.get("aem:target");
  const copyRow = (label: string, value: string, off: boolean) => {
    const row = h("div", "aem-copy"); row.append(h("span", "", label));
    const b = btn("Copy", async () => { try { await navigator.clipboard.writeText(value); toast(`Copied: ${label}`, "ok"); } catch { toast(`Could not copy. Select it: ${value}`, "err"); } }, "small");
    if (off) { (b as HTMLButtonElement).disabled = true; } row.append(b); return row;
  };
  const targetIn = h("input", "jirakey") as HTMLInputElement; targetIn.placeholder = "AEM page to overwrite: paste its link once"; targetIn.value = target;
  targetIn.addEventListener("change", () => { store.set("aem:target", targetIn.value.trim()); renderSide(); });
  p.append(h("p", "muted", ready ? "Open the AEM connector in Chrome. Paste these two links. Click Compare with Dry run on. Check the plan. Then turn Dry run off and click Apply." : "Approve first. The link below reads main. Until the editor approves, main still has the old text."),
    copyRow("1. Source: the approved article in GitHub", rawMain, false), copyRow("2. Target: the AEM page that will be overwritten", target, !/^https:\/\//.test(target)), targetIn);
  p.append(h("p", "muted", "The AEM connector saves a backup of the target page before any real write. The source stays read-only."));
  p.append(h("h5", "", "Where it goes in AEM (new page path)"));
  const baseIn = h("input", "jirakey") as HTMLInputElement; baseIn.placeholder = "AEM folder link of the guidelines (paste once)"; baseIn.value = base;
  baseIn.addEventListener("change", () => { store.set("aem:base", baseIn.value.trim()); renderSide(); });
  const secIn = h("input", "jirakey") as HTMLInputElement; secIn.placeholder = "Section folder, for example ui-elements"; secIn.value = section;
  secIn.addEventListener("change", () => { store.set("aem:section", secIn.value.trim() || "ui-elements"); renderSide(); });
  p.append(baseIn, secIn);
  if (!version) p.append(h("p", "muted", "Set the version in the bar first, for example v1-157."));
  else {
    const path = `${version}/${section}/${slug}`;
    p.append(h("p", "", `AEM page: ${path}`));
    if (/^https:\/\//.test(base)) p.append(link("Open this place in AEM ↗", `${base.replace(/\/+$/, "")}/${path}`));
    else p.append(h("p", "muted", "Paste the AEM folder link above to get a link to this place."));
  }
  p.append(h("h5", "", "Approved content in GitHub (main)"));
  const rawBase = `https://raw.githubusercontent.com/${gh.REPO}/${gh.MAIN}/content/${slug}`;
  p.append(line(link("Content (guideline.json) ↗", `${rawBase}/guideline.json`)), line(link("Text (guideline.md) ↗", `${rawBase}/guideline.md`)),
    line(link("Images folder ↗", `https://github.com/${gh.REPO}/tree/${gh.MAIN}/content/${slug}/images`)));
  p.append(h("h5", "", "Upload to AEM"));
  p.append(h("p", "muted", "When the page is in AEM, click Mark uploaded to AEM in the bar."));
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
  const st = (review.state.status ?? "draft") as Stage, ed = lastSign("editor");
  const ch = changesVsBaseline(); const acc = ch.some((c) => /^Accessibility/i.test(c.f.section)); const img = review.history.some((x) => x.kind === "image"); // a picture was replaced. Editing alt text or a caption does not count
  const warn = findings.filter((f) => f.severity === "warning").length;
  const after = (...s: Stage[]) => s.includes(st);
  return [
    `[GitHub] ${title()} · ${review.state.jira || "no Jira key yet"}`,
    `Designer       ${st === "draft" ? "✏️ writing" : st === "designer" ? "⏳ deciding on suggestions" : "✅ done"}`,
    `Checks         ${errors() ? `❌ ${errors()} to fix` : `✅ 0 errors · ${warn} hints`}`,
    `UX writer      ${st === "writer" ? "⏳ checking the text" : st === "draft" ? "— not asked yet" : "✅ done"}`,
    `Accessibility  ${acc ? "⏳ needed (section changed)" : "— not needed (section not changed)"}`,
    `Images         ${img ? "⏳ needed (images changed)" : "— not needed (images not changed)"}`,
    `Editor         ${after("approved", "uploaded") ? `✅ ${ed?.name ?? ""} approved` : st === "editor" ? "⏳ reviewing the page" : "— waits for the designer"}`,
    `AEM            ${st === "uploaded" ? "🚀 uploaded" : st === "approved" ? "⏳ ready to upload" : "— not yet"}`,
  ].join("\n");
}
function signLine(s: Sign): string {
  const acc = review.suggestions.filter((x) => x.status === "accepted").length, rej = review.suggestions.filter((x) => x.status === "rejected").length;
  const at = when(s.time);
  switch (s.action) {
    case "sent": case "to-writer": return `[GitHub] 📨 Sent to UX writer by ${s.name} · ${at}`;
    case "returned": return `[GitHub] ↩ Returned to designer by ${s.name} · ${opens().length} open suggestions · ${at}`;
    case "to-editor": return `[GitHub] 📨 Sent to editor by ${s.name} · ${acc + rej} suggestions decided (${acc} accepted, ${rej} rejected) · ${at}`;
    case "back": return `[GitHub] ↩ Sent back to designer by ${s.name} · ${at}`;
    case "approved": return `[GitHub] ✅ Approved by ${s.name}. The article is done in GitHub · ${at}`;
    case "uploaded": return `[GitHub] 🚀 Uploaded to AEM by ${s.name} · ${at}`;
    default: return `[GitHub] ${s.action} by ${s.name} · ${at}`;
  }
}

// ---------- top bar ----------
const STATUS: Record<string, string> = { draft: "Draft", writer: "With UX writer", designer: "With designer", editor: "In editor review", approved: "Approved · ready for AEM", uploaded: "In AEM" };
// Older saved states used other names.
const LEGACY: Record<string, Stage> = { review: "writer", changes: "designer", ready: "editor", shipped: "approved" };
// Each click is a real step on GitHub: a commit, and for the review steps a pull request action.
async function sign(action: string, status: Stage) {
  // Only the editor decides the pull request. Everyone else only saves versions and passes the article on.
  if (action === "approved" && $<HTMLSelectElement>("#role").value !== "editor") { toast("Only the editor can approve. Approve opens the pull request and merges it.", "err"); return; }
  if (!$<HTMLInputElement>("#name").value.trim()) { $("#name").focus(); $("#saved").textContent = "Type your name first"; return; }
  const who = me(), prevStatus = review.state.status, n0 = review.state.signoffs?.length ?? 0;
  try {
    (review.state.signoffs ??= []).push({ role: $<HTMLSelectElement>("#role").value, name: who, action, time: now() });
    review.state.status = status;
    // Before the editor approves, every send is a commit on the version branch. Nothing else.
    const said: Record<string, string> = { sent: "sent to UX writer", "to-writer": "sent to UX writer", "to-editor": "sent to editor", returned: "returned to designer", back: "sent back to designer", approved: "approved", uploaded: "marked uploaded to AEM" };
    await commitVersion(`${title()}: ${said[action] ?? action} by ${who}`);
    // The editor's Approve is the decision. It opens the pull request (if there is none) and merges it to main.
    if (action === "approved") {
      const lc = review.state.lastCheck;
      let pr = review.state.pr ?? (await gh.findPR(targetBranch())); const created = !pr;
      if (!pr) pr = await gh.openPR(targetBranch(), `${title()} update${review.state.jira ? ` (${review.state.jira})` : ""}`,
        `Approved by ${who} (editor).\n\n${lc ? `${lc.skipped ? "Check skipped" : "Check run"} by ${lc.by} on ${lc.time}: ${lcErr(lc)} errors, ${lcHints(lc)} recommendations, ${lc.fixes} fixes made.` : "No check was run."}`);
      review.state.pr = pr;
      // Only a new pull request gets its own commit (to record its number). The merge itself is the approval.
      if (created) await commitVersion(`${title()}: pull request #${pr.number}`);
      try { await gh.merge(pr.number); }
      catch (e) { throw new Error(`The merge into main failed: ${(e as Error).message}. Pull request: https://github.com/${gh.REPO}/pull/${pr.number}`); }
    }
  } catch (e) {
    review.state.signoffs = (review.state.signoffs ?? []).slice(0, n0); review.state.status = prevStatus;
    saveFailed(e); return;
  }
  if (status === "approved") { finalCheck = null; pollFinalCheck(); }
  // Back and forth between the designer and the UX writer needs no Jira comment: only a short confirmation.
  // The Jira text and the AEM block open only at the real hand-offs: to the editor, approved, uploaded.
  const handoff = status === "editor" || status === "approved" || status === "uploaded";
  if (handoff) { tab = status === "approved" ? "aem" : "jira"; document.body.classList.add("drawer-open"); }
  else toast(`${status === "writer" ? "Sent to the UX writer" : "Sent to the designer"}. Saved to GitHub. No Jira comment needed yet.`, "ok");
  renderPage(); renderSide(); renderBar();
}
function renderBar() {
  const raw = (review.state.status ?? "draft") as string, st = (LEGACY[raw] ?? raw) as Stage, role = $<HTMLSelectElement>("#role").value;
  const pill = $("#status"); pill.textContent = STATUS[st]; pill.className = `pill ${st}`;
  // The check mark: who ran the check, when, how many errors, fixes and recommendations.
  const lc = review.state.lastCheck, mark = $("#checkbadge"), stale = checkIsStale();
  const nice = (x: string) => new Date(x).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (aiState.phase === "running") { mark.className = "checkbadge none"; mark.textContent = "⏳ AI check in progress"; mark.title = "Claude is checking the article. About a minute."; }
  else if (!lc && review.state.dismissed) { mark.className = "checkbadge none"; mark.textContent = "Check dismissed"; mark.title = `Dismissed ${when(review.state.dismissed.time)}. Click Run check to check again.`; }
  else if (!lc) { mark.className = "checkbadge none"; mark.textContent = "No check run yet"; mark.title = "Click Run check. A person can also skip it and check by hand."; }
  else if (stale && !lc.skipped) { mark.className = "checkbadge none"; mark.textContent = "⟳ Text changed · run Check again"; mark.title = "The text changed after the last check, so its count is out of date. Click Run check."; }
  else if (lc.skipped) { mark.className = `checkbadge skipped${stale ? " stale" : ""}`; mark.textContent = "⏭ Check skipped"; mark.title = "A person checked the article by hand."; }
  else if (lcErr(lc) === 0) { mark.className = `checkbadge pass${stale ? " stale" : ""}`; mark.textContent = "✓ Check passed"; mark.title = "Click to see the report."; }
  else { mark.className = `checkbadge fail${stale ? " stale" : ""}`; mark.textContent = `⚠ Check found ${lcErr(lc)} error${lcErr(lc) === 1 ? "" : "s"}`; mark.title = "Click to see the report."; }
  const c = $<HTMLButtonElement>("#commit"); c.disabled = !dirty; c.textContent = branch === gh.MAIN ? "Save version (new update)" : "Save version";
  $<HTMLButtonElement>("#undo").disabled = !undoStack.length || locked(); $<HTMLButtonElement>("#redo").disabled = !redoStack.length || locked();
  const cl = $<HTMLAnchorElement>("#commitlink"); cl.href = lastCommitUrl || `https://github.com/${gh.REPO}/commits/${branch}`;
  const a = $("#actions"); a.replaceChildren();
  const add = (text: string, fn: () => void, cls: string, off = "") => { const b = btn(text, fn, cls); if (off) { b.disabled = true; b.title = off; } a.append(b); };
  // Flow: designer <-> UX writer as often as needed -> either sends to the editor -> the editor reviews, fixes it or sends it back -> Approve -> upload to AEM.
  const stage = (st as string) in LEGACY ? LEGACY[st as string] : st;
  const toEditorBlock = opens().length ? "Open suggestions are waiting for the designer to accept or reject" : errors() ? "Run the check and fix the errors first" : "";
  // The designer and the UX writer can pass the article back and forth, and either can send it to the editor, at any time before the editor has it.
  const open3 = stage === "draft" || stage === "writer" || stage === "designer";
  if (role === "designer" && open3) {
    if (stage !== "writer") add("Send to UX writer", () => sign(stage === "draft" ? "sent" : "to-writer", "writer"), stage === "draft" ? "primary" : "", stage === "draft" && errors() ? "Fix the errors in Checks first" : "");
    add("Send to editor", () => sign("to-editor", "editor"), "ok", toEditorBlock);
  }
  if (role === "writer" && open3 && stage !== "draft") {
    if (stage === "writer") add("Return to designer", () => sign("returned", "designer"), "primary");
    add("Send to editor", () => sign("to-editor", "editor"), "ok", toEditorBlock);
  }
  if (role === "editor" && stage === "editor") {
    add("Send back to designer", () => sign("back", "designer"), "");
    add("Approve", async () => { if (await gateOk()) sign("approved", "approved"); }, "ok", opens().length ? "Open suggestions are still waiting for the designer" : "");
  }
  if (role === "editor" && stage === "approved") {
    const fc = finalCheck?.state;
    if (fc === "failure") add("Send back to designer", () => sign("back", "designer"), "");
    add("Mark uploaded to AEM", async () => { if (await gateOk()) sign("uploaded", "uploaded"); }, "primary");
  }
  if (stage === "uploaded") add("Start a new update", () => { review.state.status = "draft"; renderPage(); renderBar(); renderSide(); save(); }, "");
}

// ---------- events ----------
const page = $("#page");
page.addEventListener("focusin", (e) => { const el = (e.target as HTMLElement).closest<HTMLElement>("[data-key][contenteditable=true]"); if (!el) return; before = serialize(el, F.get(el.dataset.key!)!.kind); selKey = el.dataset.key!; flag(); if (tab === "history") renderSide(); });
page.addEventListener("focusout", (e) => { const el = (e.target as HTMLElement).closest<HTMLElement>("[data-key][contenteditable=true]"); if (!el) return; const f = F.get(el.dataset.key!)!; const after = serialize(el, f.kind); if (after !== before) commit(f.key, after); else el.classList.toggle("empty", !after); });
page.addEventListener("input", (e) => (e.target as HTMLElement).closest?.("[data-key]")?.classList.remove("empty"));
page.addEventListener("keydown", (e) => { const el = (e.target as HTMLElement).closest<HTMLElement>("[data-key][contenteditable=true]"); if (!el) return; if (e.key === "Escape") { el.blur(); } if (e.key === "Enter" && F.get(el.dataset.key!)!.kind !== "html") { e.preventDefault(); el.blur(); } });
page.addEventListener("paste", (e) => { if (!(e.target as HTMLElement).closest("[contenteditable=true]")) return; e.preventDefault(); document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? ""); });
page.addEventListener("click", (e) => {
  const t = e.target as HTMLElement; const act = t.closest<HTMLElement>("[data-act]");
  if (act) { if (act.dataset.act === "edit") return editSuggestion(act.dataset.id!); if (act.dataset.act === "cancel") return cancelSuggestion(act.dataset.id!); return decide(act.dataset.id!, act.dataset.act === "accept"); }
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
$("#checkbadge").addEventListener("click", () => { tab = "checks"; document.body.classList.add("drawer-open"); renderSide(); });
$("#drawerBtn").addEventListener("click", () => document.body.classList.toggle("drawer-open"));
$("#drawerClose").addEventListener("click", () => document.body.classList.remove("drawer-open"));
$("#hints").addEventListener("change", (e) => document.body.classList.toggle("no-hints", !(e.target as HTMLInputElement).checked));
$("#tabs").addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]"); if (!b) return; tab = b.dataset.tab!; store.set("tab", tab); renderSide(); });
// One name per role. The box shows the name of the role you are in.
const DEFAULT_NAMES: Record<string, string> = { designer: "Veni", writer: "Alex", editor: "Krisi" };
const namesByRole = (): Record<string, string> => { try { return { ...DEFAULT_NAMES, ...JSON.parse(store.get("names") || "{}") }; } catch { return { ...DEFAULT_NAMES }; } };
const shownName = (role: string) => namesByRole()[role] ?? "";
$("#name").addEventListener("change", () => { const r = $<HTMLSelectElement>("#role").value; const all = namesByRole(); all[r] = $<HTMLInputElement>("#name").value.trim(); store.set("names", JSON.stringify(all)); });
$("#role").addEventListener("change", () => { const r = $<HTMLSelectElement>("#role").value; store.set("role", r); $<HTMLInputElement>("#name").value = shownName(r); $<HTMLInputElement>("#suggest").checked = r === "writer"; renderPage(); renderBar(); renderSide(); });
$("#suggest").addEventListener("change", renderSide);
$("#guideline").addEventListener("change", () => { location.hash = `#/${$<HTMLSelectElement>("#guideline").value}`; });
window.addEventListener("hashchange", route);
$("#version").addEventListener("change", () => {
  const v = $<HTMLInputElement>("#version").value.trim().toLowerCase();
  if (!v) { version = ""; return; }
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(v)) { toast("Use a version like v1-158", "err"); return; }
  location.hash = `#/${v}/${slug}`;
});

// The address decides what is shown: #/<version>/<component> or #/<component> (latest published).
// Example: #/v1-158/expandable-text. The Jira key never goes into the address.
const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function route() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/").filter(Boolean);
  // Accepts the AEM style: v1-157/Expandable text (or v1-157/ui-elements/Expandable text). The name becomes expandable-text.
  let s = slugOf(parts[parts.length - 1] ?? ""); const v = parts.length > 1 ? parts[0].toLowerCase() : "";
  if (!s) return;
  // A link that was cut at a space ("…/Expandable") still finds "expandable-text" when only one guideline starts that way.
  if (guidelines.length && !guidelines.some((g) => g.slug === s)) {
    const near = guidelines.filter((g) => g.slug.startsWith(s) || slugOf(g.title).startsWith(s));
    if (near.length !== 1) { showUnknown(s, v); return; }
    s = near[0].slug;
  }
  const canon = `#/${v ? `${v}/` : ""}${s}`;
  if (location.hash !== canon) history.replaceState(null, "", canon); // the clean address, without spaces. No reload.
  load(s, v).catch((e) => toast(`Could not open ${s}: ${(e as Error).message}`, "err"));
}
let guidelines: { slug: string; title: string }[] = [];
// Shown when the address names no guideline. Lists the ones that exist.
function showUnknown(name: string, v: string) {
  $("#hero").replaceChildren(); $("#onpage-list").replaceChildren(); $("#saved").textContent = "";
  const box = $("#content"); box.replaceChildren(); const card = h("div", "missing");
  card.append(h("h2", "", `No guideline named "${name}"`), h("p", "", "Pick one of these:"));
  for (const g of guidelines) { const a = h("a", "", g.title) as HTMLAnchorElement; a.href = `#/${v ? `${v}/` : ""}${g.slug}`; card.append(a); }
  box.append(card);
}
// Shown instead of a 404 when a version is not started yet. Starting it copies the latest published version.
function showMissing(s: string, v: string, pub: string) {
  $("#hero").replaceChildren(); $("#onpage-list").replaceChildren(); $("#saved").textContent = "";
  const box = $("#content"); box.replaceChildren();
  const card = h("div", "missing");
  card.append(h("h2", "", `${v} is not started yet`),
    h("p", "", `This guideline has no update for ${v}. The latest published version is ${pub}. Starting ${v} copies that version. Nothing changes on GitHub until you click Save version.`));
  const start = btn(`Start ${v} from ${pub}`, () => load(s, v, true), "primary");
  const latest = h("a", "", `Show the latest published version (${pub})`) as HTMLAnchorElement; latest.href = `#/${s}`;
  card.append(start, latest); box.append(card);
}
// How many one-click fixes were applied, and when the text last changed. Used by the check mark and the question before AEM.
const fixesMade = () => review.history.filter((x) => x.kind === "fix").length;
const lastEdit = () => review.history.reduce((m, x) => (x.time > m ? x.time : m), "");
const checkIsStale = () => !!review.state.lastCheck && lastEdit() > review.state.lastCheck.time;
// A person says: I checked this myself. The mark in the bar then shows who skipped the check, and when.
function skipCheck() {
  review.state.dismissed = undefined;
  review.state.lastCheck = { by: me(), role: $<HTMLSelectElement>("#role").value, time: now(), errors: errors(), hints: findings.filter((f) => f.severity === "warning").length, fixes: fixesMade(), copilot: "skipped, checked by a person", skipped: true };
  renderBar(); renderSide(); save();
}
// Before the article is marked uploaded to AEM: if no check passed on this version, ask. The person decides: run it, or skip it.
function gateReason(): string {
  const lc = review.state.lastCheck, fc = finalCheck;
  if (fc?.state === "success" || (lc && !checkIsStale() && (lc.skipped || lcErr(lc) === 0))) return "";
  if (!lc && fc?.state === "failure") return `The automatic final check found errors: ${fc.description}`;
  if (!lc) return "Nobody has run the check on this version.";
  if (checkIsStale()) return `The text changed after the last check (${lc.by}, ${when(lc.time)}).`;
  return `The last check found ${lcErr(lc)} error${lcErr(lc) === 1 ? "" : "s"} (${lc.by}, ${when(lc.time)}).`;
}
function askCheck(reason: string): Promise<boolean> {
  return new Promise((resolve) => {
    const d = $<HTMLDialogElement>("#gate"); d.replaceChildren(); let done = false;
    const end = (ok: boolean) => { if (done) return; done = true; if (d.open) d.close(); resolve(ok); };
    d.onclose = () => end(false);
    d.append(h("h3", "", "Before this goes to AEM"), h("p", "", reason), h("p", "muted", "You decide: run the check now, or skip it if you checked the article yourself. Skipping is written in the record with your name."));
    const row = h("div", "row");
    row.append(btn("Run check now", () => { end(false); runCheck().catch((e) => toast(`Check failed: ${(e as Error).message}`, "err")); }, "small primary"),
      btn("Skip: I checked it myself", () => { skipCheck(); end(true); }, "small"), btn("Cancel", () => end(false), "small"));
    d.append(row); d.showModal();
  });
}
async function gateOk(): Promise<boolean> { const why = gateReason(); return why ? askCheck(why) : true; }
// Copilot chat (works with Copilot on your GitHub account): copies a ready prompt and opens Copilot.
async function askCopilotChat() {
  const ref = branch === gh.MAIN ? gh.MAIN : branch;
  const url = `https://raw.githubusercontent.com/${gh.REPO}/${ref}/content/${slug}/guideline.md`;
  const prompt = `Review the guideline article at ${url}. Use the rules in .github/copilot-instructions.md of the repository ${gh.REPO}. List each problem with: where it is, what is wrong, and the corrected text. Check wording, full stops, commas, terms, and alt text.`;
  try { await navigator.clipboard.writeText(prompt); toast("Prompt copied. Paste it in Copilot (the new tab).", "ok"); }
  catch { toast(`Could not copy. Use this prompt in Copilot: ${prompt}`, "err"); }
  window.open("https://github.com/copilot", "_blank", "noopener");
}
// Run check: rules, wording, full stops, commas, alt text, links. Anyone can run it at any time. The report shows the fixes.
// Where Copilot review is available (company GitHub), the same click also asks Copilot to review the pull request.
// ----- AI check (Claude), in the background -----
function replaceOnce(v: string, kind: Kind, original: string, fix: string): string | null {
  if (kind === "plain") return v.includes(original) ? v.replace(original, fix) : null;
  const doc = new DOMParser().parseFromString(`<body>${v}</body>`, "text/html"); const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT); let n: Node | null;
  while ((n = w.nextNode())) { const s = n.nodeValue ?? ""; if (s.includes(original)) { n.nodeValue = s.replace(original, fix); return clean(doc.body.innerHTML, kind === "inline"); } }
  return null;
}
// The article field that holds the AI finding's text. Used to jump to it.
function aiKeyOf(f: AiFinding): string | undefined {
  const hits = [...F.values()].filter((fl) => toText(fl.get(), fl.kind).includes(f.original));
  const tail = f.where.split(">").pop()?.trim().toLowerCase() ?? "";
  return (hits.length === 1 ? hits[0] : hits.find((fl) => tail && fl.section.toLowerCase().includes(tail)) ?? hits[0])?.key;
}
function applyAiFix(f: AiFinding) {
  const hits = [...F.values()].filter((fl) => toText(fl.get(), fl.kind).includes(f.original));
  const tail = f.where.split(">").pop()?.trim().toLowerCase() ?? "";
  const pick = hits.length === 1 ? hits[0] : hits.find((fl) => tail && fl.section.toLowerCase().includes(tail)) ?? hits[0];
  const nv = pick ? replaceOnce(pick.get(), pick.kind, f.original, f.fix) : null;
  if (!pick || nv === null) { toast("This fix cannot be applied by itself (the text is split by bold or a link). Change it by hand.", "err"); return; }
  (review.state.aiDone ??= []).push(aiKey(f));
  commit(pick.key, nv, "fix"); jump(pick.key);
}
// Applies every open AI fix, one after another. Each one is re-read so the next one works on the current text.
function applyAllAi() {
  const done = new Set(review.state.aiDone ?? []);
  const todo = (aiReport?.findings ?? []).filter((f) => !done.has(aiKey(f)));
  let applied = 0, skipped = 0;
  for (const f of todo) {
    const before = review.state.aiDone?.length ?? 0;
    applyAiFix(f);
    if ((review.state.aiDone?.length ?? 0) > before) applied++; else skipped++;
  }
  toast(`Applied ${applied} fix${applied === 1 ? "" : "es"}${skipped ? `. ${skipped} could not be applied by itself: change those by hand.` : "."}`, skipped ? "err" : "ok");
  renderSide();
}
// Dismisses every open AI finding and resets the check, so the badge says "No check run yet".
function dismissAllAi() {
  recordNow(() => { if (aiReport) review.state.aiDone = aiReport.findings.map(aiKey); });
  review.state.lastCheck = undefined;
  review.state.dismissed = { by: me(), role: $<HTMLSelectElement>("#role").value, time: now() };
  renderBar(); renderSide(); save();
  toast(`Check dismissed by ${me()}.`, "ok");
}
function dismissAi(f: AiFinding) { recordNow(() => { (review.state.aiDone ??= []).push(aiKey(f)); }); save(); renderSide(); }
function renderAi(p: HTMLElement) {
  const box = h("div", "ai-box"); const done = new Set(review.state.aiDone ?? []);
  if (aiState.phase === "running") box.append(h("p", "", "⏳ AI check (Claude) is running. About a minute."));
  if (aiState.phase === "failed") { box.append(h("p", "", `⚠ AI check: ${aiState.msg}`)); if (aiState.url) { const a = h("a", "", "Open the job on GitHub ↗") as HTMLAnchorElement; a.href = aiState.url; a.target = "_blank"; a.rel = "noopener"; box.append(a); } }
  const open = aiReport ? aiReport.findings.filter((f) => !done.has(aiKey(f))) : [];
  if (aiReport) box.append(h("p", "ai-line", `AI check (${aiReport.model}) · ${when(aiReport.time)} · ${aiReport.errors} errors, ${aiReport.hints} hints · ${open.length} still open`));
  else if (aiState.phase === "none") box.append(h("p", "muted", "AI check: not run yet. Click Run check in the bar."));
  p.append(box);
  if (open.length) {
    const all = h("div", "row ai-all"); all.append(
      btn(`Apply all ${open.length} fixes`, () => applyAllAi(), "small primary"),
      btn("Dismiss all and clear the check", () => dismissAllAi(), "small"));
    p.append(all);
  }
  for (const f of open) {
    const c = card([h("span", `sev ${f.severity === "error" ? "error" : "warning"}`, f.severity === "error" ? "AI error" : "AI hint"), f.where], document.createTextNode(`${f.problem}\nNow: ${f.original}\nFix: ${f.fix}`), aiKeyOf(f));
    const r = h("div", "row"); r.append(btn("Apply fix", () => applyAiFix(f), "small primary"), btn("Dismiss", () => dismissAi(f), "small")); c.append(r); p.append(c);
  }
}
async function startAiCheck(): Promise<void> {
  if (!gh.getToken() || !version || branch === gh.MAIN) {
    aiState = { phase: "failed", msg: !gh.getToken() ? "Paste your GitHub token first." : "Save a version first. The AI reads the saved version on GitHub." }; renderSide(); toast(`AI check not started. ${aiState.msg}`, "err"); return;
  }
  try {
    if (dirty) await commitVersion(`${title()}: saved before the AI check by ${me()}`);
    const since = Date.now() - 60000;
    await gh.startAiCheck(slug, targetBranch());
    aiState = { phase: "running" }; renderSide(); toast("AI check started (Claude). The report comes back in about a minute.", "busy");
    pollAi(since);
  } catch (e) {
    const m = (e as Error).message, hint = /not accessible|forbidden|Not Found|403|404/i.test(m) ? " Add Actions: read and write to your GitHub token." : "";
    aiState = { phase: "failed", msg: m + hint }; renderSide(); toast(`AI check not started: ${m}${hint}`, "err");
  }
}
function pollAi(since: number, round = 0) {
  clearTimeout(aiTimer);
  aiTimer = window.setTimeout(async () => {
    try {
      const run = await gh.latestAiRun();
      if (run && Date.parse(run.created) >= since && run.status === "completed") {
        if (run.conclusion === "success") {
          aiReport = await gh.readJson<AiReport | null>(`content/${slug}/review/ai-report.json`, `reports/${targetBranch()}`, null);
          aiState = { phase: "done" }; review.state.aiDone = [];
          const lc = review.state.lastCheck;
          if (lc && aiReport) lc.ai = { errors: aiReport.errors, hints: aiReport.hints, model: aiReport.model, time: aiReport.time };
          renderBar(); renderSide(); save();
          toast(`AI check done: ${aiReport?.errors ?? 0} errors, ${aiReport?.hints ?? 0} hints.`, aiReport?.errors ? "err" : "ok");
        } else {
          aiState = { phase: "failed", msg: "The AI job failed. Most likely the secret ANTHROPIC_API_KEY is missing, or the key has no credit.", url: run.url };
          renderSide(); toast("AI check failed. The Checks tab has the link to the job.", "err");
        }
        return;
      }
    } catch { /* look again */ }
    if (round < 40) pollAi(since, round + 1); else { aiState = { phase: "failed", msg: "No answer after 4 minutes." }; renderSide(); }
  }, 6000);
}
async function runCheck() {
  findings = allFindings();
  const errs = errors(), hints = findings.filter((f) => f.severity === "warning").length;
  let copilot = "not asked (no pull request yet)";
  const n = review.state.pr?.number ?? (version && gh.getToken() ? (await gh.findPR(targetBranch()).catch(() => undefined))?.number : undefined);
  if (n && gh.getToken()) copilot = (await gh.requestCopilot(n).catch(() => false)) ? "review requested on the pull request" : "not available for this GitHub account";
  review.state.lastCheck = { by: me(), role: $<HTMLSelectElement>("#role").value, time: now(), errors: errs, hints, fixes: fixesMade(), copilot };
  review.state.dismissed = undefined;
  tab = "checks"; document.body.classList.add("drawer-open"); renderSide(); renderBar(); save();
  void startAiCheck();
  toast(`Check done: ${errs} error${errs === 1 ? "" : "s"}, ${hints} hint${hints === 1 ? "" : "s"}.${copilot.startsWith("review requested") ? " Copilot review requested on the pull request." : ""}`, errs ? "err" : "ok");
}
async function load(s: string, v = "", allowStart = false) {
  slug = s; store.set("slug", s); selKey = ""; pending.clear();
  $<HTMLSelectElement>("#guideline").value = s; $<HTMLInputElement>("#version").value = v;
  version = v;
  // "main" = the latest published version. A version has its own branch: <version>/<component>.
  const exists = v ? await gh.branchExists(gh.branchName(v, s)) : false;
  branch = exists ? gh.branchName(v, s) : gh.MAIN;
  lastCommitUrl = store.get(`commit:${branch}`);
  const doc = await gh.readJson<any>(`content/${s}/guideline.json`, branch, undefined as any);
  if (!doc) throw new Error(`No guideline.json for ${s}`);
  const pub = "v" + versionOf(doc.model ?? { component: s, sections: [] }).replace(".", "-");
  if (v && !exists && v !== pub && !allowStart) { showMissing(s, v, pub); return; }
  docRef = doc; model = doc.model;
  baseline = (await gh.readJson<any>(`content/${s}/guideline.json`, gh.MAIN, { model: null })).model ?? null;
  review = {
    suggestions: await gh.readJson(`content/${s}/review/suggestions.json`, branch, []),
    history: await gh.readJson(`content/${s}/review/history.json`, branch, []),
    state: await gh.readJson(`content/${s}/review/state.json`, branch, {}),
  };
  aiReport = branch === gh.MAIN ? null : await gh.readJson<AiReport | null>(`content/${s}/review/ai-report.json`, `reports/${branch}`, null); aiState = { phase: "none" };
  { const old = review.state.status as string | undefined; if (old && LEGACY[old]) review.state.status = LEGACY[old]; }
  // Opened from a Jira link (…/fiori-guideline-studio/?jira=FIORIDESIGN-17845): the ticket is filled in, nobody pastes it.
  const fromLink = new URLSearchParams(location.search).get("jira")?.match(JIRA_KEY)?.[0];
  if (fromLink && review.state.jira !== fromLink.toUpperCase()) { review.state.jira = fromLink.toUpperCase(); save(); }
  // A draft from an unsaved session in this browser comes back, so nothing is lost on reload.
  const draft = store.get(`draft:${s}`);
  let note = branch === gh.MAIN ? "No open update yet. Your first save creates one." : `Open update: ${branch}`;
  if (draft) { try { const d = JSON.parse(draft); model = d.model; review = d.review; dirty = true; note = "Unsaved draft from this browser restored"; } catch { /* bad draft: ignore */ } }
  else dirty = false;
  assignIds(model); if (baseline) assignIds(baseline);
  F = collect(model); findings = allFindings();
  undoStack = []; redoStack = []; lastSnap = snap();
  finalCheck = null; renderPage(); renderSide(); renderBar(); $("#saved").textContent = note;
  if (review.state.status === "approved" || review.state.status === "uploaded") refreshFinalCheck();
}
(async () => {
  rules = (await gh.rules()) as Rules;
  const list: { slug: string; title: string }[] = await gh.listGuidelines(); guidelines = list;
  const tokenBox = $<HTMLInputElement>("#token"); tokenBox.placeholder = gh.getToken() ? "Token saved in this browser" : "Paste GitHub token";
  // Paste, then Enter or click away: the token is saved and checked with GitHub. The message says what happened.
  const showToken = (msg: string, ok: boolean) => { $("#saved").textContent = msg; $("#saved").style.color = ok ? "#256f3a" : "#aa0808"; };
  const checkToken = async () => {
    if (!gh.getToken()) { tokenBox.placeholder = "Paste GitHub token"; return; }
    tokenBox.placeholder = "Token saved ✓"; renderBar();
    try { const who = await gh.whoami(); showToken(`Connected to GitHub as ${who}. You can save versions now.`, true); }
    catch (e) { tokenBox.placeholder = "Token not accepted"; showToken((e as Error).message, false); }
  };
  tokenBox.addEventListener("change", () => { const v = tokenBox.value.trim(); if (!v) return; gh.setToken(v); tokenBox.value = ""; checkToken(); });
  checkToken();
  $("#undo").addEventListener("click", undo); $("#redo").addEventListener("click", redo);
  $("#runcheck").addEventListener("click", () => { runCheck().catch((e) => toast(`Check failed: ${(e as Error).message}`, "err")); });
  $("#commit").addEventListener("click", async () => {
    if (!gh.getToken()) { toast("No GitHub token yet. Paste it in the token box at the bottom right, then press Enter.", "err"); return; }
    try { await commitVersion(`${title()}: saved by ${me()}`); } catch (e) { saveFailed(e); }
  });
  const sel = $<HTMLSelectElement>("#guideline"); list.forEach((g) => sel.add(new Option(g.title, g.slug)));
  const role = store.get("role") || "designer"; $<HTMLSelectElement>("#role").value = role; $<HTMLInputElement>("#suggest").checked = role === "writer"; $<HTMLInputElement>("#name").value = shownName(role);
  const first = list.find((g) => g.slug === store.get("slug"))?.slug ?? list[0]?.slug;
  if (location.hash.length > 2) route();
  else if (first) { location.hash = `#/${first}`; }
})();
