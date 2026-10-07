# LeituraFy — publicar o Worker de avaliações

Este Worker grava as avaliações em:

`dados/avaliacoes.json`

do repositório:

`MayckonJhonatas/mayckonjhonatas.github.io`

## 1. Criar o Worker na Cloudflare

1. Abra o painel da Cloudflare.
2. Entre em **Workers & Pages**.
3. Clique em **Create** e depois em **Worker**.
4. Dê um nome como `leiturafy-avaliacoes`.
5. Apague o código padrão.
6. Cole o conteúdo do arquivo `worker_avaliacoes.js`.
7. Clique em **Deploy**.

## 2. Criar um token do GitHub

No GitHub, crie um Fine-grained personal access token.

Use:
- Resource owner: `MayckonJhonatas`
- Repository access: somente `mayckonjhonatas.github.io`
- Repository permissions:
  - Contents: Read and write

## 3. Guardar o token no Worker

Na Cloudflare:

Worker → Settings → Variables and Secrets

Crie um Secret com:

Nome:
`GITHUB_TOKEN`

Valor:
cole o token do GitHub.

Depois faça Deploy novamente.

## 4. Testar o Worker

Abra a URL do Worker no navegador.

Deve retornar algo como:

```json
{
  "ok": true,
  "service": "LeituraFy Avaliações",
  "repository": "MayckonJhonatas/mayckonjhonatas.github.io",
  "path": "dados/avaliacoes.json"
}
```

## 5. Ligar o Worker ao LeituraFy

Abra `leiturafy.html` e procure:

```js
avaliacoesApiUrl:""
```

Troque pela URL do Worker, por exemplo:

```js
avaliacoesApiUrl:"https://leiturafy-avaliacoes.SEUSUBDOMINIO.workers.dev"
```

Sem barra / no final.

Depois salve o arquivo no GitHub.

## Resultado

Pai avalia → leiturafy.html → Worker → dados/avaliacoes.json → todos veem a avaliação.

O token do GitHub nunca fica exposto no HTML público.
