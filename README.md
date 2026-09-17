# Portal Operacional Monday — V2.0

Aplicação interna para consultar e editar os quadros operacionais do Monday sem
sair do site publicado no GitHub Pages.

## Escopo

Os itens abaixo do menu lateral carregam dentro da mesma tela:

- Oferta para Produção
- Contratação Conteudista
- Esteira de Produção
- Validação de Materiais
- Avaliação da Atuação
- Critérios de Avaliação
- Painéis de validação

Cada quadro apresenta seus grupos, itens e colunas reais. O menu `Colunas`
permite escolher até 12 colunas por vez; a limitação é apenas de exibição e
protege o desempenho em quadros grandes. Todas as colunas do quadro continuam
disponíveis nesse menu.

O clique no nome do item ou em uma célula editável abre um editor interno. A
gravação só ocorre após confirmação. Fórmula, espelho, ID, registros automáticos,
votos, controle de tempo e outros tipos que a API do Monday não permite alterar
ficam visíveis como somente leitura.

## Arquitetura e segurança

Navegador → Supabase Auth → Edge Function `monday-responsaveis` → Monday API

- Login restrito ao domínio `@animaeducacao.com.br`.
- O token do Monday permanece somente nos secrets do Supabase.
- A função aceita apenas os sete quadros autorizados do menu.
- O backend valida novamente quadro, item, coluna e tipo antes de gravar.
- Nenhum token deve ser colocado em `config.js`, HTML ou JavaScript público.

## Secrets necessários

```text
MONDAY_API_TOKEN
MONDAY_VALIDACAO_BOARD_ID=9433297929
```

O ambiente do Supabase fornece `SUPABASE_URL` e `SUPABASE_ANON_KEY`.

## Publicação

Esta versão altera o front-end e a Edge Function. Publique primeiro
`supabase/functions/monday-responsaveis/index.ts` e depois envie o conteúdo
desta pasta diretamente para a raiz do repositório GitHub.

Consulte `docs/PUBLICACAO_V2_0.md` para o procedimento completo e
`docs/PRIMEIRO_TESTE.md` para a validação controlada.
