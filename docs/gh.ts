// GitHub connection for the editor. Runs in the browser (GitHub Pages), no server.
// Reads work without a token (public repo). Saves, pull requests and merges need a token
// that the person pastes once into the editor. The token stays in this browser only.
export const REPO = "Venelinhr/fiori-guideline-studio";
export const MAIN = "main";
const API = `https://api.github.com/repos/${REPO}`;
export const rawBase = (ref: string) => `https://raw.githubusercontent.com/${REPO}/${ref}`;

const TOKEN_KEY = "gh-token";
export const getToken = (): string => { try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } };
export const setToken = (t: string) => { try { t.trim() ? localStorage.setItem(TOKEN_KEY, t.trim()) : localStorage.removeItem(TOKEN_KEY); } catch { /* no storage */ } };

export class GhError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}, needToken = false): Promise<T> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const tok = getToken();
  if (tok) headers.authorization = `Bearer ${tok}`;
  if (needToken && !tok) throw new GhError(401, "Paste your GitHub token first (top right).");
  let body = init.body;
  if (init.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(init.json); }
  const r = await fetch(`${API}${path}`, { ...init, headers, body });
  if (r.status === 204) return undefined as T;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new GhError(r.status, j.message ? `GitHub: ${j.message}` : `GitHub error ${r.status}`);
  return j as T;
}

// Reading a file from a branch through the API (not the raw cache), so a just-saved version shows at once.
export async function readText(path: string, ref: string): Promise<string | undefined> {
  try {
    const j = await api<{ content: string; encoding: string }>(`/contents/${path}?ref=${encodeURIComponent(ref)}`);
    return decodeURIComponent(escape(atob(j.content.replace(/\n/g, ""))));
  } catch (e) { if (e instanceof GhError && e.status === 404) return undefined; throw e; }
}
export const readJson = async <T>(path: string, ref: string, fallback: T): Promise<T> => {
  const t = await readText(path, ref); return t === undefined ? fallback : JSON.parse(t) as T;
};

export async function listGuidelines(): Promise<{ slug: string; title: string }[]> {
  return (await fetch(`${rawBase(MAIN)}/content/index.json`)).json();
}
export async function rules(): Promise<unknown> {
  return (await fetch(`${rawBase(MAIN)}/standards/rules.json`)).json();
}

// Does an update branch already exist for this guideline?
export async function branchOf(slug: string): Promise<string | undefined> {
  const name = `update/${slug}`;
  try { await api(`/git/ref/heads/${name}`); return name; } catch (e) { if (e instanceof GhError && e.status === 404) return undefined; throw e; }
}

export async function openUpdate(slug: string) {
  const branch = (await branchOf(slug)) ?? MAIN;
  return { branch, editable: branch !== MAIN };
}

// One commit on the update branch with several files. Creates the branch from main the first time.
export async function commitFiles(slug: string, files: { path: string; content?: string; base64?: string }[], message: string): Promise<{ branch: string; sha: string }> {
  const branch = `update/${slug}`;
  let head: string;
  try { head = (await api<{ object: { sha: string } }>(`/git/ref/heads/${branch}`, {}, true)).object.sha; }
  catch (e) {
    if (!(e instanceof GhError) || e.status !== 404) throw e;
    const main = await api<{ object: { sha: string } }>(`/git/ref/heads/${MAIN}`, {}, true);
    await api(`/git/refs`, { method: "POST", json: { ref: `refs/heads/${branch}`, sha: main.object.sha } }, true);
    head = main.object.sha;
  }
  const parent = await api<{ tree: { sha: string } }>(`/git/commits/${head}`, {}, true);
  const tree = [];
  for (const f of files) {
    const b = await api<{ sha: string }>(`/git/blobs`, { method: "POST", json: f.base64 !== undefined ? { content: f.base64, encoding: "base64" } : { content: f.content ?? "", encoding: "utf-8" } }, true);
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
  }
  const t = await api<{ sha: string }>(`/git/trees`, { method: "POST", json: { base_tree: parent.tree.sha, tree } }, true);
  const c = await api<{ sha: string }>(`/git/commits`, { method: "POST", json: { message, tree: t.sha, parents: [head] } }, true);
  await api(`/git/refs/heads/${branch}`, { method: "PATCH", json: { sha: c.sha } }, true);
  return { branch, sha: c.sha };
}

export async function openPR(slug: string, title: string, body: string): Promise<{ number: number; url: string }> {
  const branch = `update/${slug}`;
  const open = await api<any[]>(`/pulls?state=open&head=${encodeURIComponent(`${REPO.split("/")[0]}:${branch}`)}`);
  const pr = open[0] ?? (await api(`/pulls`, { method: "POST", json: { title, head: branch, base: MAIN, body } }, true));
  return { number: pr.number, url: pr.html_url };
}

export async function review(number: number, event: "APPROVE" | "REQUEST_CHANGES", body: string) {
  await api(`/pulls/${number}/reviews`, { method: "POST", json: { event, body } }, true);
}

export async function merge(number: number) {
  await api(`/pulls/${number}/merge`, { method: "PUT", json: { merge_method: "squash" } }, true);
}

// Checks the saved token with GitHub. Returns the login name, or throws a readable message.
export async function whoami(): Promise<string> {
  const tok = getToken(); if (!tok) throw new GhError(401, "No token saved yet.");
  const r = await fetch("https://api.github.com/user", { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${tok}` } });
  if (r.status === 401) throw new GhError(401, "GitHub did not accept this token. Check that you copied all of it.");
  if (!r.ok) throw new GhError(r.status, `GitHub answered ${r.status}. Try again.`);
  return (await r.json()).login as string;
}

export function toBase64(buf: ArrayBuffer): string {
  let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
