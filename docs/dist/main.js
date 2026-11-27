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
async function startAiCheck(slug3, branch2) {
  await api(`/actions/workflows/ai-check.yml/dispatches`, { method: "POST", json: { ref: MAIN, inputs: { slug: slug3, ref: branch2 } } }, true);
}
async function latestAiRun() {
  const j = await api(`/actions/workflows/ai-check.yml/runs?event=workflow_dispatch&per_page=1`, {}, true);
  const r = j.workflow_runs?.[0];
  return r ? { status: r.status, conclusion: r.conclusion, url: r.html_url, created: r.created_at } : void 0;
}
async function requestCopilot(prNumber) {
  await api(`/pulls/${prNumber}/requested_reviewers`, { method: "POST", json: { reviewers: ["copilot-pull-request-reviewer[bot]"] } }, true);
  const pr = await api(`/pulls/${prNumber}`);
  return (pr.requested_reviewers ?? []).some((r) => /copilot/i.test(r.login));
}
async function finalCheck(slug3) {
  const list = await api(`/commits/${MAIN}/statuses?per_page=100`);
  const hit = list.find((x) => x.context === `final-check/${slug3}`);
  return hit ? { state: hit.state, description: hit.description ?? "", url: hit.target_url ?? void 0, time: hit.updated_at } : { state: "none", description: "" };
}
function toBase64(buf) {
  let s = "";
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
  return btoa(s);
}

