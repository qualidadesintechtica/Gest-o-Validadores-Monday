# Publicação da V2.3

A V2.3 adiciona filtros avançados por qualquer coluna, prioriza Nome da UC,
Nome da UA e Lote e exibe quadros grandes com carregamento progressivo.

## 1. Atualizar a Edge Function

1. No Supabase, abra `Edge Functions`.
2. Abra `monday-responsaveis` e escolha `Edit code`.
3. Substitua todo o conteúdo pelo arquivo
   `supabase/functions/monday-responsaveis/index.ts` deste pacote.
4. Confirme que a primeira linha é `const CORS = {`.
5. Clique em `Deploy updates` e aguarde a confirmação.

Mantenha os secrets existentes:

- `MONDAY_API_TOKEN`
- `MONDAY_VALIDACAO_BOARD_ID=9433297929`
- `MONDAY_MENU_BOARD_IDS`, se já estiver configurado

Não é necessário criar ou alterar secret para os filtros.

## 2. Atualizar o GitHub

Envie o conteúdo do pacote diretamente para a raiz do repositório, substituindo
os arquivos existentes. Não envie a pasta externa como subpasta.

## 3. Confirmar a publicação

Depois que o GitHub Pages concluir, pressione `Ctrl + F5`. A linha de status
deve mostrar:

`V2.3 · filtros avançados ativos`

O quadro deve aparecer após o primeiro lote. Enquanto os demais itens chegam, o
status mostra `Carregando 500...`, `Carregando 1.000...` e assim por diante.

## 4. Teste seguro

Abra `Filtro`, crie uma regra por uma coluna visível e confirme a contagem. Em
seguida, filtre por uma coluna oculta e clique em `Aplicar filtros`. Confira Nome
da UC, Nome da UA e Lote quando essas colunas existirem no quadro. Finalize com
uma edição simples e uma criação de título em um grupo de teste.
