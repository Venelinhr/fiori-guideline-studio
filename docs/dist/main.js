// src/export/mdRender.ts
var slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
var ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
var decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]);
function htmlToMd(html) {
  let h2 = html;
  h2 = h2.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, u, t) => `[${t.replace(/<[^>]+>/g, "")}](${decode(u)})`);
  h2 = h2.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => {
    const core = inner.trim();
    if (!core) return inner;
    return `${inner.match(/^\s*/)?.[0] ?? ""}**${core}**${inner.match(/\s*$/)?.[0] ?? ""}`;
  });
  h2 = h2.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, "_$2_");
  h2 = h2.replace(/<br\s*\/?>/gi, "\\\n");
  h2 = h2.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner) => {
    let n = 0;
    return "\n" + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, t) => `${++n}. ${t.trim()}
`) + "\n";
  });
  h2 = h2.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner) => "\n" + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, t) => `- ${t.trim()}
`) + "\n");
  h2 = h2.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n").replace(/<\/?p[^>]*>/gi, "\n");
  h2 = h2.replace(/<[^>]+>/g, "");
  return decode(h2).split("\n").map((l) => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
var cell = (s) => htmlToMd(s).replace(/\n+/g, " ").replace(/\|/g, "\\|");
var imageFile = (b) => `images/${slug(b.figmaName ?? b.ref)}.png`;
function renderBlock(b) {
  switch (b.type) {
    case "text":
      return htmlToMd(b.html);
    case "title":
      return `${"#".repeat(Math.min(Math.max(b.level, 2), 6))} ${b.text}`;
    case "image": {
      if (!isGuidelineImage(b)) return "";
      const cap = b.caption ? `
Caption: ${b.caption}` : "";
      return `![${(b.alt ?? "").replace(/[\[\]]/g, "")}](${imageFile(b)} "${b.figmaName ?? b.ref}")${cap}`;
    }
    case "table": {
      const [head, ...rows] = b.rows;
      if (!head) return "";
      return [`| ${head.map(cell).join(" | ")} |`, `|${" --- |".repeat(head.length)}`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
    }
    case "message-strip":
      return `::: message-strip ${b.style}
${htmlToMd(b.html)}
:::`;
    case "info":
      return `::: info ${b.infoClass}
${htmlToMd(b.html)}
:::`;
    case "columns":
      return `::: columns ${b.columnCount}
${b.columns.map((col) => col.map(renderBlock).join("\n\n")).join("\n\n--- column ---\n\n")}
:::`;
    case "when-to-use":
      return b.items.map((i) => `::: ${i.doOrDont}
${htmlToMd(i.html)}
:::`).join("\n\n");
    default:
      return `<!-- unsupported block -->`;
  }
}
var LEVEL = { h2: 2, h3: 3, h4: 4 };
function renderSection(s) {
  const head = s.noTitle ? "" : `${"#".repeat(LEVEL[s.titleLevel ?? "h2"])} ${s.title}

`;
  return head + s.blocks.map(renderBlock).filter(Boolean).join("\n\n");
}
function renderGuidelineMd(m, meta = {}) {
  const fm = { title: m.pageTitle ?? m.component, component: m.component, ...meta };
  const head = ["---", ...Object.entries(fm).filter(([, v]) => v !== void 0).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), "---", ""].join("\n");
  return head + "\n" + m.sections.map(renderSection).join("\n\n") + "\n";
}
var isGuidelineImage = (b) => /^\d{2}_/.test(b.figmaName ?? "");

// src/export/ruleAudit.ts
var ENT2 = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
var plain = (h2) => h2.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT2[m]).replace(/\s+/g, " ").trim();
var linksIn = (h2) => [...h2.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ text: plain(m[2]), url: m[1].replace(/&amp;/g, "&") }));
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
  const F2 = [];
  const add = (severity, agent, rule, message, where, suggestion) => F2.push({ severity, agent, rule, message, where, ...suggestion ? { suggestion } : {} });
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
  for (const { block, section } of real) {
    const name = block.figmaName ?? block.ref;
    if (R.style.imagesNeedCaption && !block.caption.trim()) {
      if (sepCaption.has(name)) add("info", "structure", "image-caption-separate", `Image "${name}": the caption is a separate text line after the image, not attached to the image.`, section);
      else add("error", "structure", "image-caption", `Image "${name}" has no caption.`, section);
    }
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
    if (L.workingToolHosts.some((h2) => l.url.includes(h2)) && !(it.kind === "td" || inRelated)) add(L.workingLinkSeverity ?? "error", "technical", "working-link", `Link "${l.text}" goes to a Figma working file: ${l.url}${L.workingLinkNote ? ` (${L.workingLinkNote})` : ""}`, at(it));
    if (L.internalHosts.some((h2) => l.url.includes(h2)) && /external/i.test(it.parent)) add("error", "technical", "internal-link", `Internal link "${l.text}" in an external section: ${l.url}`, at(it));
    else if (L.internalHosts.some((h2) => l.url.includes(h2)) && !inRelated) add("warning", "technical", "internal-link", `Internal link "${l.text}" in public content: ${l.url}`, at(it));
    const v = l.url.match(verRe);
    if (v) pinned.set(`${v[1]}.${v[2]}`, (pinned.get(`${v[1]}.${v[2]}`) ?? 0) + 1);
    else if (l.url.includes("/fiori-design-web/")) unpinned++;
    if (!/^https:\/\//.test(l.url)) add("warning", "technical", "link-protocol", `Link "${l.text}" does not use https: ${l.url}`, at(it));
  }
  if (pinned.size && (pinned.size > 1 || unpinned)) add("warning", "technical", "link-version", `Guideline links point to different versions: ${[...pinned].map(([v, n]) => `v${v} (${n} links)`).join(", ")}${unpinned ? `, and ${unpinned} links with no version` : ""}.`, "page", "Use one rule for all links: no version, or the version of this guideline.");
  return F2;
}

