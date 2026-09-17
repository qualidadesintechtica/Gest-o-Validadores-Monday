# Publicação da V2.2.2

A V2.2.2 mantém os filtros salvos corrigidos e adiciona o botão `Criar título`
para todos os quadros acessíveis do menu.

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

## 2. Atualizar o GitHub

Envie o conteúdo do pacote diretamente para a raiz do repositório, substituindo
os arquivos existentes. Não envie a pasta externa como subpasta.

## 3. Confirmar a publicação

Depois que o GitHub Pages concluir, pressione `Ctrl + F5`. A linha de status
deve mostrar:

`V2.2.2 · criação de títulos ativa`

O botão azul deve exibir `Criar título`. O clique principal abre o formulário;
a seta mostra os grupos reais do quadro.

## 4. Teste seguro

Use primeiro um quadro e um grupo de teste. Crie um título identificável,
confirme a operação e confira o item diretamente no Monday. Depois edite uma
coluna do novo item dentro do sistema.
