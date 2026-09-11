# Gestão de Validadores Monday

Aplicação independente do BI para alterar diretamente no Monday os responsáveis pelas validações.

## Escopo V1

- Login via Supabase Auth.
- Acesso restrito ao domínio `@animaeducacao.com.br`.
- Consulta do quadro de Validação de Materiais no Monday.
- Busca por item, grupo, gestor ou revisor.
- Filtro por grupo.
- Alteração de `Gestor de Validação`.
- Alteração de `Revisor Validador`.
- Confirmação antes da gravação.
- Token do Monday armazenado somente como secret da Edge Function.

## Arquitetura

Navegador -> Supabase Auth -> Edge Function `monday-responsaveis` -> Monday API

O token do Monday nunca deve ser colocado em `config.js`, HTML, JavaScript do navegador ou GitHub.

## Configuração do Supabase

Use o projeto já configurado em `js/config.js`.

Secrets necessários na Edge Function:

```bash
supabase secrets set MONDAY_API_TOKEN="SEU_TOKEN_DO_MONDAY"
supabase secrets set MONDAY_VALIDACAO_BOARD_ID="9433297929"
```

O ambiente do Supabase normalmente já fornece `SUPABASE_URL` e `SUPABASE_ANON_KEY` para a função.

## Publicar a Edge Function

```bash
supabase functions deploy monday-responsaveis --project-ref nkjmgzyjjbepebzurowy
```

## GitHub Pages

Crie um repositório separado, por exemplo:

`qualidadesintechtica/Gestao_Validadores_Monday`

Envie o conteúdo desta pasta para a raiz do repositório e habilite GitHub Pages para a branch `main` / pasta `/root`.

## Primeiro teste recomendado

1. Entrar no site.
2. Localizar um único item conhecido.
3. Alterar somente o Revisor Validador.
4. Confirmar a alteração.
5. Abrir o Monday e verificar o mesmo item.
6. Somente depois testar o Gestor de Validação.

## Segurança

A V1 valida o usuário tanto no navegador quanto dentro da Edge Function. A função recusa sessões inválidas e e-mails fora do domínio permitido.
