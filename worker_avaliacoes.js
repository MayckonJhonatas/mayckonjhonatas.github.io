const CONFIG = {
  owner: "MayckonJhonatas",
  repo: "mayckonjhonatas.github.io",
  branch: "main",
  path: "dados/avaliacoes.json",
  allowedOrigin: "https://mayckonjhonatas.github.io"
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === "GET") {
      return json({
        ok: true,
        service: "LeituraFy Avaliações",
        repository: CONFIG.owner + "/" + CONFIG.repo,
        path: CONFIG.path
      }, 200, cors);
    }

    if (request.method !== "POST") {
      return json({ error: "Método não permitido." }, 405, cors);
    }

    if (origin !== CONFIG.allowedOrigin) {
      return json({ error: "Origem não autorizada." }, 403, cors);
    }

    if (!env.GITHUB_TOKEN) {
      return json({ error: "GITHUB_TOKEN não configurado no Worker." }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "JSON inválido." }, 400, cors);
    }

    const v = validar(body);
    if (!v.ok) return json({ error: v.error }, 400, cors);

    try {
      const clientHash = await sha256(v.clientId);
      const resultado = await salvarNoGitHub({
        leituraId: v.leituraId,
        alunoId: v.alunoId,
        clientHash,
        avaliador: v.avaliador,
        estrelas: v.estrelas,
        comentario: v.comentario
      }, env.GITHUB_TOKEN);

      return json({
        ok: true,
        avaliacao: resultado.avaliacao,
        avaliacoes: resultado.avaliacoes
      }, 200, cors);
    } catch (e) {
      return json({ error: e?.message || "Não foi possível salvar a avaliação." }, 500, cors);
    }
  }
};

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === CONFIG.allowedOrigin ? origin : CONFIG.allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=UTF-8",
    "Cache-Control": "no-store"
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

function txt(v) {
  return String(v ?? "").trim();
}

function validar(body) {
  const clientId = txt(body.clientId);
  const leituraId = txt(body.leituraId);
  const alunoId = txt(body.alunoId);
  const avaliador = txt(body.avaliador);
  const comentario = txt(body.comentario);
  const estrelas = Number(body.estrelas);

  if (!clientId || clientId.length > 150) return { ok:false, error:"Identificador do dispositivo inválido." };
  if (!leituraId || leituraId.length > 180) return { ok:false, error:"Leitura inválida." };
  if (!alunoId || alunoId.length > 180) return { ok:false, error:"Aluno inválido." };
  if (!avaliador || avaliador.length > 80) return { ok:false, error:"Informe seu nome ou identificação." };
  if (!Number.isInteger(estrelas) || estrelas < 1 || estrelas > 5) return { ok:false, error:"A avaliação deve ter de 1 a 5 estrelas." };
  if (comentario.length > 600) return { ok:false, error:"O comentário deve ter no máximo 600 caracteres." };

  return { ok:true, clientId, leituraId, alunoId, avaliador, comentario, estrelas };
}

async function salvarNoGitHub(dados, token) {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const atual = await lerArquivo(token);
    const avaliacoes = Array.isArray(atual.avaliacoes) ? atual.avaliacoes : [];
    const agora = new Date().toISOString();

    const indice = avaliacoes.findIndex(a =>
      String(a.leituraId) === dados.leituraId &&
      String(a.clientHash) === dados.clientHash
    );

    let avaliacao;

    if (indice >= 0) {
      avaliacao = {
        ...avaliacoes[indice],
        alunoId: dados.alunoId,
        avaliador: dados.avaliador,
        estrelas: dados.estrelas,
        comentario: dados.comentario,
        atualizadoEm: agora
      };
      avaliacoes[indice] = avaliacao;
    } else {
      avaliacao = {
        id: crypto.randomUUID(),
        leituraId: dados.leituraId,
        alunoId: dados.alunoId,
        clientHash: dados.clientHash,
        avaliador: dados.avaliador,
        estrelas: dados.estrelas,
        comentario: dados.comentario,
        criadoEm: agora,
        atualizadoEm: agora
      };
      avaliacoes.push(avaliacao);
    }

    const r = await gravarArquivo(avaliacoes, atual.sha, token);
    if (r.ok) return { avaliacao, avaliacoes };

    if (![409,422].includes(r.status) || tentativa === 3) {
      throw new Error(r.error || ("GitHub respondeu HTTP " + r.status));
    }
  }

  throw new Error("Não foi possível concluir a gravação.");
}

async function lerArquivo(token) {
  const url = "https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo +
    "/contents/" + CONFIG.path + "?ref=" + encodeURIComponent(CONFIG.branch) + "&t=" + Date.now();

  const r = await fetch(url, {
    headers: githubHeaders(token),
    cf: { cacheTtl: 0 }
  });

  if (r.status === 404) return { avaliacoes: [], sha: null };

  if (!r.ok) {
    throw new Error("Falha ao ler " + CONFIG.path + " (" + r.status + "): " + await r.text());
  }

  const arquivo = await r.json();
  const conteudo = base64ParaUtf8(arquivo.content || "");

  let avaliacoes;
  try {
    avaliacoes = JSON.parse(conteudo || "[]");
  } catch {
    throw new Error(CONFIG.path + " contém JSON inválido.");
  }

  if (!Array.isArray(avaliacoes)) {
    throw new Error(CONFIG.path + " precisa conter uma lista JSON.");
  }

  return { avaliacoes, sha: arquivo.sha || null };
}

async function gravarArquivo(avaliacoes, sha, token) {
  const url = "https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo +
    "/contents/" + CONFIG.path;

  const body = {
    message: sha ? "Atualiza avaliação no LeituraFy" : "Cria arquivo de avaliações do LeituraFy",
    content: utf8ParaBase64(JSON.stringify(avaliacoes, null, 2) + "\n"),
    branch: CONFIG.branch
  };

  if (sha) body.sha = sha;

  const r = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(token),
    body: JSON.stringify(body)
  });

  if (r.ok) return { ok:true, status:r.status };

  return {
    ok:false,
    status:r.status,
    error:"Falha ao gravar " + CONFIG.path + " (" + r.status + "): " + await r.text()
  };
}

function githubHeaders(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "LeituraFy-Avaliacoes-Worker",
    "Content-Type": "application/json"
  };
}

async function sha256(valor) {
  const bytes = new TextEncoder().encode(valor);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function utf8ParaBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

function base64ParaUtf8(base64) {
  const limpo = String(base64 || "").replace(/\s/g, "");
  const binario = atob(limpo);
  const bytes = Uint8Array.from(binario, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