// docs/gh.ts
var REPO = "Venelinhr/fiori-guideline-studio";
var MAIN = "main";
var API = `https://api.github.com/repos/${REPO}`;
var rawBase = (ref) => `https://raw.githubusercontent.com/${REPO}/${ref}`;
var TOKEN_KEY = "gh-token";
var getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
};
var setToken = (t) => {
  try {
    t.trim() ? localStorage.setItem(TOKEN_KEY, t.trim()) : localStorage.removeItem(TOKEN_KEY);
  } catch {
  }
};
var GhError = class extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
};
async function api(path, init = {}, needToken = false) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const tok = getToken();
  if (tok) headers.authorization = `Bearer ${tok}`;
  if (needToken && !tok) throw new GhError(401, "Paste your GitHub token first (top right).");
  let body = init.body;
  if (init.json !== void 0) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const r = await fetch(`${API}${path}`, { ...init, headers, body });
  if (r.status === 204) return void 0;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new GhError(r.status, j.message ? `GitHub: ${j.message}` : `GitHub error ${r.status}`);
  return j;
}
async function readText(path, ref) {
  try {
    const j = await api(`/contents/${path}?ref=${encodeURIComponent(ref)}`);
    return decodeURIComponent(escape(atob(j.content.replace(/\n/g, ""))));
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return void 0;
    throw e;
  }
}
var readJson = async (path, ref, fallback) => {
  const t = await readText(path, ref);
  return t === void 0 ? fallback : JSON.parse(t);
};
async function listGuidelines() {
  return (await fetch(`${rawBase(MAIN)}/content/index.json`)).json();
}
async function rules() {
  return (await fetch(`${rawBase(MAIN)}/standards/rules.json`)).json();
}
var branchName = (version2, slug3) => `${version2}/${slug3}`;
async function branchExists(branch2) {
  try {
    await api(`/git/ref/heads/${branch2}`);
    return true;
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return false;
    throw e;
  }
}
async function commitFiles(branch2, files, message) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await commitOnce(branch2, files, message);
    } catch (e) {
      const stale = e instanceof GhError && /fast.forward/i.test(e.message);
      if (!stale || attempt >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * attempt));
    }
  }
}
async function commitOnce(branch2, files, message) {
  let head;
  try {
    head = (await api(`/git/ref/heads/${branch2}`, {}, true)).object.sha;
  } catch (e) {
    if (!(e instanceof GhError) || e.status !== 404) throw e;
    const main = await api(`/git/ref/heads/${MAIN}`, {}, true);
    await api(`/git/refs`, { method: "POST", json: { ref: `refs/heads/${branch2}`, sha: main.object.sha } }, true);
    head = main.object.sha;
  }
  const parent = await api(`/git/commits/${head}`, {}, true);
  const tree = [];
  for (const f of files) {
    const b = await api(`/git/blobs`, { method: "POST", json: f.base64 !== void 0 ? { content: f.base64, encoding: "base64" } : { content: f.content ?? "", encoding: "utf-8" } }, true);
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
  }
  const t = await api(`/git/trees`, { method: "POST", json: { base_tree: parent.tree.sha, tree } }, true);
  const c = await api(`/git/commits`, { method: "POST", json: { message, tree: t.sha, parents: [head] } }, true);
  await api(`/git/refs/heads/${branch2}`, { method: "PATCH", json: { sha: c.sha } }, true);
  return { branch: branch2, sha: c.sha };
}
async function findPR(branch2) {
  const open = await api(`/pulls?state=open&head=${encodeURIComponent(`${REPO.split("/")[0]}:${branch2}`)}`);
  return open[0] ? { number: open[0].number, url: open[0].html_url } : void 0;
}
async function openPR(branch2, title2, body) {
  const open = await api(`/pulls?state=open&head=${encodeURIComponent(`${REPO.split("/")[0]}:${branch2}`)}`);
  const pr = open[0] ?? await api(`/pulls`, { method: "POST", json: { title: title2, head: branch2, base: MAIN, body } }, true);
  return { number: pr.number, url: pr.html_url };
}
async function review(number, event, body) {
  await api(`/pulls/${number}/reviews`, { method: "POST", json: { event, body } }, true);
}
async function merge(number) {
  await api(`/pulls/${number}/merge`, { method: "PUT", json: { merge_method: "squash" } }, true);
}
async function whoami() {
  const tok = getToken();
  if (!tok) throw new GhError(401, "No token saved yet.");
  const r = await fetch("https://api.github.com/user", { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${tok}` } });
  if (r.status === 401) throw new GhError(401, "GitHub did not accept this token. Check that you copied all of it.");
  if (!r.ok) throw new GhError(r.status, `GitHub answered ${r.status}. Try again.`);
  return (await r.json()).login;
}
function toBase64(buf) {
  let s = "";
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
  return btoa(s);
}

// docs/main.ts
var $ = (s) => document.querySelector(s);
var h = (tag, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
var store = { get: (k) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}, set: (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
  }
} };
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var when = (t) => new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
var uid = () => Math.random().toString(36).slice(2, 10);
var branch = MAIN;
var version = "";
var docRef = {};
var dirty = false;
var lastCommitUrl = "";
function targetBranch() {
  if (!version) throw new Error("Set the version first in the bar, for example v1-158.");
  return branchName(version, slug2);
}
var pending = /* @__PURE__ */ new Map();
var JIRA_BASE = "https://jira.tools.sap/browse";
var JIRA_KEY = /[A-Za-z][A-Za-z0-9]+-\d+/;
var slug2 = "";
var model;
var baseline = null;
var rules2;
var review2 = { suggestions: [], history: [], state: {} };
var F = /* @__PURE__ */ new Map();
var findings = [];
var tab = store.get("tab") || "checks";
var selKey = "";
var before = "";
var imgBust = Date.now();
function assignIds(m) {
  const walk = (bs, p) => bs.forEach((b, i) => {
    b.id ??= `${p}b${i}`;
    if (b.type === "columns") b.columns.forEach((c, ci) => walk(c, `${b.id}c${ci}`));
  });
  m.sections.forEach((s, i) => {
    s.id ??= `s${i}`;
    walk(s.blocks, s.id);
  });
}
var LABEL = { text: "Text", info: "Info box", "message-strip": "Message strip", table: "Table", "when-to-use": "Do / Don't", image: "Image" };
function collect(m) {
  const out = /* @__PURE__ */ new Map();
  let parent = "";
  const add = (key, kind, label, section, where, get, set) => out.set(key, { key, kind, label, section, where, get, set });
  add("page:title", "plain", "Page title", "Page", "page title", () => m.pageTitle ?? m.component, (v) => {
    m.pageTitle = v;
  });
  for (const s of m.sections) {
    if (!s.noTitle && s.titleLevel !== "h3" && s.titleLevel !== "h4") parent = s.title;
    const path = s.noTitle || parent === s.title ? s.title : `${parent} > ${s.title}`;
    if (!s.noTitle) add(`${s.id}:title`, "plain", "Heading", path, `${path} > heading`, () => s.title, (v) => {
      s.title = v;
    });
    let n = 0;
    const visit = (b, prefix) => {
      const where = `${path} > ${prefix}block ${++n} (${b.type})`;
      const L = LABEL[b.type] ?? b.type;
      switch (b.type) {
        case "text":
        case "info":
        case "message-strip":
          add(`${b.id}:html`, "html", L, path, where, () => b.html, (v) => {
            b.html = v;
          });
          break;
        case "image":
          add(`${b.id}:caption`, "plain", "Image caption", path, where, () => b.caption ?? "", (v) => {
            b.caption = v;
          });
          add(`${b.id}:alt`, "plain", "Image alt text", path, where, () => b.alt ?? "", (v) => {
            b.alt = v;
          });
          break;
        case "table":
          b.rows.forEach((r, ri) => r.forEach((_c, ci) => add(`${b.id}:rows.${ri}.${ci}`, "inline", `Table row ${ri + 1}, column ${ci + 1}`, path, where, () => b.rows[ri][ci], (v) => {
            b.rows[ri][ci] = v;
          })));
          break;
        case "when-to-use":
          b.items.forEach((it, i) => add(`${b.id}:items.${i}`, "html", it.doOrDont === "do" ? "Do" : "Don't", path, where, () => it.html, (v) => {
            it.html = v;
          }));
          break;
        case "columns":
          b.columns.forEach((col) => col.forEach((c) => visit(c, "column > ")));
          break;
      }
    };
    s.blocks.forEach((b) => visit(b, ""));
  }
  return out;
}
var esc2 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var BLOCK = /* @__PURE__ */ new Set(["p", "div", "ul", "ol"]);
function clean(html, inline = false) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = (n) => {
    if (n.nodeType === 3) return esc2((n.nodeValue ?? "").replace(/\u00a0/g, " "));
    if (n.nodeType !== 1) return "";
    const el = n, tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style") return "";
    const inner = [...el.childNodes].map(out).join("");
    switch (tag) {
      case "b":
      case "strong":
        return inner.trim() ? `<strong>${inner}</strong>` : inner;
      case "i":
      case "em":
        return inner.trim() ? `<em>${inner}</em>` : inner;
      case "a": {
        const href = el.getAttribute("href") ?? "";
        return /^(https?:\/\/|mailto:)/i.test(href) && inner.trim() ? `<a href="${esc2(href).replace(/"/g, "&quot;")}">${inner}</a>` : inner;
      }
      case "br":
        return "<br>";
      case "p":
      case "div":
        return inline ? inner : inner.replace(/<br>/g, "").trim() ? `<p>${inner}</p>` : "";
      case "ul":
      case "ol":
        return inline ? inner : `<${tag}>${inner}</${tag}>`;
      case "li":
        return inline ? `${inner} ` : `<li>${inner}</li>`;
      default:
        return inner;
    }
  };
  let r = "", run = "";
  const flush = () => {
    if (run.replace(/<br>/g, "").trim()) r += inline ? run : `<p>${run.trim()}</p>`;
    run = "";
  };
  for (const n of doc.body.childNodes) {
    if (n.nodeType === 1 && BLOCK.has(n.tagName.toLowerCase()) && !inline) {
      flush();
      r += out(n);
    } else run += out(n);
  }
  flush();
  return r.replace(/(<br>)+<\/(p|li)>/g, "</$2>").replace(/<p>\s+/g, "<p>").trim();
}
function toText(v, kind) {
  if (kind === "plain") return v;
  const doc = new DOMParser().parseFromString(`<body>${v}</body>`, "text/html");
  doc.body.querySelectorAll("li").forEach((li) => {
    li.prepend("\u2022 ");
    li.append("\n");
  });
  doc.body.querySelectorAll("p").forEach((p) => p.append("\n"));
  doc.body.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  return (doc.body.textContent ?? "").replace(/\n+$/, "");
}
var serialize = (el, kind) => kind === "plain" ? (el.textContent ?? "").replace(/\s+/g, " ").trim() : clean(el.innerHTML, kind === "inline");
function diffNode(a, b) {
  const A = a.split(/(\s+)/).filter(Boolean), B = b.split(/(\s+)/).filter(Boolean), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i2 = n - 1; i2 >= 0; i2--) for (let j2 = m - 1; j2 >= 0; j2--) L[i2][j2] = A[i2] === B[j2] ? L[i2 + 1][j2 + 1] + 1 : Math.max(L[i2 + 1][j2], L[i2][j2 + 1]);
  const f = document.createDocumentFragment();
  let i = 0, j = 0;
  const put = (tag, t) => {
    const last = f.lastChild;
    if (tag && last?.nodeName.toLowerCase() === tag) last.textContent += t;
    else if (!tag && last?.nodeType === 3) last.nodeValue += t;
    else f.append(tag ? h(tag, "", t) : document.createTextNode(t));
  };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      put("", A[i]);
      i++;
      j++;
    } else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) put("del", A[i++]);
    else put("ins", B[j++]);
  }
  return f;
}
var locked = () => review2.state.status === "shipped";
var openSug = (key) => review2.suggestions.find((s) => s.key === key && s.status === "open");
function fieldEl(key, tag, ph = "") {
  const f = F.get(key);
  const sug = openSug(key);
  const el = h(tag);
  el.dataset.key = key;
  el.dataset.tag = tag;
  el.dataset.ph = ph;
  if (sug) {
    el.classList.add("sug");
    const t = h("div", "txt");
    t.append(diffNode(toText(sug.old, f.kind), toText(sug.new, f.kind)));
    const meta = h("div", "meta");
    meta.append(h("span", "", `Suggested by ${sug.author} \xB7 ${when(sug.time)}`));
    const ok = h("button", "small ok", "Accept");
    ok.dataset.act = "accept";
    ok.dataset.id = sug.id;
    const no = h("button", "small", "Reject");
    no.dataset.act = "reject";
    no.dataset.id = sug.id;
    meta.append(ok, no);
    el.append(t, meta);
    return el;
  }
  if (f.kind === "plain") el.textContent = f.get();
  else el.innerHTML = clean(f.get(), f.kind === "inline");
  if (!locked()) {
    el.contentEditable = "true";
    el.spellcheck = true;
  }
  el.classList.toggle("empty", !f.get().trim());
  return el;
}
var imgSrc = (b) => {
  const p = `content/${slug2}/${imageFile(b)}`;
  return pending.get(p)?.url ?? `${rawBase(branch)}/${p}?t=${imgBust}`;
};
var icon = (name, w, hgt, cls = "") => {
  const i = h("img", cls);
  i.src = `./assets/${name}.svg`;
  i.width = w;
  i.height = hgt;
  i.alt = "";
  return i;
};
var INFO_TITLE = { toptip: "Top Tips", information: "Information", warning: "Warning", guideline: "Guideline", hint: "Hint", changes: "Changes" };
function badgeEl(raw) {
  const m = raw.replace(/<[^>]+>/g, "").trim().match(/^:badge,([^:]*):$/);
  if (!m) return null;
  const parts = m[1].split(",").map((x) => x.trim());
  const label = parts[parts.length - 1];
  const kind = /sapui5/i.test(label) ? "blue" : /figma/i.test(label) ? "white" : "grey";
  const t = h("span", `tag ${kind}`, label);
  t.title = "Library tag (fixed by the template)";
  return t;
}
function blockEl(b) {
  switch (b.type) {
    case "text": {
      const w = h("div", "txt");
      w.append(fieldEl(`${b.id}:html`, "div", "Write text"));
      return w;
    }
    case "message-strip": {
      const w = h("div", `ms ${b.style}`);
      w.append(icon("info", 16, 16, "ms-icon"), fieldEl(`${b.id}:html`, "div"), icon("close", 16, 16, "ms-close"));
      return w;
    }
    case "info": {
      const w = h("div", `guidance ${b.infoClass}`);
      const ib = h("div", "gd-icon");
      ib.append(icon("lightbulb", 48, 48));
      w.append(ib, h("div", "gd-title", INFO_TITLE[b.infoClass] ?? b.infoClass), fieldEl(`${b.id}:html`, "div"));
      return w;
    }
    case "when-to-use": {
      const w = h("div", "dodont");
      b.items.forEach((it, i) => {
        const c = h("div", `dd ${it.doOrDont}`);
        c.append(h("div", "dd-title", it.doOrDont === "do" ? "Do" : "Don\u2019t"), fieldEl(`${b.id}:items.${i}`, "div"));
        w.append(c);
      });
      return w;
    }
    case "table": {
      const wrap = h("div", "tbl");
      const t = h("table");
      b.rows.forEach((r, ri) => {
        const tr = h("tr", ri === 0 ? "head" : "");
        r.forEach((c, ci) => {
          const badge = ri > 0 ? badgeEl(c) : null;
          if (badge) {
            const td = h("td");
            td.append(badge);
            tr.append(td);
          } else tr.append(fieldEl(`${b.id}:rows.${ri}.${ci}`, ri === 0 ? "th" : "td"));
        });
        t.append(tr);
      });
      wrap.append(t);
      return wrap;
    }
    case "columns": {
      const w = h("div", "cols");
      w.style.gridTemplateColumns = `repeat(${b.columnCount}, minmax(0, 1fr))`;
      b.columns.forEach((col) => {
        const c = h("div", "col");
        col.forEach((x) => c.append(blockEl(x)));
        w.append(c);
      });
      return w;
    }
    case "image": {
      const fig = h("figure", `img ${b.variant}`);
      const box = h("div", "imgbox");
      box.dataset.img = b.id;
      const img = h("img");
      img.src = imgSrc(b);
      img.alt = b.alt ?? "";
      img.loading = "lazy";
      box.append(img);
      const alt = h("div", "alt editonly");
      alt.append(h("b", "", "ALT"), fieldEl(`${b.id}:alt`, "span", "Add the alt text"));
      fig.append(box, fieldEl(`${b.id}:caption`, "figcaption", "Add a caption"), alt);
      return fig;
    }
    case "title":
      return h(`h${Math.min(4, Math.max(2, b.level))}`, "", b.text);
    default:
      return h("div");
  }
}
var versionOf = (m) => {
  let v = "";
  const walk = (bs) => bs.forEach((b) => {
    if (!v && b.type === "image") v = b.figmaName?.match(/_v(\d+\.\d+)$/)?.[1] ?? "";
    if (b.type === "columns") b.columns.forEach(walk);
  });
  m.sections.forEach((s) => walk(s.blocks));
  return v;
};
function renderPage() {
  const y = window.scrollY;
  const hero = $("#hero");
  hero.replaceChildren();
  const bc = h("div", "breadcrumb");
  bc.append(h("span", "", "Home"), h("span", "", "/"), h("span", "", "Components"), h("span", "", "/"), h("span", "", model.pageTitle ?? model.component));
  const ver = h("div", "version");
  ver.append(h("span", "", `Version ${versionOf(model) || "\u2014"}`), icon("arrow-down", 16, 16));
  hero.append(icon("anvil-grid", 555, 172, "anvil"), bc, fieldEl("page:title", "h1"), ver);
  const content = $("#content");
  content.replaceChildren();
  const nav = $("#onpage-list");
  nav.replaceChildren();
  let body = null, first = true;
  for (const s of model.sections) {
    if (s.noTitle) {
      s.blocks.forEach((b) => content.append(blockEl(b)));
      continue;
    }
    if (s.titleLevel === "h3" || s.titleLevel === "h4") {
      if (!body) {
        const sec2 = h("section", "sec");
        body = h("div", "sec-body");
        sec2.append(body);
        content.append(sec2);
      }
      const sub = h("div", `sub ${s.titleLevel}`);
      sub.append(fieldEl(`${s.id}:title`, s.titleLevel, "Heading"));
      s.blocks.forEach((b) => sub.append(blockEl(b)));
      body.append(sub);
      continue;
    }
    if (!first) content.append(h("hr", "sep"));
    first = false;
    const sec = h("section", "sec");
    sec.id = `sec-${s.id}`;
    sec.dataset.sid = s.id;
    sec.append(fieldEl(`${s.id}:title`, "h2", "Heading"));
    body = h("div", "sec-body");
    sec.append(body);
    s.blocks.forEach((b) => body.append(blockEl(b)));
    content.append(sec);
    const a = h("a", "op-item", s.title);
    a.href = `#sec-${s.id}`;
    a.dataset.sid = s.id;
    nav.append(a);
  }
  window.scrollTo(0, y);
  flag();
  spy();
}
function spy() {
  const items = [...document.querySelectorAll("#onpage-list .op-item")];
  if (!items.length) return;
  let cur = items[0].dataset.sid;
  for (const it of items) {
    const s = document.getElementById(`sec-${it.dataset.sid}`);
    if (s && s.getBoundingClientRect().top < 140) cur = it.dataset.sid;
  }
  items.forEach((it) => it.classList.toggle("on", it.dataset.sid === cur));
}
window.addEventListener("scroll", spy, { passive: true });
function refreshField(key) {
  const old = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!old) return renderPage();
  old.replaceWith(fieldEl(key, old.dataset.tag, old.dataset.ph));
  flag();
}
function flag() {
  const worst = /* @__PURE__ */ new Map();
  for (const f of findings) if (f.severity !== "info") {
    for (const [k, fl] of F) if (fl.where === f.where && worst.get(k) !== "error") worst.set(k, f.severity);
  }
  document.querySelectorAll("#page [data-key]").forEach((el) => {
    el.classList.remove("flag-error", "flag-warning", "sel");
    const w = worst.get(el.dataset.key);
    if (w) el.classList.add(`flag-${w}`);
    if (el.dataset.key === selKey) el.classList.add("sel");
  });
}
function jump(key) {
  const el = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}
