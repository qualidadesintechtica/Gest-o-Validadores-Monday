# Publicação da V2.0

A V2.0 substitui a abertura externa do Monday por carregamento e edição dos
quadros dentro do próprio sistema.

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

Não mostre nem copie o valor do token para o GitHub.

## 2. Atualizar o GitHub

Envie o conteúdo do pacote diretamente para a raiz do repositório, substituindo
os arquivos existentes. Não envie a pasta externa como uma subpasta.

## 3. Confirmar a versão

Depois que o GitHub Pages concluir a publicação, pressione `Ctrl + F5`. A linha
de status deve mostrar:

`V2.0 · edição interna ativa`

Ao clicar em qualquer quadro localizado no menu, o título e a tabela devem mudar
dentro da própria página. Nenhuma nova guia deve ser aberta.

Se um quadro ficar esmaecido, ele não foi localizado no mesmo workspace ou o
token do Monday não tem permissão para consultá-lo. Verifique o nome do quadro e
os logs da Edge Function antes de alterar código.

## 4. Ordem do teste

Use primeiro uma célula de texto ou pessoa em um item conhecido. Confirme a
alteração no Monday e só depois teste os demais tipos de coluna.
