# Publicação da V1.3

## 1. Substituir os arquivos do GitHub Pages

Envie todo o conteúdo deste pacote para a raiz do repositório
`Gest-o-Validadores-Monday`.

O arquivo `index.html` deve ficar diretamente na raiz. Não envie a pasta
`.git` e não misture páginas do projeto LiS Beauty.

Se estes arquivos existirem no repositório da Gestão de Validadores, apague-os,
pois pertencem à LiS Beauty:

- `agenda.html`;
- `clientes.html`;
- `dashboard.html`;
- `profissionais.html`;
- `servicos.html`;
- `css/style.css`;
- `js/clientes.js`;
- `js/dashboard.js`;
- `js/profissionais.js`;
- `js/servicos.js`.

Os arquivos `index.html`, `js/config.js` e `js/auth.js` precisam ser substituídos
pelas versões deste pacote.

## 2. Conferir os secrets do Supabase

No projeto `nkjmgzyjjbepebzurowy`, a função precisa destes secrets:

- `MONDAY_API_TOKEN`: token válido com acesso ao quadro;
- `MONDAY_VALIDACAO_BOARD_ID`: `9433297929`.

Opcionalmente, use `MONDAY_API_VERSION=2026-07`.

## 3. Publicar a Edge Function

Na pasta raiz do projeto, execute:

```bash
supabase functions deploy monday-responsaveis --project-ref nkjmgzyjjbepebzurowy
```

## 4. Validar o carregamento

1. Abra o site em uma janela anônima.
2. Entre com a conta institucional.
3. Confirme que o nome do quadro e a quantidade de itens aparecem.
4. Se houver erro, copie a mensagem completa exibida na tabela e consulte os
   logs da função `monday-responsaveis`.

## 5. Fazer o teste controlado

1. Pesquise um item conhecido.
2. Altere somente o Revisor Validador.
3. Confirme a gravação.
4. Abra o mesmo item no Monday e confira o novo responsável.
5. Só depois teste o Gestor de Validação.