var keysAt = (f) => {
  const exact = [...F.values()].filter((x) => x.where === f.where).map((x) => x.key);
  if (exact.length) return exact;
  const sec = model.sections.find((s) => s.title === f.where);
  return sec && !sec.noTitle ? [`${sec.id}:title`] : [];
};
var me = () => $("#name").value.trim() || "Someone";
var suggesting = () => $("#suggest").checked;
function log(f, old, val, kind, author = me(), acceptedBy) {
  review2.history.push({ key: f.key, label: f.label, section: f.section, old, new: val, author, time: now(), kind, ...acceptedBy ? { acceptedBy } : {} });
}
function commit(key, val, kind = "edit") {
  const f = F.get(key);
  if (!f || locked()) return;
  const old = f.get();
  if (old === val) return refreshField(key);
  if (suggesting() && kind !== "restore") review2.suggestions.push({ id: uid(), key, label: f.label, section: f.section, old, new: val, author: me(), time: now(), status: "open" });
  else {
    f.set(val);
    log(f, old, val, kind);
  }
  changed(key);
}
function changed(key) {
  F = collect(model);
  findings = auditModel(model, rules2);
  if (key) refreshField(key);
  else renderPage();
  renderSide();
  renderBar();
  save();
}
function decide(id, accept) {
  const s = review2.suggestions.find((x) => x.id === id);
  if (!s || s.status !== "open") return;
  const f = F.get(s.key);
  if (accept && f) {
    const old = f.get();
    f.set(s.new);
    log(f, old, s.new, "suggestion", s.author, me());
  }
  s.status = accept ? "accepted" : "rejected";
  s.by = me();
  s.byTime = now();
  changed(s.key);
}
function save() {
  dirty = true;
  store.set(`draft:${slug2}`, JSON.stringify({ model, review: review2 }));
  $("#saved").textContent = "Changes not saved to GitHub yet";
  renderBar();
}
var stamp = () => (/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
var toastTimer = 0;
function toast(msg, kind, link) {
  const t = $("#toast");
  t.className = `toast ${kind}`;
  t.replaceChildren();
  const icon2 = kind === "busy" ? "\u23F3" : kind === "ok" ? "\u2705" : "\u26A0\uFE0F";
  t.append(h("span", "toast-icon", icon2), h("span", "", msg));
  if (link) {
    const a = h("a", "", link.text);
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener";
    t.append(a);
  }
  const close = h("button", "toast-x", "\u2715");
  close.addEventListener("click", () => t.hidden = true);
  t.append(close);
  t.hidden = false;
  clearTimeout(toastTimer);
  if (kind === "ok") toastTimer = window.setTimeout(() => t.hidden = true, 8e3);
}
var saveChain = Promise.resolve();
function commitVersion(message) {
  const run = saveChain.then(() => doCommit(message));
  saveChain = run.catch(() => void 0);
  return run;
}
async function doCommit(message) {
  toast("Saving to GitHub\u2026", "busy");
  $("#commit").disabled = true;
  $("#commit").textContent = "Saving\u2026";
  docRef.model = model;
  const dir = `content/${slug2}`;
  const files = [
    { path: `${dir}/guideline.json`, content: JSON.stringify(docRef, null, 2) + "\n" },
    { path: `${dir}/guideline.md`, content: renderGuidelineMd(model, docRef.meta ?? {}) },
    { path: `${dir}/review/suggestions.json`, content: JSON.stringify(review2.suggestions, null, 2) + "\n" },
    { path: `${dir}/review/history.json`, content: JSON.stringify(review2.history, null, 2) + "\n" },
    { path: `${dir}/review/state.json`, content: JSON.stringify(review2.state, null, 2) + "\n" }
  ];
  for (const [path, p] of pending) files.push({ path, base64: p.b64 });
  const r = await commitFiles(targetBranch(), files, message);
  branch = r.branch;
  pending.clear();
  dirty = false;
  store.set(`draft:${slug2}`, "");
  imgBust = Date.now();
  $("#saved").textContent = `Saved to GitHub ${stamp()} \xB7 ${branch}`;
  const short = r.sha.slice(0, 7);
  lastCommitUrl = `https://github.com/${REPO}/commit/${r.sha}`;
  store.set(`commit:${branch}`, lastCommitUrl);
  toast(
    `Saved to GitHub at ${stamp()}. Version ${short} is on branch ${branch}.`,
    "ok",
    { href: `https://github.com/${REPO}/commit/${r.sha}`, text: "See the change on GitHub" }
  );
  renderBar();
}
function saveFailed(e) {
  const msg = `Not saved: ${e.message}`;
  toast(msg, "err");
  $("#saved").textContent = msg;
  renderBar();
}
function fixOf(f) {
  const onText = (kind, v, fn) => {
    if (kind === "plain") return fn(v);
    const doc = new DOMParser().parseFromString(`<body>${v}</body>`, "text/html");
    const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) w.currentNode.nodeValue = fn(w.currentNode.nodeValue ?? "");
    return clean(doc.body.innerHTML, kind === "inline");
  };
  if (f.rule === "terminology") {
    const m = f.message.match(/^Use "(.+?)", not "(.+?)"/);
    if (!m) return null;
    const re = new RegExp(`\\b${m[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    return (v, k) => onText(k, v, (t) => t.replace(re, (x) => /^[A-Z]/.test(x) ? m[1][0].toUpperCase() + m[1].slice(1) : m[1]));
  }
  if (f.rule === "heading-ampersand") return (v, k) => onText(k, v, (t) => t.replace(/\s*&\s*/g, " and "));
  if (f.rule === "heading-punctuation") return (v, k) => onText(k, v, (t) => t.replace(/[.:;,]+$/, ""));
  if (f.rule === "link-protocol") return (v) => v.replace(/href="http:\/\//g, 'href="https://');
  return null;
}
function applyFix(f) {
  const fx = fixOf(f);
  if (!fx) return;
  for (const k of keysAt(f)) {
    const fl = F.get(k);
    const v = fx(fl.get(), fl.kind);
    if (v !== fl.get()) commit(k, v, "fix");
  }
}
var errors = () => findings.filter((f) => f.severity === "error").length;
var opens = () => review2.suggestions.filter((s) => s.status === "open");
function changesVsBaseline() {
  if (!baseline) return [];
  const B = collect(baseline);
  return [...F.values()].filter((f) => B.has(f.key) && B.get(f.key).get() !== f.get()).map((f) => ({ f, old: B.get(f.key).get() }));
}
function card(top, body, key) {
  const c = h("div", key ? "card click" : "card");
  const t = h("div", "top");
  t.append(...top);
  c.append(t);
  if (body) {
    const x = h("div", "txt");
    x.append(body);
    c.append(x);
  }
  if (key) c.addEventListener("click", (e) => {
    if (!e.target.closest("button")) jump(key);
  });
  return c;
}
var btn = (text, fn, cls = "small") => {
  const b = h("button", cls, text);
  b.addEventListener("click", fn);
  return b;
};
function renderSide() {
  const ch = changesVsBaseline();
  const counts = { checks: [findings.filter((f) => f.severity !== "info").length, errors() > 0], changes: [ch.length + opens().length, false], history: [review2.history.length, false], jira: [0, false] };
  document.querySelectorAll("#tabs button").forEach((b) => {
    const id = b.dataset.tab;
    b.classList.toggle("on", id === tab);
    b.querySelector(".n")?.remove();
    if (counts[id][0]) b.append(h("span", counts[id][1] ? "n bad" : "n", String(counts[id][0])));
  });
  const db = $("#drawerBtn");
  db.replaceChildren(document.createTextNode("Review panel"));
  if (errors()) db.append(h("span", "n bad", String(errors())));
  else if (opens().length) db.append(h("span", "n", String(opens().length)));
  const p = $("#panel");
  p.replaceChildren();
  if (tab === "checks") {
    const s = h("div", "sum");
    s.append(h("strong", "", errors() ? `${errors()} to fix` : "No errors"), h("span", "muted", `${findings.filter((f) => f.severity === "warning").length} to look at \xB7 ${findings.filter((f) => f.severity === "info").length} notes`));
    p.append(s);
    const order = { error: 0, warning: 1, info: 2 };
    for (const f of [...findings].sort((a, b) => order[a.severity] - order[b.severity])) {
      const keys = keysAt(f);
      const c = card([h("span", `sev ${f.severity}`, f.severity === "error" ? "Fix" : f.severity === "warning" ? "Look" : "Note"), f.where], document.createTextNode(f.message + (f.suggestion ? `
\u2192 ${f.suggestion}` : "")), keys[0]);
      if (fixOf(f) && keys.length && !locked()) {
        const r = h("div", "row");
        r.append(btn(suggesting() ? "Suggest this fix" : "Fix", () => applyFix(f), "small primary"));
        c.append(r);
      }
      p.append(c);
    }
  }
  if (tab === "changes") {
    const s = h("div", "sum");
    s.append(h("strong", "", `${ch.length} changed`), h("span", "muted", `${opens().length} open suggestions \xB7 compared with the last saved version in git`));
    p.append(s);
    if (!baseline) p.append(h("p", "muted", "No earlier version to compare with."));
    if (opens().length) p.append(h("h5", "", "Open suggestions"));
    for (const sg of opens()) {
      const f = F.get(sg.key);
      const c = card([h("strong", "", sg.label), sg.section, `\xB7 ${sg.author}`], diffNode(toText(sg.old, f?.kind ?? "plain"), toText(sg.new, f?.kind ?? "plain")), sg.key);
      const r = h("div", "row");
      r.append(btn("Accept", () => decide(sg.id, true), "small ok"), btn("Reject", () => decide(sg.id, false)));
      c.append(r);
      p.append(c);
    }
    if (opens().length > 1) p.append(btn("Accept all suggestions", () => opens().forEach((x) => decide(x.id, true)), "small ok"));
    if (ch.length) p.append(h("h5", "", "Changed in the article"));
    for (const { f, old } of ch) p.append(card([h("strong", "", f.label), f.section], diffNode(toText(old, f.kind), toText(f.get(), f.kind)), f.key));
    if (review2.history.length) {
      p.append(h("h5", "", "Copy change report"));
      p.append(btn("Copy report as a table", () => navigator.clipboard?.writeText(report()).then(() => {
        $("#saved").textContent = "Report copied";
      })));
    }
  }
  if (tab === "history") {
    const list = review2.history.filter((x) => !selKey || x.key === selKey).slice().reverse();
    const s = h("div", "sum");
    s.append(h("strong", "", selKey ? `${F.get(selKey)?.label ?? "Block"} \xB7 ${F.get(selKey)?.section ?? ""}` : "All changes"));
    if (selKey) s.append(btn("Show all", () => {
      selKey = "";
      flag();
      renderSide();
    }));
    p.append(s);
    if (!list.length) p.append(h("p", "muted", selKey ? "No changes to this text yet. Click another text, or Show all." : "No changes yet."));
    const W = { edit: "changed by", suggestion: "suggested by", fix: "check fix by", restore: "brought back by", image: "image replaced by" };
    for (const x of list) {
      const f = F.get(x.key);
      const body = x.kind === "image" ? document.createTextNode(x.old ? "A new picture was put in. The old picture is kept." : "A picture was added.") : diffNode(toText(x.old, f?.kind ?? "plain"), toText(x.new, f?.kind ?? "plain"));
      const c = card([h("strong", "", x.label), `${W[x.kind]} ${x.author}`, x.acceptedBy ? `\xB7 accepted by ${x.acceptedBy}` : "", `\xB7 ${when(x.time)}`], body, x.key);
      if (x.kind === "image" && x.old) {
        const a = h("a", "", "See the old picture");
        a.href = x.old;
        a.target = "_blank";
        c.append(a);
      } else if (f && x.kind !== "image" && f.get() !== x.old && !locked()) {
        const r = h("div", "row");
        r.append(btn("Bring this old wording back", () => {
          const cur = f.get();
          f.set(x.old);
          log(f, cur, x.old, "restore");
          changed(f.key);
        }));
        c.append(r);
      }
      p.append(c);
    }
  }
  if (tab === "jira") {
    const inp = h("input", "jirakey");
    inp.placeholder = "Jira key, for example FIORIDESIGN-17845";
    inp.value = review2.state.jira ?? "";
    inp.addEventListener("change", () => {
      const raw = inp.value.trim();
      const m = raw.match(/[A-Za-z][A-Za-z0-9]+-\d+/);
      if (!raw) {
        review2.state.jira = void 0;
      } else if (m) {
        review2.state.jira = m[0].toUpperCase();
      } else {
        review2.state.jira = raw;
      }
      save();
      renderSide();
    });
    const key = review2.state.jira?.match(JIRA_KEY)?.[0];
    const jiraWrap = h("div", "jira-task");
    jiraWrap.append(inp);
    if (key) {
      const a = h("a", "", `Open ${key} in Jira \u2197`);
      a.href = `${JIRA_BASE}/${key}`;
      a.target = "_blank";
      a.rel = "noopener";
      jiraWrap.append(a);
    }
    p.append(h("h5", "", "Jira task"), jiraWrap, h("h5", "", "Status card (one comment, always current)"), h("pre", "jira", statusCard()));
    p.append(h("h5", "", "Sign-off lines (one comment per click)"));
    const lines = (review2.state.signoffs ?? []).map(signLine);
    p.append(h("pre", "jira", lines.length ? lines.join("\n") : "No sign-offs yet."));
    p.append(h("p", "muted", "Preview only. Jira is not connected yet. The GitHub pull request is the record for now."));
  }
}
var cell2 = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
function report() {
  const rows = review2.history.filter((x) => x.kind !== "image").map((x) => {
    const k = F.get(x.key)?.kind ?? "plain";
    return `| ${cell2(x.section)} \xB7 ${x.label} | ${cell2(toText(x.old, k))} | ${cell2(toText(x.new, k))} | ${x.author} | ${x.acceptedBy ?? "-"} | ${when(x.time)} |`;
  });
  const rej = review2.suggestions.filter((s) => s.status === "rejected").map((s) => {
    const k = F.get(s.key)?.kind ?? "plain";
    return `| ${cell2(s.section)} \xB7 ${s.label} | ${cell2(toText(s.old, k))} | ~~${cell2(toText(s.new, k))}~~ (rejected) | ${s.author} | rejected by ${s.by} | ${when(s.byTime ?? s.time)} |`;
  });
  return ["| Where | Old text | New text | Who | Accepted by | When |", "| --- | --- | --- | --- | --- | --- |", ...rows, ...rej].join("\n");
}
var title = () => model.pageTitle ?? model.component;
var lastSign = (role) => (review2.state.signoffs ?? []).filter((s) => s.role === role).pop();
function statusCard() {
  const st = review2.state.status ?? "draft", d = lastSign("designer"), w = lastSign("writer"), e = lastSign("editor");
  const ch = changesVsBaseline();
  const acc = ch.some((c) => /^Accessibility/i.test(c.f.section));
  const img = review2.history.some((x) => x.kind === "image") || ch.some((c) => c.f.label.startsWith("Image"));
  const warn = findings.filter((f) => f.severity === "warning").length;
  return [
    `[GitHub] ${title()} \xB7 ${review2.state.jira || "no Jira key yet"}`,
    `Designer       ${d && st !== "draft" ? `\u2705 ${d.name} \xB7 sent for review ${when(d.time)}` : "\u270F\uFE0F working"}`,
    `Checks         ${errors() ? `\u274C ${errors()} to fix` : `\u2705 0 errors \xB7 ${warn} hints`}`,
    `UX writer      ${w?.action === "approved" && (st === "ready" || st === "shipped") ? `\u2705 ${w.name} \xB7 ${when(w.time)}` : st === "changes" ? `\u21A9 changes wanted by ${w?.name}` : st === "review" ? "\u23F3 asked" : "\u2014 not asked yet"}`,
    `Accessibility  ${acc ? "\u23F3 needed (section changed)" : "\u2014 not needed (section not changed)"}`,
    `Images         ${img ? "\u23F3 needed (images changed)" : "\u2014 not needed (images not changed)"}`,
    `Editor         ${st === "shipped" ? `\u{1F680} ${e?.name} \xB7 ${when(e.time)}` : st === "ready" ? "\u23F3 can approve and ship" : "\u23F3 waits for reviews"}`
  ].join("\n");
}
function signLine(s) {
  const acc = review2.suggestions.filter((x) => x.status === "accepted").length, rej = review2.suggestions.filter((x) => x.status === "rejected").length;
  if (s.action === "sent") return `[GitHub] \u{1F4E8} Sent for review by ${s.name} \xB7 ${when(s.time)}`;
  if (s.action === "approved") return `[GitHub] \u2705 UX copy approved by ${s.name} \xB7 ${acc + rej} text suggestions (${acc} accepted, ${rej} rejected) \xB7 ${when(s.time)}`;
  if (s.action === "changes") return `[GitHub] \u21A9 Changes wanted by ${s.name} \xB7 ${opens().length} open suggestions \xB7 ${when(s.time)}`;
  return `[GitHub] \u{1F680} Approved and shipped by ${s.name} \xB7 ${when(s.time)}`;
}
var STATUS = { draft: "Draft", review: "In review", changes: "Changes wanted", ready: "Ready for AEM", shipped: "Shipped" };
async function sign(action, status) {
  if (!$("#name").value.trim()) {
    $("#name").focus();
    $("#saved").textContent = "Type your name first";
    return;
  }
  const who = me(), prevStatus = review2.state.status, n0 = review2.state.signoffs?.length ?? 0;
  try {
    (review2.state.signoffs ??= []).push({ role: $("#role").value, name: who, action, time: now() });
    review2.state.status = status;
    if (action === "sent") {
      await commitVersion(`${title()}: sent for review by ${who}`);
      const pr = await openPR(
        targetBranch(),
        `${title()} update${review2.state.jira ? ` (${review2.state.jira})` : ""}`,
        `Sent for review by ${who}.

Checks: ${errors()} errors, ${findings.filter((f) => f.severity === "warning").length} warnings.
Open text suggestions: ${opens().length}.`
      );
      review2.state.pr = pr;
      await commitVersion(`${title()}: pull request #${pr.number}`);
    } else {
      await commitVersion(`${title()}: ${action} by ${who}`);
      const n = review2.state.pr?.number ?? (await findPR(targetBranch()))?.number;
      if (n && action === "approved") await review(n, "APPROVE", `UX copy approved by ${who}`);
      if (n && action === "changes") await review(n, "REQUEST_CHANGES", `Changes wanted by ${who}`);
      if (n && action === "shipped") await merge(n);
    }
  } catch (e) {
    review2.state.signoffs = (review2.state.signoffs ?? []).slice(0, n0);
    review2.state.status = prevStatus;
    saveFailed(e);
    return;
  }
  tab = "jira";
  document.body.classList.add("drawer-open");
  renderPage();
  renderSide();
  renderBar();
}
function renderBar() {
  const st = review2.state.status ?? "draft", role = $("#role").value;
  const pill = $("#status");
  pill.textContent = STATUS[st];
  pill.className = `pill ${st}`;
  const c = $("#commit");
  c.disabled = !dirty;
  c.textContent = branch === MAIN ? "Save version (new update)" : "Save version";
  const a = $("#actions");
  a.replaceChildren();
  const add = (text, fn, cls, off = "") => {
    const b = btn(text, fn, cls);
    if (off) {
      b.disabled = true;
      b.title = off;
    }
    a.append(b);
  };
  if (role === "designer" && (st === "draft" || st === "changes")) add("Send for review", () => sign("sent", "review"), "primary", errors() ? "Fix the errors in Checks first" : "");
  if (role === "writer" && st === "review") {
    add("Ask for changes", () => sign("changes", "changes"), "");
    add("Approve", () => sign("approved", "ready"), "ok", opens().length ? "Accept or reject the open suggestions first" : "");
  }
  if (role === "editor" && st === "ready") add("Approve and ship", () => sign("shipped", "shipped"), "primary", errors() ? "Fix the errors first" : "");
  if (st === "shipped") add("Start a new update", () => {
    review2.state.status = "draft";
    renderPage();
    renderBar();
    renderSide();
    save();
  }, "");
}
var page = $("#page");
page.addEventListener("focusin", (e) => {
  const el = e.target.closest("[data-key][contenteditable=true]");
  if (!el) return;
  before = serialize(el, F.get(el.dataset.key).kind);
  selKey = el.dataset.key;
  flag();
  if (tab === "history") renderSide();
});
page.addEventListener("focusout", (e) => {
  const el = e.target.closest("[data-key][contenteditable=true]");
  if (!el) return;
  const f = F.get(el.dataset.key);
  const after = serialize(el, f.kind);
  if (after !== before) commit(f.key, after);
  else el.classList.toggle("empty", !after);
});
page.addEventListener("input", (e) => e.target.closest?.("[data-key]")?.classList.remove("empty"));
page.addEventListener("keydown", (e) => {
  const el = e.target.closest("[data-key][contenteditable=true]");
  if (!el) return;
  if (e.key === "Escape") {
    el.blur();
  }
  if (e.key === "Enter" && F.get(el.dataset.key).kind !== "html") {
    e.preventDefault();
    el.blur();
  }
});
page.addEventListener("paste", (e) => {
  if (!e.target.closest("[contenteditable=true]")) return;
  e.preventDefault();
  document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? "");
});
page.addEventListener("click", (e) => {
  const t = e.target;
  const act = t.closest("[data-act]");
  if (act) return decide(act.dataset.id, act.dataset.act === "accept");
  const a = t.closest("a");
  if (a && t.closest("[contenteditable=true]")) e.preventDefault();
  const box = t.closest(".imgbox");
  if (box && !locked()) {
    pickFor = box.dataset.img;
    $("#file").click();
  }
});
var pickFor = "";
var findImage = (id) => {
  let hit;
  const walk = (bs) => bs.forEach((b) => {
    if (b.id === id) hit = b;
    if (b.type === "columns") b.columns.forEach(walk);
  });
  model.sections.forEach((s) => walk(s.blocks));
  return hit;
};
async function upload(id, file) {
  const b = findImage(id);
  if (!b || !file) return;
  if (file.type !== "image/png") {
    $("#saved").textContent = "Use a PNG file";
    return;
  }
  const name = imageFile(b).split("/").pop();
  const path = `content/${slug2}/${imageFile(b)}`;
  const oldUrl = pending.get(path) ? "" : `${rawBase(branch)}/${path}`;
  pending.set(path, { b64: toBase64(await file.arrayBuffer()), url: URL.createObjectURL(file) });
  const f = F.get(`${id}:caption`);
  review2.history.push({ key: `${id}:caption`, label: "Image", section: f.section, old: oldUrl, new: name, author: me(), time: now(), kind: "image" });
  changed();
}
$("#file").addEventListener("change", (e) => {
  const inp = e.target;
  upload(pickFor, inp.files?.[0]);
  inp.value = "";
});
page.addEventListener("dragover", (e) => {
  const box = e.target.closest(".imgbox");
  if (box) {
    e.preventDefault();
    box.classList.add("drop");
  }
});
page.addEventListener("dragleave", (e) => e.target.closest(".imgbox")?.classList.remove("drop"));
page.addEventListener("drop", (e) => {
  const box = e.target.closest(".imgbox");
  if (!box) return;
  e.preventDefault();
  box.classList.remove("drop");
  if (!locked()) upload(box.dataset.img, e.dataTransfer?.files[0]);
});
$("#tools").addEventListener("mousedown", (e) => {
  const b = e.target.closest("[data-cmd]");
  if (!b) return;
  e.preventDefault();
  const el = document.activeElement?.closest("[data-key][contenteditable=true]");
  if (!el) return;
  const kind = F.get(el.dataset.key).kind;
  if (kind === "plain" || kind === "inline" && b.dataset.cmd.startsWith("insert")) return;
  if (b.dataset.cmd === "link") {
    const url = window.prompt("Link address (https://\u2026). Leave empty to remove the link.");
    if (url === null) return;
    if (!url.trim()) document.execCommand("unlink");
    else if (/^https?:\/\//i.test(url.trim())) document.execCommand("createLink", false, url.trim());
  } else document.execCommand(b.dataset.cmd);
});
$("#copylink").addEventListener("click", async () => {
  const url = lastCommitUrl || `https://github.com/${REPO}/commits/${branch}`;
  try {
    await navigator.clipboard.writeText(url);
    toast(`Copied: ${url}`, "ok");
  } catch {
    toast(`Could not copy. Select and copy this link: ${url}`, "err");
  }
});
$("#drawerBtn").addEventListener("click", () => document.body.classList.toggle("drawer-open"));
$("#drawerClose").addEventListener("click", () => document.body.classList.remove("drawer-open"));
$("#hints").addEventListener("change", (e) => document.body.classList.toggle("no-hints", !e.target.checked));
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  store.set("tab", tab);
  renderSide();
});
$("#name").addEventListener("change", () => store.set("name", $("#name").value));
$("#role").addEventListener("change", () => {
  const r = $("#role").value;
  store.set("role", r);
  $("#suggest").checked = r === "writer";
  renderBar();
  renderSide();
});
$("#suggest").addEventListener("change", renderSide);
$("#guideline").addEventListener("change", () => {
  location.hash = `#/${$("#guideline").value}`;
});
window.addEventListener("hashchange", route);
$("#version").addEventListener("change", () => {
  const v = $("#version").value.trim().toLowerCase();
  if (!v) {
    version = "";
    return;
  }
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(v)) {
    toast("Use a version like v1-158", "err");
    return;
  }
  location.hash = `#/${v}/${slug2}`;
});
var slugOf = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function route() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/").filter(Boolean);
  const s = slugOf(parts[parts.length - 1] ?? "");
  const v = parts.length > 1 ? parts[0].toLowerCase() : "";
  if (!s) return;
  load(s, v).catch((e) => toast(`Could not open ${s}: ${e.message}`, "err"));
}
function showMissing(s, v, pub) {
  $("#hero").replaceChildren();
  $("#onpage-list").replaceChildren();
  $("#saved").textContent = "";
  const box = $("#content");
  box.replaceChildren();
  const card2 = h("div", "missing");
  card2.append(
    h("h2", "", `${v} is not started yet`),
    h("p", "", `This guideline has no update for ${v}. The latest published version is ${pub}. Starting ${v} copies that version. Nothing changes on GitHub until you click Save version.`)
  );
  const start = btn(`Start ${v} from ${pub}`, () => load(s, v, true), "primary");
  const latest = h("a", "", `Show the latest published version (${pub})`);
  latest.href = `#/${s}`;
  card2.append(start, latest);
  box.append(card2);
}
async function load(s, v = "", allowStart = false) {
  slug2 = s;
  store.set("slug", s);
  selKey = "";
  pending.clear();
  $("#guideline").value = s;
  $("#version").value = v;
  version = v;
  const exists = v ? await branchExists(branchName(v, s)) : false;
  branch = exists ? branchName(v, s) : MAIN;
  lastCommitUrl = store.get(`commit:${branch}`);
  const doc = await readJson(`content/${s}/guideline.json`, branch, void 0);
  if (!doc) throw new Error(`No guideline.json for ${s}`);
  const pub = "v" + versionOf(doc.model ?? { component: s, sections: [] }).replace(".", "-");
  if (v && !exists && v !== pub && !allowStart) {
    showMissing(s, v, pub);
    return;
  }
  docRef = doc;
  model = doc.model;
  baseline = (await readJson(`content/${s}/guideline.json`, MAIN, { model: null })).model ?? null;
  review2 = {
    suggestions: await readJson(`content/${s}/review/suggestions.json`, branch, []),
    history: await readJson(`content/${s}/review/history.json`, branch, []),
    state: await readJson(`content/${s}/review/state.json`, branch, {})
  };
  const fromLink = new URLSearchParams(location.search).get("jira")?.match(JIRA_KEY)?.[0];
  if (fromLink && review2.state.jira !== fromLink.toUpperCase()) {
    review2.state.jira = fromLink.toUpperCase();
    save();
  }
  const draft = store.get(`draft:${s}`);
  let note = branch === MAIN ? "No open update yet. Your first save creates one." : `Open update: ${branch}`;
  if (draft) {
    try {
      const d = JSON.parse(draft);
      model = d.model;
      review2 = d.review;
      dirty = true;
      note = "Unsaved draft from this browser restored";
    } catch {
    }
  } else dirty = false;
  assignIds(model);
  if (baseline) assignIds(baseline);
  F = collect(model);
  findings = auditModel(model, rules2);
  renderPage();
  renderSide();
  renderBar();
  $("#saved").textContent = note;
}
(async () => {
  rules2 = await rules();
  const list = await listGuidelines();
  const tokenBox = $("#token");
  tokenBox.placeholder = getToken() ? "Token saved in this browser" : "Paste GitHub token";
  const showToken = (msg, ok) => {
    $("#saved").textContent = msg;
    $("#saved").style.color = ok ? "#256f3a" : "#aa0808";
  };
  const checkToken = async () => {
    if (!getToken()) {
      tokenBox.placeholder = "Paste GitHub token";
      return;
    }
    tokenBox.placeholder = "Token saved \u2713";
    renderBar();
    try {
      const who = await whoami();
      showToken(`Connected to GitHub as ${who}. You can save versions now.`, true);
    } catch (e) {
      tokenBox.placeholder = "Token not accepted";
      showToken(e.message, false);
    }
  };
  tokenBox.addEventListener("change", () => {
    const v = tokenBox.value.trim();
    if (!v) return;
    setToken(v);
    tokenBox.value = "";
    checkToken();
  });
  checkToken();
  $("#commit").addEventListener("click", async () => {
    if (!getToken()) {
      toast("No GitHub token yet. Paste it in the token box at the bottom right, then press Enter.", "err");
      return;
    }
    try {
      await commitVersion(`${title()}: saved by ${me()}`);
    } catch (e) {
      saveFailed(e);
    }
  });
  const sel = $("#guideline");
  list.forEach((g) => sel.add(new Option(g.title, g.slug)));
  $("#name").value = store.get("name");
  const role = store.get("role") || "designer";
  $("#role").value = role;
  $("#suggest").checked = role === "writer";
  const first = list.find((g) => g.slug === store.get("slug"))?.slug ?? list[0]?.slug;
  if (location.hash.length > 2) route();
  else if (first) {
    location.hash = `#/${first}`;
  }
})();
