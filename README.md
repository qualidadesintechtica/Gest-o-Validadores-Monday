# Gestão de Validadores Monday

Aplicação independente do BI para alterar diretamente no Monday os responsáveis pelas validações.

## Escopo V1.5

- Login via Supabase Auth.
- Acesso restrito ao domínio `@animaeducacao.com.br`.
- Consulta do quadro de Validação de Materiais no Monday.
- Visual escuro e compacto inspirado no quadro do Monday.
- Abas de pendências por Gestor e Revisor.
- Busca global por item, grupo, gestor ou revisor.
- Filtros por grupo e por pessoa.
- Ordenação por item ou grupo.
- Opção de ocultar colunas.
- Visão agrupada ou sem agrupamento.
- Grupos recolhíveis e carregamento progressivo de 30 itens.
- Criação de material no grupo escolhido.
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

Após publicar, confirme no painel do Supabase que a função aparece como
`monday-responsaveis` e consulte os logs caso a tela informe erro de integração.

## Publicação da V1.5

A V1.5 mantém o carregamento seguro da V1.4 e adiciona a ação `create` na Edge
Function. Por isso, publique novamente `monday-responsaveis` antes de usar o
botão **Criar material**.

Para substituir a versão contaminada, envie somente os arquivos deste pacote ao
repositório `Gest-o-Validadores-Monday`. Não copie arquivos de outros projetos
para a mesma pasta.

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
