# Publicação da V2.3.1

A V2.3.1 reduz o primeiro lote de 500 para 100 itens, abre o quadro principal
sem aguardar a descoberta do menu e mantém o restante do carregamento em segundo
plano. Filtros avançados, UC/UA/Lote, edição e criação continuam preservados.

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

Não altere o token e não crie novo secret.

## 2. Atualizar o GitHub

Envie o conteúdo do pacote diretamente para a raiz do repositório, substituindo
os arquivos existentes. Não envie a pasta externa como subpasta.

## 3. Confirmar a publicação

Depois que o GitHub Pages concluir, pressione `Ctrl + F5`. A linha de status
deve mostrar:

`V2.3.1 · abertura rápida ativa`

O quadro deve aparecer com aproximadamente 100 itens antes do término do menu.
Depois o status avança em lotes maiores até mostrar `Conectado`.

## 4. Teste seguro

Cronometre do clique no login até a primeira tabela visível. Depois confirme que
o total carregado continua aumentando, que o menu passa a responder e que os
filtros avançados, UC/UA/Lote, edição de célula e criação de título continuam
funcionando.
