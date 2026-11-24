# Como apagar a demonstração depois da avaliação

Esta cópia pública existe só para a avaliação do M4 Capstone. Ela não tem ligação com a
produção: o app abre em modo demonstração (`app/config.js` vazio, dados simulados), sem
Supabase, sem login e sem coletores. Quando as notas saírem, apague as duas peças abaixo.
Nada disso afeta o repositório privado `energia-casa`, o projeto Vercel `energia-casa`
(produção) nem o Supabase.

## 1. Projeto Vercel `energia-casa-demo`

Pelo painel:

1. Abra https://vercel.com/dashboard e entre no projeto **energia-casa-demo**
   (confira o nome: o de produção se chama `energia-casa`, sem `-demo`).
2. **Settings** → **General** → role até o fim → **Delete Project**.
3. Digite o nome `energia-casa-demo` para confirmar.

Ou pela CLI (no computador onde a Vercel CLI está logada):

```bash
vercel project rm energia-casa-demo
```

Depois disso a URL `https://energia-casa-demo.vercel.app` deixa de responder.

## 2. Repositório GitHub `ceeduardocar/energia-casa-demo`

Pelo site:

1. Abra https://github.com/ceeduardocar/energia-casa-demo/settings
   (confira que é o `-demo`, não o `energia-casa` privado).
2. Role até **Danger Zone** → **Delete this repository**.
3. Siga a confirmação digitando `ceeduardocar/energia-casa-demo`.

Ou pela CLI do GitHub (precisa do escopo `delete_repo`: `gh auth refresh -h github.com -s delete_repo`):

```bash
gh repo delete ceeduardocar/energia-casa-demo --yes
```

## 3. Conferir

- `https://github.com/ceeduardocar/energia-casa-demo` responde 404.
- `https://energia-casa-demo.vercel.app` responde 404 (`DEPLOYMENT_NOT_FOUND`).
- O app de produção e o repositório privado continuam como estavam.

Se algum fork público da cópia tiver sido feito por terceiros, ele não some junto: o GitHub
mantém forks de repositórios públicos apagados. A cópia não tem segredos nem identificadores
da produção, então isso não expõe a casa nem o banco.
