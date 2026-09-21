# Agromig Frota

Sistema de controle de frota da Agromig, com frontend React/Vite e API Express compatível com Cloudflare Workers.

## Publicação

O frontend pode ser publicado no GitHub Pages via GitHub Actions. A API continua sendo executada em um serviço compatível com Node/Workers; não inclua arquivos `.env` no repositório.

## Desenvolvimento local

```bash
npm install
npm run build --prefix apps/web
```

Configure as variáveis da API somente no ambiente de execução.
