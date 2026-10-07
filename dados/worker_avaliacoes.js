// Cloudflare Worker — LeituraFy avaliações -> GitHub
// Secret obrigatório: GITHUB_TOKEN
// O token deve ter acesso APENAS ao repositório e permissão Contents: Read and write.

const DEFAULTS = {
  owner: "MayckonJhonatas",
  repo: "mayckonjhonatas.github.io",
  branch: "main",
  path: "dados/avaliacoes.json",
  allowedOrigin: "https://mayckonjhonatas.github.io"
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULTS.allowedOrigin;
    const corsOrigin = origin === allowedOrigin ? origin : allowedOrigin;

    const cors = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "Cache-Control": "no-store"
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin && origin !== allowedOrigin) return json({ error: "Origem não autorizada." }, 403, cors);
    if (!env.GITHUB_TOKEN) return json({ error: "GITHUB_TOKEN não configurado no Worker." }, 500, cors);

    const owner = env.GITHUB_OWNER || DEFAULTS.owner;
    const repo = env.GITHUB_REPO || DEFAULTS.repo;
    const branch = env.GITHUB_BRANCH || DEFAULTS.branch;
    const path = env.GITHUB_FILE || DEFAULTS.path;

    try {
      if (request.method === "GET") {
        const file = await getGithubFile(env.GITHUB_TOKEN, owner, repo, branch, path);
        return json(file.data, 200, cors);
      }

      if (request.method !== "POST") return json({ error: "Método não permitido." }, 405, cors);

      const body = await request.json().catch(() => null);
      if (!body) return json({ error: "JSON inválido." }, 400, cors);

      const clientId = clean(body.clientId, 160);
      const leituraId = clean(body.leituraId, 300);
      const alunoId = clean(body.alunoId, 160);
      const avaliador = clean(body.avaliador, 80);
      const comentario = clean(body.comentario, 600);
      const estrelas = Number(body.estrelas);

      if (!clientId || !leituraId || !alunoId || !avaliador) return json({ error: "Dados obrigatórios ausentes." }, 400, cors);
      if (!Number.isInteger(estrelas) || estrelas < 1 || estrelas > 5) return json({ error: "A avaliação deve ser de 1 a 5 estrelas." }, 400, cors);

      const clientHash = await sha256Hex(clientId);
      const now = new Date().toISOString();

      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const file = await getGithubFile(env.GITHUB_TOKEN, owner, repo, branch, path);
          const list = Array.isArray(file.data) ? file.data : [];
          const idx = list.findIndex(x => x && x.leituraId === leituraId && x.clientHash === clientHash);
          const current = idx >= 0 ? list[idx] : null;

          const review = {
            id: current?.id || crypto.randomUUID(),
            leituraId,
            alunoId,
            clientHash,
            avaliador,
            estrelas,
            comentario,
            criadoEm: current?.criadoEm || now,
            atualizadoEm: now
          };

          if (idx >= 0) list[idx] = review; else list.push(review);
          // Mais recentes primeiro; deixa o JSON fácil de conferir no GitHub.
          list.sort((a,b) => String(b.atualizadoEm || "").localeCompare(String(a.atualizadoEm || "")));

          const saved = await putGithubFile(env.GITHUB_TOKEN, owner, repo, branch, path, list, file.sha);
          return json({ ok: true, commit: saved.commit?.sha || null, avaliacoes: list }, 200, cors);
        } catch (e) {
          lastError = e;
          if (e.status !== 409) throw e;
          await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
        }
      }
      throw lastError || new Error("Conflito ao salvar.");
    } catch (e) {
      console.error(e);
      return json({ error: e.message || "Erro interno." }, e.status || 500, cors);
    }
  }
};

function clean(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function githubFetch(token, url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      ...(options.headers || {})
    }
  });
  if (!r.ok) {
    const text = await r.text();
    const err = new Error(`GitHub ${r.status}: ${text.slice(0, 500)}`);
    err.status = r.status;
    throw err;
  }
  return r;
}

function apiUrl(owner, repo, path, branch) {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`;
}

async function getGithubFile(token, owner, repo, branch, path) {
  const url = apiUrl(owner, repo, path, branch);
  const r = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10"
    },
    cache: "no-store"
  });
  if (r.status === 404) return { data: [], sha: null };
  if (!r.ok) {
    const text = await r.text();
    const err = new Error(`GitHub ${r.status}: ${text.slice(0, 500)}`);
    err.status = r.status;
    throw err;
  }
  const obj = await r.json();
  const decoded = decodeBase64Utf8(String(obj.content || "").replace(/\n/g, ""));
  let data = [];
  try { data = decoded.trim() ? JSON.parse(decoded) : []; } catch { data = []; }
  return { data: Array.isArray(data) ? data : [], sha: obj.sha || null };
}

async function putGithubFile(token, owner, repo, branch, path, data, sha) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const payload = {
    message: "LeituraFy: atualizar avaliações das famílias",
    content: encodeBase64Utf8(JSON.stringify(data, null, 2) + "\n"),
    branch
  };
  if (sha) payload.sha = sha;
  const r = await githubFetch(token, url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return r.json();
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function decodeBase64Utf8(base64) {
  const bin = atob(base64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
