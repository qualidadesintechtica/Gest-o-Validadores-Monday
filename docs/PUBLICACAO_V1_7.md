# Publicação da V1.7

Esta versão conecta o menu lateral aos quadros reais do Monday.

## 1. Atualizar a Edge Function

1. No Supabase, abra `Edge Functions`.
2. Abra `monday-responsaveis` e escolha `Edit code`.
3. Substitua todo o conteúdo pelo arquivo:
   `supabase/functions/monday-responsaveis/index.ts`.
4. Confirme que o código começa com `const CORS = {`.
5. Clique em `Deploy updates`.

Os secrets existentes permanecem os mesmos. Não altere o token.

## 2. Atualizar o GitHub

Envie o conteúdo do pacote diretamente para a raiz do repositório e substitua
os arquivos existentes. Não envie a pasta externa como uma subpasta.

## 3. Confirmar a versão

Depois que o GitHub Pages concluir a publicação, pressione `Ctrl + F5`.
A linha de status deve mostrar:

`V1.7 · quadros reais ativos`

Os quadros localizados recebem uma seta `↗` no menu. Ao clicar, o quadro real
abre em uma nova guia do navegador.

Se algum item ficar esmaecido, a Edge Function não localizou um quadro com esse
nome no mesmo workspace ou o token não possui acesso a ele.
