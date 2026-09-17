# Portal Operacional Monday — V2.2.2

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

A descoberta V2.2.2 procura os quadros em toda a conta acessível pelo token, não
apenas no workspace do quadro principal. Se existirem nomes duplicados ou um
item do menu não for um quadro, use o secret opcional `MONDAY_MENU_BOARD_IDS`
para mapear explicitamente os IDs.

```text
{"Contratação Conteudista":"ID_DO_QUADRO","Critérios de Avaliação":"ID_DO_QUADRO"}
```

Sidekick, Agentes, Vibe, Fluxos, Analisador e outros produtos do portal Monday
não são quadros e não são reproduzidos por esta integração. Eles permanecem
identificados na interface, mas não executam os produtos proprietários do Monday.

## Visualizações e filtros salvos

As abas superiores são carregadas diretamente das visualizações salvas de cada
quadro no Monday. Ao selecionar uma aba, a Edge Function envia ao `items_page`
o filtro e a ordenação registrados naquela visualização. Isso inclui abas como
`26.1 SET/25 a DEZ/25`, sem duplicar manualmente as regras no front-end.

A V2.2.1 converte os operadores devolvidos pelas visualizações (`AND`, `ANY_OF`,
`ASC` e equivalentes) para os valores aceitos por `ItemsQuery` (`and`, `any_of`,
`asc` e equivalentes). A conversão percorre regras e grupos aninhados e remove
atributos de comparação vazios antes de consultar os itens.

A aplicação continua exibindo os resultados em formato de tabela. Visualizações
de gráfico podem carregar o filtro associado, mas o desenho específico do widget
do Monday não é reproduzido nesta versão.

## Criação de títulos

O botão azul `Criar título` cria um item no quadro aberto sem sair do sistema.
O clique principal abre o formulário e seleciona o grupo filtrado ou o primeiro
grupo do quadro. A seta mostra todos os grupos reais para criação direta.

Antes de gravar, o backend valida novamente o quadro, o grupo e o nome. A
criação só é enviada ao Monday depois da confirmação da pessoa usuária. Após a
criação, a visualização atual é recarregada; se o item não atender ao filtro
salvo ativo, ele estará disponível em `Quadro principal`.

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

Consulte `docs/PUBLICACAO_V2_2_2.md` para o procedimento completo e
`docs/PRIMEIRO_TESTE.md` para a validação controlada.
