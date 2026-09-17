# Publicação da V2.2

A V2.2 procura os quadros em toda a conta acessível pelo token, carrega as
visualizações salvas e aplica seus filtros e ordenações dentro do sistema.

## 1. Atualizar a Edge Function

1. No Supabase, abra `Edge Functions`.
2. Abra `monday-responsaveis` e escolha `Edit code`.
3. Substitua todo o conteúdo pelo arquivo
   `supabase/functions/monday-responsaveis/index.ts` deste pacote.
4. Confirme que a primeira linha é `const CORS = {`.
5. Clique em `Deploy updates` e aguarde a confirmação.

Mantenha os secrets existentes:

- `MONDAY_API_TOKEN`
- `MONDAY_VALIDACAO_BOARD_ID` com o valor `9433297929`

Opcionalmente, se um quadro não for encontrado automaticamente, crie o secret
`MONDAY_MENU_BOARD_IDS` com um objeto JSON que associe o texto do menu ao ID:

```json
{"Contratação Conteudista":"1234567890","Critérios de Avaliação":"2345678901"}
```

Não mostre nem copie o valor do token para o GitHub.

## 2. Atualizar o GitHub

Envie o conteúdo do pacote diretamente para a raiz do repositório, substituindo
os arquivos existentes. Não envie a pasta externa como uma subpasta.

## 3. Confirmar a versão

Depois que o GitHub Pages concluir a publicação, pressione `Ctrl + F5`. A linha
de status deve mostrar:

`V2.2 · filtros salvos ativos`

Ao clicar em qualquer quadro localizado no menu, o título e a tabela devem mudar
dentro da própria página. Nenhuma nova guia deve ser aberta.

No quadro `Oferta para Produção`, confirme também que as abas de período aparecem
na faixa superior. Clique em uma delas e confira se a quantidade de itens muda.

Se um item ficar esmaecido, ele não apareceu como quadro acessível para o token.
Confirme se o item é realmente um quadro de dados; pastas, painéis e documentos
não possuem grupos, itens e colunas editáveis pelo mesmo fluxo.

## 4. Ordem do teste

Use primeiro uma célula de texto ou pessoa em um item conhecido. Confirme a
alteração no Monday e só depois teste os demais tipos de coluna.
