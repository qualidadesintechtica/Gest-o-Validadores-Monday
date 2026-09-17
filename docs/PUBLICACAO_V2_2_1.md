# Publicação da V2.2.1

A V2.2.1 mantém a descoberta dos quadros em toda a conta e corrige a aplicação
das visualizações salvas. Operadores devolvidos pelo Monday em maiúsculas são
normalizados para o formato aceito por `items_page`.

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

Opcionalmente, se um quadro não for encontrado automaticamente, mantenha o
secret `MONDAY_MENU_BOARD_IDS` com um objeto JSON que associe o texto do menu ao
ID real:

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

`V2.2.1 · filtros salvos corrigidos`

No quadro `Validação de Materiais`, teste uma aba de cada tipo:

1. `NÍVEL 1 - PLANOS DE PRODUÇÃO` — filtro com grupo aninhado.
2. `Gráfico` — ordenação salva.
3. `Formulário` — filtro associado à visualização.

As três devem carregar itens dentro da tabela, sem mensagens `BAD_USER_INPUT`,
`ANY_OF does not exist` ou `ASC does not exist`.

## 4. Ordem do teste de edição

Use primeiro uma célula de texto ou pessoa em um item conhecido. Confirme a
alteração no Monday e só depois teste os demais tipos de coluna.
