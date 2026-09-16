# Publicação da V1.5

## 1. Atualizar a Edge Function

Substitua o arquivo da função por:

`supabase/functions/monday-responsaveis/index.ts`

Depois publique:

```bash
supabase functions deploy monday-responsaveis --project-ref nkjmgzyjjbepebzurowy
```

Essa atualização é necessária para o botão **Criar material**. Os secrets
`MONDAY_API_TOKEN` e `MONDAY_VALIDACAO_BOARD_ID` continuam os mesmos.

## 2. Atualizar o GitHub Pages

Envie para a raiz do repositório os arquivos e pastas deste pacote, exceto a
pasta `.git` local. Confirme que `index.html`, `login.html`, `css`, `js`, `docs`
e `supabase` foram atualizados.

## 3. Conferir a publicação

Abra o site com recarregamento completo (`Ctrl+F5`) e confirme:

1. O quadro aparece no tema escuro.
2. Os grupos e os 2.538 itens são carregados.
3. Busca, Pessoa, Filtro, Ordenar, Ocultar e Agrupar respondem.
4. Uma alteração de responsável é salva no Monday.
5. Um material de teste pode ser criado no grupo selecionado.

Use primeiro um item e um material de teste conhecidos. A criação e a alteração
são gravadas diretamente no Monday.
