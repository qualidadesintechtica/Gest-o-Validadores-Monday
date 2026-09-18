# Publicação da V2.4

A V2.4 acrescenta relatórios internos de acesso e de alterações por usuário,
sem retirar a abertura rápida, o carregamento progressivo, os filtros, UC/UA/Lote
ou a edição dos sete quadros.

## 1. Criar as tabelas de auditoria

1. No mesmo projeto do Supabase, abra `SQL Editor`.
2. Crie uma nova consulta.
3. Copie todo o conteúdo de
   `supabase/migrations/20260918_gv_auditoria.sql`.
4. Execute a consulta uma única vez.
5. Confirme no `Table Editor` que existem `gv_acessos` e `gv_alteracoes`.

O script pode ser executado novamente com segurança porque usa `if not exists`.
Não coloque `SUPABASE_SERVICE_ROLE_KEY` no GitHub; esse secret já é fornecido
pelo próprio ambiente das Edge Functions.

## 2. Atualizar a Edge Function

1. Abra `Edge Functions` no Supabase.
2. Abra `monday-responsaveis` e escolha `Edit code`.
3. Substitua todo o conteúdo pelo arquivo
   `supabase/functions/monday-responsaveis/index.ts` deste pacote.
4. Confirme que a primeira linha é `const CORS = {`.
5. Clique em `Deploy updates` e aguarde a confirmação.

Mantenha os secrets existentes:

- `MONDAY_API_TOKEN`
- `MONDAY_VALIDACAO_BOARD_ID=9433297929`
- `MONDAY_MENU_BOARD_IDS`, se já estiver configurado

Opcional: crie `GV_REPORT_ADMIN_EMAILS` com os e-mails autorizados, separados
por vírgulas, para restringir a leitura dos relatórios. Sem esse secret, todos
os usuários autenticados do domínio permitido terão acesso aos relatórios.

## 3. Atualizar o GitHub

Envie o conteúdo do pacote diretamente para a raiz do repositório, substituindo
os arquivos existentes. Não envie a pasta externa como subpasta.

## 4. Confirmar a publicação

Depois que o GitHub Pages concluir, pressione `Ctrl + F5`. A linha de status
deve mostrar:

`V2.4 · auditoria ativa`

Abra `Relatórios de auditoria` no menu lateral. O período padrão é de 30 dias e
os botões permitem alternar entre acessos e alterações e exportar CSV.

## 5. Teste seguro

Altere uma célula de teste e confirme a gravação no Monday. Depois abra o
relatório de alterações e verifique usuário, quadro, item, coluna, valor anterior,
valor novo, status e data. Os registros só existem a partir da publicação desta
versão; não há preenchimento retroativo.