// checks/rules.ts
var ENT3 = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
var plain2 = (h2) => h2.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENT3[m]).replace(/&nbsp;/g, "\xA0").trim();
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
  const F2 = [];
  const add = (severity, rule, message, where, text) => F2.push({ severity, agent: "content", rule, message, where, suggestion: text.length > 120 ? `${text.slice(0, 117)}\u2026` : text });
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
  return F2;
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
var finalCheck2 = null;
var finalTimer = 0;
var aiReport = null;
var aiTimer = 0;
var aiState = { phase: "none" };
var lcErr = (lc) => lc.errors + (lc.ai?.errors ?? 0);
var lcHints = (lc) => lc.hints + (lc.ai?.hints ?? 0);
var aiKey = (f) => `${f.original}\u2192${f.fix}`;
async function refreshFinalCheck() {
  try {
    finalCheck2 = await finalCheck(slug2);
  } catch (e) {
    finalCheck2 = { state: "error", description: e.message };
  }
  renderBar();
  if (tab === "aem") renderSide();
}
function pollFinalCheck(round = 0) {
  clearTimeout(finalTimer);
  finalTimer = window.setTimeout(async () => {
    await refreshFinalCheck();
    if ((!finalCheck2 || finalCheck2.state === "none" || finalCheck2.state === "pending") && round < 30) pollFinalCheck(round + 1);
  }, 8e3);
}
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
var review = { suggestions: [], history: [], state: {} };
var F = /* @__PURE__ */ new Map();
var findings = [];
var tab = store.get("tab") || "checks";
var selKey = "";
var before = "";
var imgBust = Date.now();
function allFindings() {
  return [...auditModel(model, rules2), ...patternFindings(model)];
}
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
var locked = () => review.state.status === "uploaded" || review.state.status === "approved";
var openSug = (key) => review.suggestions.find((s) => s.key === key && s.status === "open");
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
    const role = $("#role").value;
    if (role === "designer") {
      const ok = h("button", "small ok", "Accept");
      ok.dataset.act = "accept";
      ok.dataset.id = sug.id;
      const no = h("button", "small", "Reject");
      no.dataset.act = "reject";
      no.dataset.id = sug.id;
      meta.append(ok, no);
    } else if (sug.author === me()) {
      const ed = h("button", "small", "Edit");
      ed.dataset.act = "edit";
      ed.dataset.id = sug.id;
      const cx = h("button", "small", "Cancel");
      cx.dataset.act = "cancel";
      cx.dataset.id = sug.id;
      meta.append(ed, cx);
    } else meta.append(h("span", "muted", "Waiting for the designer"));
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
  review.history.push({ key: f.key, label: f.label, section: f.section, old, new: val, author, time: now(), kind, ...acceptedBy ? { acceptedBy } : {} });
}
function commit(key, val, kind = "edit") {
  const f = F.get(key);
  if (!f || locked()) return;
  const old = f.get();
  if (old === val) return refreshField(key);
  if (suggesting() && kind !== "restore") review.suggestions.push({ id: uid(), key, label: f.label, section: f.section, old, new: val, author: me(), time: now(), status: "open" });
  else {
    f.set(val);
    log(f, old, val, kind);
  }
  changed(key);
}
var undoStack = [];
var redoStack = [];
var lastSnap = "";
var snap = () => JSON.stringify({ model, suggestions: review.suggestions, history: review.history, aiDone: review.state.aiDone ?? [] });
function restore(s) {
  const o = JSON.parse(s);
  model = o.model;
  review.suggestions = o.suggestions;
  review.history = o.history;
  review.state.aiDone = o.aiDone;
  lastSnap = s;
  F = collect(model);
  findings = allFindings();
  renderPage();
  renderSide();
  renderBar();
  save();
}
function undo() {
  if (!undoStack.length || locked()) return;
  redoStack.push(snap());
  restore(undoStack.pop());
}
function redo() {
  if (!redoStack.length || locked()) return;
  undoStack.push(snap());
  restore(redoStack.pop());
}
function recordNow(mutate) {
  undoStack.push(snap());
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
  mutate();
  lastSnap = snap();
}
function changed(key) {
  if (lastSnap) {
    undoStack.push(lastSnap);
    if (undoStack.length > 50) undoStack.shift();
  }
  redoStack = [];
  lastSnap = snap();
  F = collect(model);
  findings = allFindings();
  if (key) refreshField(key);
  else renderPage();
  renderSide();
  renderBar();
  save();
}
function editSuggestion(id) {
  const s = review.suggestions.find((x) => x.id === id);
  if (!s || s.status !== "open") return;
  const f = F.get(s.key);
  const cur = toText(s.new, f?.kind ?? "plain");
  const v = window.prompt("Change your suggestion:", cur);
  if (v === null) return;
  const text = v.trim();
  if (!text) return;
  s.new = f?.kind === "plain" ? text : `<p>${esc2(text)}</p>`;
  s.time = now();
  changed(s.key);
}
function cancelSuggestion(id) {
  const s = review.suggestions.find((x) => x.id === id);
  if (!s || s.status !== "open") return;
  review.suggestions = review.suggestions.filter((x) => x.id !== id);
  changed(s.key);
}
function decide(id, accept) {
  const s = review.suggestions.find((x) => x.id === id);
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
  store.set(`draft:${slug2}`, JSON.stringify({ model, review }));
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
    { path: `${dir}/review/suggestions.json`, content: JSON.stringify(review.suggestions, null, 2) + "\n" },
    { path: `${dir}/review/history.json`, content: JSON.stringify(review.history, null, 2) + "\n" },
    { path: `${dir}/review/state.json`, content: JSON.stringify(review.state, null, 2) + "\n" }
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
  if (f.rule === "space-before-punctuation") return (v, k) => onText(k, v, (t) => t.replace(/\s+([,;.!?])(?=\s|$)/g, "$1"));
  if (f.rule === "missing-space-after-comma") return (v, k) => onText(k, v, (t) => t.replace(/([a-z])([,;])([A-Za-z])/g, "$1$2 $3"));
  if (f.rule === "double-space") return (v, k) => onText(k, v, (t) => t.replace(/([^\s ]) {2,}(?=[^\s])/g, "$1 "));
  if (f.rule === "repeated-word") return (v, k) => onText(k, v, (t) => t.replace(/\b([A-Za-z]{2,})(\s+\1\b)+/gi, "$1"));
  if (f.rule === "missing-comma-after-opener") return (v, k) => onText(k, v, (t) => t.replace(/(^|[.!?]\s+)(However|Therefore|Moreover|Furthermore|For example|For instance|In addition)\s+(?=[a-z])/g, "$1$2, "));
  if (f.rule === "missing-full-stop") return (v, k) => {
    if (k === "plain") return /[.!?:)]$/.test(v.trim()) ? v : `${v.trim()}.`;
    const doc = new DOMParser().parseFromString(`<body>${v}</body>`, "text/html");
    const blocks = [...doc.body.querySelectorAll("p, li")];
    if (!blocks.length) blocks.push(doc.body);
    for (const b of blocks) {
      const text = (b.textContent ?? "").trim();
      if (text.split(/\s+/).length < 4 || /[.!?:)"”’]$/.test(text)) continue;
      const w = doc.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      let last = null, n;
      while (n = w.nextNode()) if ((n.nodeValue ?? "").trim()) last = n;
      if (last) last.nodeValue = (last.nodeValue ?? "").replace(/\s+$/, "") + ".";
    }
    return clean(doc.body.innerHTML, k === "inline");
  };
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
var opens = () => review.suggestions.filter((s) => s.status === "open");
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
  const counts = { checks: [findings.filter((f) => f.severity !== "info").length, errors() > 0], changes: [ch.length + opens().length, false], history: [review.history.length, false], jira: [0, false], aem: [0, false] };
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
    {
      const top = review.state.lastCheck;
      p.append(h("p", "muted", top ? `${top.skipped ? "Check skipped" : "Last check"}: ${top.by} (${top.role}) \xB7 ${when(top.time)}` : "Nobody has run the check yet. Click Run check in the bar."));
    }
    const s = h("div", "sum");
    s.append(h("strong", "", errors() ? `${errors()} to fix` : "No errors"), h("span", "muted", `${findings.filter((f) => f.severity === "warning").length} to look at \xB7 ${findings.filter((f) => f.severity === "info").length} notes`));
    p.append(s);
    const order = { error: 0, warning: 1, info: 2 };
    const lc = review.state.lastCheck;
    renderAi(p);
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
      if ($("#role").value === "designer") r.append(btn("Accept", () => decide(sg.id, true), "small ok"), btn("Reject", () => decide(sg.id, false)));
      c.append(r);
      p.append(c);
    }
    if (opens().length > 1 && $("#role").value === "designer") p.append(btn("Accept all suggestions", () => opens().forEach((x) => decide(x.id, true)), "small ok"));
    if (ch.length) p.append(h("h5", "", "Changed in the article"));
    for (const { f, old } of ch) p.append(card([h("strong", "", f.label), f.section], diffNode(toText(old, f.kind), toText(f.get(), f.kind)), f.key));
    if (review.history.length) {
      p.append(h("h5", "", "Copy change report"));
      p.append(btn("Copy report as a table", () => navigator.clipboard?.writeText(report()).then(() => {
        $("#saved").textContent = "Report copied";
      })));
    }
  }
  if (tab === "history") {
    const list = review.history.filter((x) => !selKey || x.key === selKey).slice().reverse();
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
  if (tab === "aem") renderAem(p);
  if (tab === "jira") {
    const inp = h("input", "jirakey");
    inp.placeholder = "Jira key, for example FIORIDESIGN-17845";
    inp.value = review.state.jira ?? "";
    inp.addEventListener("change", () => {
      const raw = inp.value.trim();
      const m = raw.match(/[A-Za-z][A-Za-z0-9]+-\d+/);
      if (!raw) {
        review.state.jira = void 0;
      } else if (m) {
        review.state.jira = m[0].toUpperCase();
      } else {
        review.state.jira = raw;
      }
      save();
      renderSide();
    });
    const key = review.state.jira?.match(JIRA_KEY)?.[0];
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
    const lines = (review.state.signoffs ?? []).map(signLine);
    p.append(h("pre", "jira", lines.length ? lines.join("\n") : "No sign-offs yet."));
    p.append(h("p", "muted", "Preview only. Jira is not connected yet. The GitHub pull request is the record for now."));
  }
}
function renderFinalCheck(p, ready) {
  p.append(h("h5", "", "Final check before AEM"));
  if (!ready) {
    p.append(h("p", "muted", "Runs by itself after the editor clicks Approve. It checks the rules, wording, full stops, commas, alt text and links."));
    return;
  }
  const fc = finalCheck2, wrap = h("div", "fc");
  const say = (icon2, text) => wrap.append(h("p", "", `${icon2} ${text}`));
  if (!fc || fc.state === "none" || fc.state === "pending") say("\u23F3", "Running. This takes about a minute.");
  else if (fc.state === "success") say("\u2705", `Passed. ${fc.description}`);
  else if (fc.state === "failure") say("\u274C", `Not passed. ${fc.description}`);
  else say("\u26A0\uFE0F", `Could not read the result. ${fc.description}`);
  if (fc?.url) {
    const a = h("a", "", "Open the full report \u2197");
    a.href = fc.url;
    a.target = "_blank";
    a.rel = "noopener";
    wrap.append(a);
  }
  const again = h("button", "small", "Refresh");
  again.addEventListener("click", () => {
    finalCheck2 = null;
    renderSide();
    refreshFinalCheck();
  });
  wrap.append(again);
  if (fc?.state === "failure") wrap.append(h("p", "muted", "Fix the problems yourself, or click Send back to designer. You can also skip the check if you checked the article by hand: you are asked before the upload."));
  p.append(wrap);
}
function renderAem(p) {
  const stage = review.state.status ?? "draft";
  const ready = stage === "approved" || stage === "uploaded";
  const base = store.get("aem:base"), section = store.get("aem:section") || "ui-elements";
  const link = (text, href) => {
    const a = h("a", "", text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  };
  const line = (...n) => {
    const d = h("div", "aem-line");
    d.append(...n);
    return d;
  };
  p.append(h("h5", "", "Status"), h("p", "", ready ? "\u2705 Approved in GitHub. Ready for AEM." : `Not ready yet. The article is "${STATUS[stage]}". The editor approves first.`));
  renderFinalCheck(p, ready);
  p.append(h("h5", "", "Where it goes in AEM"));
  const baseIn = h("input", "jirakey");
  baseIn.placeholder = "AEM folder link of the guidelines (paste once)";
  baseIn.value = base;
  baseIn.addEventListener("change", () => {
    store.set("aem:base", baseIn.value.trim());
    renderSide();
  });
  const secIn = h("input", "jirakey");
  secIn.placeholder = "Section folder, for example ui-elements";
  secIn.value = section;
  secIn.addEventListener("change", () => {
    store.set("aem:section", secIn.value.trim() || "ui-elements");
    renderSide();
  });
  p.append(baseIn, secIn);
  if (!version) p.append(h("p", "muted", "Set the version in the bar first, for example v1-157."));
  else {
    const path = `${version}/${section}/${slug2}`;
    p.append(h("p", "", `AEM page: ${path}`));
    if (/^https:\/\//.test(base)) p.append(link("Open this place in AEM \u2197", `${base.replace(/\/+$/, "")}/${path}`));
    else p.append(h("p", "muted", "Paste the AEM folder link above to get a link to this place."));
  }
  p.append(h("h5", "", "Approved content in GitHub (main)"));
  const rawBase2 = `https://raw.githubusercontent.com/${REPO}/${MAIN}/content/${slug2}`;
  p.append(
    line(link("Content (guideline.json) \u2197", `${rawBase2}/guideline.json`)),
    line(link("Text (guideline.md) \u2197", `${rawBase2}/guideline.md`)),
    line(link("Images folder \u2197", `https://github.com/${REPO}/tree/${MAIN}/content/${slug2}/images`))
  );
  p.append(h("h5", "", "Upload to AEM"));
  p.append(h("p", "muted", "Not automatic yet. The editor takes the approved content from the links above and fills the AEM template page. When it is in AEM, click Mark uploaded to AEM in the bar."));
}
var cell2 = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
function report() {
  const rows = review.history.filter((x) => x.kind !== "image").map((x) => {
    const k = F.get(x.key)?.kind ?? "plain";
    return `| ${cell2(x.section)} \xB7 ${x.label} | ${cell2(toText(x.old, k))} | ${cell2(toText(x.new, k))} | ${x.author} | ${x.acceptedBy ?? "-"} | ${when(x.time)} |`;
  });
  const rej = review.suggestions.filter((s) => s.status === "rejected").map((s) => {
    const k = F.get(s.key)?.kind ?? "plain";
    return `| ${cell2(s.section)} \xB7 ${s.label} | ${cell2(toText(s.old, k))} | ~~${cell2(toText(s.new, k))}~~ (rejected) | ${s.author} | rejected by ${s.by} | ${when(s.byTime ?? s.time)} |`;
  });
  return ["| Where | Old text | New text | Who | Accepted by | When |", "| --- | --- | --- | --- | --- | --- |", ...rows, ...rej].join("\n");
}
var title = () => model.pageTitle ?? model.component;
var lastSign = (role) => (review.state.signoffs ?? []).filter((s) => s.role === role).pop();
function statusCard() {
  const st = review.state.status ?? "draft", ed = lastSign("editor");
  const ch = changesVsBaseline();
  const acc = ch.some((c) => /^Accessibility/i.test(c.f.section));
  const img = review.history.some((x) => x.kind === "image");
  const warn = findings.filter((f) => f.severity === "warning").length;
  const after = (...s) => s.includes(st);
  return [
    `[GitHub] ${title()} \xB7 ${review.state.jira || "no Jira key yet"}`,
    `Designer       ${st === "draft" ? "\u270F\uFE0F writing" : st === "designer" ? "\u23F3 deciding on suggestions" : "\u2705 done"}`,
    `Checks         ${errors() ? `\u274C ${errors()} to fix` : `\u2705 0 errors \xB7 ${warn} hints`}`,
    `UX writer      ${st === "writer" ? "\u23F3 checking the text" : st === "draft" ? "\u2014 not asked yet" : "\u2705 done"}`,
    `Accessibility  ${acc ? "\u23F3 needed (section changed)" : "\u2014 not needed (section not changed)"}`,
    `Images         ${img ? "\u23F3 needed (images changed)" : "\u2014 not needed (images not changed)"}`,
    `Editor         ${after("approved", "uploaded") ? `\u2705 ${ed?.name ?? ""} approved` : st === "editor" ? "\u23F3 reviewing the page" : "\u2014 waits for the designer"}`,
    `AEM            ${st === "uploaded" ? "\u{1F680} uploaded" : st === "approved" ? "\u23F3 ready to upload" : "\u2014 not yet"}`
  ].join("\n");
}
function signLine(s) {
  const acc = review.suggestions.filter((x) => x.status === "accepted").length, rej = review.suggestions.filter((x) => x.status === "rejected").length;
  const at = when(s.time);
  switch (s.action) {
    case "sent":
    case "to-writer":
      return `[GitHub] \u{1F4E8} Sent to UX writer by ${s.name} \xB7 ${at}`;
    case "returned":
      return `[GitHub] \u21A9 Returned to designer by ${s.name} \xB7 ${opens().length} open suggestions \xB7 ${at}`;
    case "to-editor":
      return `[GitHub] \u{1F4E8} Sent to editor by ${s.name} \xB7 ${acc + rej} suggestions decided (${acc} accepted, ${rej} rejected) \xB7 ${at}`;
    case "back":
      return `[GitHub] \u21A9 Sent back to designer by ${s.name} \xB7 ${at}`;
    case "approved":
      return `[GitHub] \u2705 Approved by ${s.name}. The article is done in GitHub \xB7 ${at}`;
    case "uploaded":
      return `[GitHub] \u{1F680} Uploaded to AEM by ${s.name} \xB7 ${at}`;
    default:
      return `[GitHub] ${s.action} by ${s.name} \xB7 ${at}`;
  }
}
var STATUS = { draft: "Draft", writer: "With UX writer", designer: "With designer", editor: "In editor review", approved: "Approved \xB7 ready for AEM", uploaded: "In AEM" };
var LEGACY = { review: "writer", changes: "designer", ready: "editor", shipped: "approved" };
async function sign(action, status) {
  if (action === "approved" && $("#role").value !== "editor") {
    toast("Only the editor can approve. Approve opens the pull request and merges it.", "err");
    return;
  }
  if (!$("#name").value.trim()) {
    $("#name").focus();
    $("#saved").textContent = "Type your name first";
    return;
  }
  const who = me(), prevStatus = review.state.status, n0 = review.state.signoffs?.length ?? 0;
  try {
    (review.state.signoffs ??= []).push({ role: $("#role").value, name: who, action, time: now() });
    review.state.status = status;
    const said = { sent: "sent to UX writer", "to-writer": "sent to UX writer", "to-editor": "sent to editor", returned: "returned to designer", back: "sent back to designer", approved: "approved", uploaded: "marked uploaded to AEM" };
    await commitVersion(`${title()}: ${said[action] ?? action} by ${who}`);
    if (action === "approved") {
      const lc = review.state.lastCheck;
      let pr = review.state.pr ?? await findPR(targetBranch());
      if (!pr) pr = await openPR(
        targetBranch(),
        `${title()} update${review.state.jira ? ` (${review.state.jira})` : ""}`,
        `Approved by ${who} (editor).

${lc ? `${lc.skipped ? "Check skipped" : "Check run"} by ${lc.by} on ${lc.time}: ${lcErr(lc)} errors, ${lcHints(lc)} recommendations, ${lc.fixes} fixes made.` : "No check was run."}`
      );
      review.state.pr = pr;
      await commitVersion(`${title()}: pull request #${pr.number}`);
      await merge(pr.number);
    }
  } catch (e) {
    review.state.signoffs = (review.state.signoffs ?? []).slice(0, n0);
    review.state.status = prevStatus;
    saveFailed(e);
    return;
  }
  if (status === "approved") {
    finalCheck2 = null;
    pollFinalCheck();
  }
  tab = status === "approved" ? "aem" : "jira";
  document.body.classList.add("drawer-open");
  renderPage();
  renderSide();
  renderBar();
}
function renderBar() {
  const raw = review.state.status ?? "draft", st = LEGACY[raw] ?? raw, role = $("#role").value;
  const pill = $("#status");
  pill.textContent = STATUS[st];
  pill.className = `pill ${st}`;
  const lc = review.state.lastCheck, mark = $("#checkbadge"), stale = checkIsStale();
  const nice = (x) => new Date(x).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (!lc) {
    mark.className = "checkbadge none";
    mark.textContent = "No check run yet";
    mark.title = "Click Run check. A person can also skip it and check by hand.";
  } else if (lc.skipped) {
    mark.className = `checkbadge skipped${stale ? " stale" : ""}`;
    mark.textContent = "\u23ED Check skipped";
    mark.title = "A person checked the article by hand.";
  } else if (lcErr(lc) === 0) {
    mark.className = `checkbadge pass${stale ? " stale" : ""}`;
    mark.textContent = "\u2713 Check passed";
    mark.title = "Click to see the report.";
  } else {
    mark.className = `checkbadge fail${stale ? " stale" : ""}`;
    mark.textContent = `\u26A0 Check found ${lcErr(lc)} error${lcErr(lc) === 1 ? "" : "s"}`;
    mark.title = "Click to see the report.";
  }
  const c = $("#commit");
  c.disabled = !dirty;
  c.textContent = branch === MAIN ? "Save version (new update)" : "Save version";
  $("#undo").disabled = !undoStack.length || locked();
  $("#redo").disabled = !redoStack.length || locked();
  const cl = $("#commitlink");
  cl.href = lastCommitUrl || `https://github.com/${REPO}/commits/${branch}`;
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
  const stage = st in LEGACY ? LEGACY[st] : st;
  const toEditorBlock = opens().length ? "Open suggestions are waiting for the designer to accept or reject" : errors() ? "Run the check and fix the errors first" : "";
  if (role === "designer" && (stage === "draft" || stage === "designer")) {
    add("Send to UX writer", () => sign(stage === "draft" ? "sent" : "to-writer", "writer"), stage === "draft" ? "primary" : "", stage === "draft" && errors() ? "Fix the errors in Checks first" : "");
    add("Send to editor", () => sign("to-editor", "editor"), "ok", toEditorBlock);
  }
  if (role === "writer" && stage === "writer") {
    add("Return to designer", () => sign("returned", "designer"), "primary");
    add("Send to editor", () => sign("to-editor", "editor"), "ok", toEditorBlock);
  }
  if (role === "editor" && stage === "editor") {
    add("Send back to designer", () => sign("back", "designer"), "");
    add("Approve", async () => {
      if (await gateOk()) sign("approved", "approved");
    }, "ok", opens().length ? "Open suggestions are still waiting for the designer" : "");
  }
  if (role === "editor" && stage === "approved") {
    const fc = finalCheck2?.state;
    if (fc === "failure") add("Send back to designer", () => sign("back", "designer"), "");
    add("Mark uploaded to AEM", async () => {
      if (await gateOk()) sign("uploaded", "uploaded");
    }, "primary");
  }
  if (stage === "uploaded") add("Start a new update", () => {
    review.state.status = "draft";
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
  if (act) {
    if (act.dataset.act === "edit") return editSuggestion(act.dataset.id);
    if (act.dataset.act === "cancel") return cancelSuggestion(act.dataset.id);
    return decide(act.dataset.id, act.dataset.act === "accept");
  }
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
  review.history.push({ key: `${id}:caption`, label: "Image", section: f.section, old: oldUrl, new: name, author: me(), time: now(), kind: "image" });
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
$("#checkbadge").addEventListener("click", () => {
  tab = "checks";
  document.body.classList.add("drawer-open");
  renderSide();
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
var DEFAULT_NAMES = { designer: "Veni", writer: "Alex", editor: "Krisi" };
var namesByRole = () => {
  try {
    return { ...DEFAULT_NAMES, ...JSON.parse(store.get("names") || "{}") };
  } catch {
    return { ...DEFAULT_NAMES };
  }
};
var shownName = (role) => namesByRole()[role] ?? "";
$("#name").addEventListener("change", () => {
  const r = $("#role").value;
  const all = namesByRole();
  all[r] = $("#name").value.trim();
  store.set("names", JSON.stringify(all));
});
$("#role").addEventListener("change", () => {
  const r = $("#role").value;
  store.set("role", r);
  $("#name").value = shownName(r);
  $("#suggest").checked = r === "writer";
  renderPage();
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
  let s = slugOf(parts[parts.length - 1] ?? "");
  const v = parts.length > 1 ? parts[0].toLowerCase() : "";
  if (!s) return;
  if (guidelines.length && !guidelines.some((g) => g.slug === s)) {
    const near = guidelines.filter((g) => g.slug.startsWith(s) || slugOf(g.title).startsWith(s));
    if (near.length !== 1) {
      showUnknown(s, v);
      return;
    }
    s = near[0].slug;
  }
  const canon = `#/${v ? `${v}/` : ""}${s}`;
  if (location.hash !== canon) history.replaceState(null, "", canon);
  load(s, v).catch((e) => toast(`Could not open ${s}: ${e.message}`, "err"));
}
var guidelines = [];
function showUnknown(name, v) {
  $("#hero").replaceChildren();
  $("#onpage-list").replaceChildren();
  $("#saved").textContent = "";
  const box = $("#content");
  box.replaceChildren();
  const card2 = h("div", "missing");
  card2.append(h("h2", "", `No guideline named "${name}"`), h("p", "", "Pick one of these:"));
  for (const g of guidelines) {
    const a = h("a", "", g.title);
    a.href = `#/${v ? `${v}/` : ""}${g.slug}`;
    card2.append(a);
  }
  box.append(card2);
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
var fixesMade = () => review.history.filter((x) => x.kind === "fix").length;
var lastEdit = () => review.history.reduce((m, x) => x.time > m ? x.time : m, "");
var checkIsStale = () => !!review.state.lastCheck && lastEdit() > review.state.lastCheck.time;
function skipCheck() {
  review.state.lastCheck = { by: me(), role: $("#role").value, time: now(), errors: errors(), hints: findings.filter((f) => f.severity === "warning").length, fixes: fixesMade(), copilot: "skipped, checked by a person", skipped: true };
  renderBar();
  renderSide();
  save();
}
function gateReason() {
  const lc = review.state.lastCheck, fc = finalCheck2;
  if (fc?.state === "success" || lc && !checkIsStale() && (lc.skipped || lcErr(lc) === 0)) return "";
  if (!lc && fc?.state === "failure") return `The automatic final check found errors: ${fc.description}`;
  if (!lc) return "Nobody has run the check on this version.";
  if (checkIsStale()) return `The text changed after the last check (${lc.by}, ${when(lc.time)}).`;
  return `The last check found ${lcErr(lc)} error${lcErr(lc) === 1 ? "" : "s"} (${lc.by}, ${when(lc.time)}).`;
}
function askCheck(reason) {
  return new Promise((resolve) => {
    const d = $("#gate");
    d.replaceChildren();
    let done = false;
    const end = (ok) => {
      if (done) return;
      done = true;
      if (d.open) d.close();
      resolve(ok);
    };
    d.onclose = () => end(false);
    d.append(h("h3", "", "Before this goes to AEM"), h("p", "", reason), h("p", "muted", "You decide: run the check now, or skip it if you checked the article yourself. Skipping is written in the record with your name."));
    const row = h("div", "row");
    row.append(
      btn("Run check now", () => {
        end(false);
        runCheck().catch((e) => toast(`Check failed: ${e.message}`, "err"));
      }, "small primary"),
      btn("Skip: I checked it myself", () => {
        skipCheck();
        end(true);
      }, "small"),
      btn("Cancel", () => end(false), "small")
    );
    d.append(row);
    d.showModal();
  });
}
async function gateOk() {
  const why = gateReason();
  return why ? askCheck(why) : true;
}
function replaceOnce(v, kind, original, fix) {
  if (kind === "plain") return v.includes(original) ? v.replace(original, fix) : null;
  const doc = new DOMParser().parseFromString(`<body>${v}</body>`, "text/html");
  const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let n;
  while (n = w.nextNode()) {
    const s = n.nodeValue ?? "";
    if (s.includes(original)) {
      n.nodeValue = s.replace(original, fix);
      return clean(doc.body.innerHTML, kind === "inline");
    }
  }
  return null;
}
function applyAiFix(f) {
  const hits = [...F.values()].filter((fl) => toText(fl.get(), fl.kind).includes(f.original));
  const tail = f.where.split(">").pop()?.trim().toLowerCase() ?? "";
  const pick = hits.length === 1 ? hits[0] : hits.find((fl) => tail && fl.section.toLowerCase().includes(tail)) ?? hits[0];
  const nv = pick ? replaceOnce(pick.get(), pick.kind, f.original, f.fix) : null;
  if (!pick || nv === null) {
    toast("This fix cannot be applied by itself (the text is split by bold or a link). Change it by hand.", "err");
    return;
  }
  (review.state.aiDone ??= []).push(aiKey(f));
  commit(pick.key, nv, "fix");
  jump(pick.key);
}
function applyAllAi() {
  const done = new Set(review.state.aiDone ?? []);
  const todo = (aiReport?.findings ?? []).filter((f) => !done.has(aiKey(f)));
  let applied = 0, skipped = 0;
  for (const f of todo) {
    const before2 = review.state.aiDone?.length ?? 0;
    applyAiFix(f);
    if ((review.state.aiDone?.length ?? 0) > before2) applied++;
    else skipped++;
  }
  toast(`Applied ${applied} fix${applied === 1 ? "" : "es"}${skipped ? `. ${skipped} could not be applied by itself: change those by hand.` : "."}`, skipped ? "err" : "ok");
  renderSide();
}
function dismissAllAi() {
  recordNow(() => {
    if (aiReport) review.state.aiDone = aiReport.findings.map(aiKey);
  });
  review.state.lastCheck = void 0;
  renderBar();
  renderSide();
  save();
  toast("All AI findings dismissed. The check is cleared.", "ok");
}
function dismissAi(f) {
  recordNow(() => {
    (review.state.aiDone ??= []).push(aiKey(f));
  });
  save();
  renderSide();
}
function renderAi(p) {
  const box = h("div", "ai-box");
  const done = new Set(review.state.aiDone ?? []);
  if (aiState.phase === "running") box.append(h("p", "", "\u23F3 AI check (Claude) is running. About a minute."));
  if (aiState.phase === "failed") {
    box.append(h("p", "", `\u26A0 AI check: ${aiState.msg}`));
    if (aiState.url) {
      const a = h("a", "", "Open the job on GitHub \u2197");
      a.href = aiState.url;
      a.target = "_blank";
      a.rel = "noopener";
      box.append(a);
    }
  }
  const open = aiReport ? aiReport.findings.filter((f) => !done.has(aiKey(f))) : [];
  if (aiReport) box.append(h("p", "ai-line", `AI check (${aiReport.model}) \xB7 ${when(aiReport.time)} \xB7 ${aiReport.errors} errors, ${aiReport.hints} hints \xB7 ${open.length} still open`));
  else if (aiState.phase === "none") box.append(h("p", "muted", "AI check: not run yet. Click Run check in the bar."));
  p.append(box);
  if (open.length) {
    const all = h("div", "row ai-all");
    all.append(
      btn(`Apply all ${open.length} fixes`, () => applyAllAi(), "small primary"),
      btn("Dismiss all and clear the check", () => dismissAllAi(), "small")
    );
    p.append(all);
  }
  for (const f of open) {
    const c = card([h("span", `sev ${f.severity === "error" ? "error" : "warning"}`, f.severity === "error" ? "AI error" : "AI hint"), f.where], document.createTextNode(`${f.problem}
Now: ${f.original}
Fix: ${f.fix}`));
    const r = h("div", "row");
    r.append(btn("Apply fix", () => applyAiFix(f), "small primary"), btn("Dismiss", () => dismissAi(f), "small"));
    c.append(r);
    p.append(c);
  }
}
async function startAiCheck2() {
  if (!getToken() || !version || branch === MAIN) {
    aiState = { phase: "failed", msg: !getToken() ? "Paste your GitHub token first." : "Save a version first. The AI reads the saved version on GitHub." };
    renderSide();
    toast(`AI check not started. ${aiState.msg}`, "err");
    return;
  }
  try {
    if (dirty) await commitVersion(`${title()}: saved before the AI check by ${me()}`);
    const since = Date.now() - 6e4;
    await startAiCheck(slug2, targetBranch());
    aiState = { phase: "running" };
    renderSide();
    toast("AI check started (Claude). The report comes back in about a minute.", "busy");
    pollAi(since);
  } catch (e) {
    const m = e.message, hint = /not accessible|forbidden|Not Found|403|404/i.test(m) ? " Add Actions: read and write to your GitHub token." : "";
    aiState = { phase: "failed", msg: m + hint };
    renderSide();
    toast(`AI check not started: ${m}${hint}`, "err");
  }
}
function pollAi(since, round = 0) {
  clearTimeout(aiTimer);
  aiTimer = window.setTimeout(async () => {
    try {
      const run = await latestAiRun();
      if (run && Date.parse(run.created) >= since && run.status === "completed") {
        if (run.conclusion === "success") {
          aiReport = await readJson(`content/${slug2}/review/ai-report.json`, `reports/${targetBranch()}`, null);
          aiState = { phase: "done" };
          review.state.aiDone = [];
          const lc = review.state.lastCheck;
          if (lc && aiReport) lc.ai = { errors: aiReport.errors, hints: aiReport.hints, model: aiReport.model, time: aiReport.time };
          renderBar();
          renderSide();
          save();
          toast(`AI check done: ${aiReport?.errors ?? 0} errors, ${aiReport?.hints ?? 0} hints.`, aiReport?.errors ? "err" : "ok");
        } else {
          aiState = { phase: "failed", msg: "The AI job failed. Most likely the secret ANTHROPIC_API_KEY is missing, or the key has no credit.", url: run.url };
          renderSide();
          toast("AI check failed. The Checks tab has the link to the job.", "err");
        }
        return;
      }
    } catch {
    }
    if (round < 40) pollAi(since, round + 1);
    else {
      aiState = { phase: "failed", msg: "No answer after 4 minutes." };
      renderSide();
    }
  }, 6e3);
}
async function runCheck() {
  findings = allFindings();
  const errs = errors(), hints = findings.filter((f) => f.severity === "warning").length;
  let copilot = "not asked (no pull request yet)";
  const n = review.state.pr?.number ?? (version && getToken() ? (await findPR(targetBranch()).catch(() => void 0))?.number : void 0);
  if (n && getToken()) copilot = await requestCopilot(n).catch(() => false) ? "review requested on the pull request" : "not available for this GitHub account";
  review.state.lastCheck = { by: me(), role: $("#role").value, time: now(), errors: errs, hints, fixes: fixesMade(), copilot };
  tab = "checks";
  document.body.classList.add("drawer-open");
  renderSide();
  renderBar();
  save();
  void startAiCheck2();
  toast(`Check done: ${errs} error${errs === 1 ? "" : "s"}, ${hints} hint${hints === 1 ? "" : "s"}.${copilot.startsWith("review requested") ? " Copilot review requested on the pull request." : ""}`, errs ? "err" : "ok");
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
  review = {
    suggestions: await readJson(`content/${s}/review/suggestions.json`, branch, []),
    history: await readJson(`content/${s}/review/history.json`, branch, []),
    state: await readJson(`content/${s}/review/state.json`, branch, {})
  };
  aiReport = branch === MAIN ? null : await readJson(`content/${s}/review/ai-report.json`, `reports/${branch}`, null);
  aiState = { phase: "none" };
  {
    const old = review.state.status;
    if (old && LEGACY[old]) review.state.status = LEGACY[old];
  }
  const fromLink = new URLSearchParams(location.search).get("jira")?.match(JIRA_KEY)?.[0];
  if (fromLink && review.state.jira !== fromLink.toUpperCase()) {
    review.state.jira = fromLink.toUpperCase();
    save();
  }
  const draft = store.get(`draft:${s}`);
  let note = branch === MAIN ? "No open update yet. Your first save creates one." : `Open update: ${branch}`;
  if (draft) {
    try {
      const d = JSON.parse(draft);
      model = d.model;
      review = d.review;
      dirty = true;
      note = "Unsaved draft from this browser restored";
    } catch {
    }
  } else dirty = false;
  assignIds(model);
  if (baseline) assignIds(baseline);
  F = collect(model);
  findings = allFindings();
  undoStack = [];
  redoStack = [];
  lastSnap = snap();
  finalCheck2 = null;
  renderPage();
  renderSide();
  renderBar();
  $("#saved").textContent = note;
  if (review.state.status === "approved" || review.state.status === "uploaded") refreshFinalCheck();
}
(async () => {
  rules2 = await rules();
  const list = await listGuidelines();
  guidelines = list;
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
  $("#undo").addEventListener("click", undo);
  $("#redo").addEventListener("click", redo);
  $("#runcheck").addEventListener("click", () => {
    runCheck().catch((e) => toast(`Check failed: ${e.message}`, "err"));
  });
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
  const role = store.get("role") || "designer";
  $("#role").value = role;
  $("#suggest").checked = role === "writer";
  $("#name").value = shownName(role);
  const first = list.find((g) => g.slug === store.get("slug"))?.slug ?? list[0]?.slug;
  if (location.hash.length > 2) route();
  else if (first) {
    location.hash = `#/${first}`;
  }
})();
