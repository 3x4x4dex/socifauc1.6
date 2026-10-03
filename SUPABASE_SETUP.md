# Supabase do socifauc

1. Abra o projeto `qozlxgophtixgyjxyjhz` no Supabase.
2. Abra `SQL Editor`.
3. Cole e execute todo o conteúdo de `supabase-schema.sql`.
4. Cole e execute todo o conteúdo de `supabase-admin.sql` (painel admin, fila de saques e analytics). O arquivo só contém statements simples e uma função SQL de linha única, para funcionar no editor do Supabase sem erros de parser.
5. Cole e execute todo o conteúdo de `supabase-messages.sql` para criar seguidores, mensagens privadas, políticas RLS e a publicação Realtime.
6. Cole e execute todo o conteúdo de `supabase-stories.sql` para aplicar expiração de 24 horas e ativar o Realtime de status.
7. Cole e execute todo o conteúdo de `supabase-profile-avatars.sql` para configurar o bucket de fotos de perfil.
8. Cole e execute todo o conteúdo de `supabase-notifications.sql` para criar notificações, políticas RLS, triggers de eventos e Realtime.
9. Cole e execute todo o conteúdo de `supabase-leaderboard.sql` para ativar a agregação semanal e o sinal Realtime do ranking.
10. Cole e execute `supabase-rewards.sql` para configurar os valores de recompensa e `supabase-reward-payouts.sql` para aplicar os créditos ao saldo e ao extrato.
11. Cole e execute `supabase-ads.sql` para habilitar campanhas pré-pagas, distribuição no feed, CPM configurável e analytics de publicidade.
12. Cole e execute `supabase-cakto-energy.sql` para habilitar sessões seguras de checkout e créditos idempotentes de energia.
13. Em `Authentication > Providers`, habilite Email ou o provedor que será usado pelos usuários.
14. Crie um usuário de teste. O feed público poderá ser lido sem login; publicar, comentar, curtir, repostar, stories, gorjetas, mensagens, notificações, carteira e publicidade exigem autenticação pelas políticas RLS.
15. Crie/verifique a conta admin com o e-mail `3x4x4dex@gmail.com`. Somente esse e-mail enxerga o item **Administração** no menu e consegue executar as funções `admin_*`. A validação é feita no banco via `auth.jwt() ->> 'email'`, não apenas no frontend.
16. Abra `index.html` por um servidor local. O arquivo `supabase-config.js` já contém a URL e a anon key pública do projeto.

A `service_role key` não deve ser colocada no frontend.

## Notificações

- Execute `supabase-notifications.sql` depois de `supabase-schema.sql` e `supabase-messages.sql`.
- Curtidas, comentários, reposts, gorjetas, novos seguidores, mensagens e posts de quem você segue geram avisos automaticamente no banco.
- A aba **Notificações** mostra o contador de não lidas, permite filtrar e marcar como lidas; novos avisos chegam em tempo real. O RLS permite que cada usuário leia e marque apenas as próprias notificações.

## Top ganhos da semana

- Execute `supabase-leaderboard.sql` para criar a função agregadora pública e os sinais Realtime.
- O ranking soma recompensas de publicações e gorjetas recebidas nos últimos sete dias; mostra o top 3 e permite expandir até 10 pessoas.
- Novas publicações e gorjetas atualizam o ranking em tempo real. Uma atualização periódica recupera eventos perdidos pela conexão.

## Recompensas e missões

- Execute `supabase-rewards.sql` e depois `supabase-reward-payouts.sql`.
- No painel admin, o formulário **Recompensas e missões** configura valores por post, curtida recebida, comentário, repost, status e prêmios das missões diárias.
- O banco aplica os valores ao saldo e ao extrato. O bônus de post original é concedido uma vez por dia; o bônus de engajamento é concedido ao atingir a meta configurada de curtidas recebidas, comentários e reposts.
- Os valores de missão são sincronizados com a página inicial. A missão de vídeo curto aparece no painel, mas ainda não pode ser concluída porque o site não oferece publicação de vídeo.

## Publicidade

- Execute `supabase-ads.sql` depois de `supabase-rewards.sql` e `supabase-reward-payouts.sql`.
- Usuários autenticados podem promover apenas posts próprios, com orçamento pré-pago de 1 SFC ou mais. O valor é reservado da carteira ao ativar; ao cancelar, o saldo não gasto é devolvido e registrado no extrato.
- O CPM inicial é 10 SFC por 1.000 impressões e pode ser alterado pelo admin na seção de recompensas. Cada campanha guarda o CPM aplicado na criação.
- O feed seleciona campanhas ativas aleatoriamente e posiciona um post patrocinado após cada seis posts orgânicos. A campanha do próprio anunciante não é exibida a ele.
- Uma impressão é contabilizada quando pelo menos metade do anúncio entra na tela. A mesma pessoa conta no máximo uma impressão, um clique e um engajamento por campanha a cada dia. A campanha é encerrada automaticamente quando o orçamento acaba.
- O painel Publicidade mostra impressões, cliques, CTR, engajamentos, CPM, gasto, estado da campanha e permite pausar, retomar ou cancelar.

## Recarga Cakto de energia

- Execute `supabase-cakto-energy.sql`.
- O botão **Restaurar 100% com Cakto** usa o produto `https://pay.cakto.com.br/seyuwav_1131179`.
- No Supabase, configure `CAKTO_WEBHOOK_SECRET` nas Secrets das Edge Functions com o segredo de autenticação deste webhook. O UUID recebido só serve aqui se for o segredo configurado na Cakto; um ID de webhook não autentica as notificações. Não coloque o segredo no frontend nem em arquivos versionados. O runtime também precisa disponibilizar `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` para a função.
- Implante `supabase/functions/cakto-energy-webhook` com `supabase functions deploy cakto-energy-webhook --project-ref qozlxgophtixgyjxyjhz --no-verify-jwt`. O endpoint valida a assinatura HMAC `X-Cakto-Signature` e o campo `secret` do payload.
- No painel Cakto, cadastre `https://qozlxgophtixgyjxyjhz.supabase.co/functions/v1/cakto-energy-webhook` e habilite o evento `purchase_approved`.
- A opção **Restaurar 100% com Cakto** abre o checkout `seyuwav_1131179` com um callback opaco ligado à sessão autenticada. O webhook só preenche a energia depois do pagamento aprovado, e cada pedido é processado uma única vez.
- Se o processamento do webhook falhar, confira os logs da Edge Function e reenvie a entrega pelo histórico da Cakto.

## Fotos de perfil

- Execute `supabase-profile-avatars.sql` para criar o bucket público `profile-avatars`; cada usuário só pode enviar arquivos para a pasta do próprio UUID.
- A imagem escolhida no perfil é salva no Storage, e a URL pública é persistida em `profiles.avatar_url` para aparecer no compositor e nas publicações em outros dispositivos.
- São aceitos PNG, JPG e WEBP de até 5 MB.

## Painel admin

- Item **Administração** aparece na sidebar apenas para `3x4x4dex@gmail.com`.
- Estatísticas: total de usuários, ativos hoje/ontem/7d, novos usuários, posts, comentários, curtidas, reposts, gorjetas, SFC em circulação, saques pendentes e aprovados.
- Gráfico diário (7/14/30 dias) de usuários ativos, novos usuários e posts via `admin_dau_series`.
- Fila de saques com filtros (pendentes/aprovados/pagos/rejeitados/todos) e ações **Aprovar**, **Marcar pago** (pede tx hash) e **Rejeitar** (devolve o saldo ao usuário).
- Cada login registra o usuário em `daily_active_users` (upsert direto, políticas RLS próprias).
- **Console SQL** no rodapé do painel: editor de consultas somente leitura vinculado ao frontend. Aceita apenas `select ... from tabela [where ...] [order by ...] [limit n]` sobre as 11 tabelas liberadas, com valores parametrizados (sem SQL injetável) e execução via políticas RLS do admin logado. Atalhos: chips de consultas prontas e Ctrl+Enter para executar.
- Saques agora são gravados na tabela `withdrawals` com status `pending`; o saldo só é debitado do usuário no momento do pedido e devolvido automaticamente se rejeitado.

## Status temporários

- Execute `supabase-stories.sql` para configurar `stories`, RLS e Realtime.
- Stories são gravados no Supabase e somem da faixa após 24 horas; o prazo é imposto por trigger no banco. A lista se atualiza por Realtime e também faz uma verificação periódica para remover status vencidos.
- A publicação exige login e aceita texto de até 120 caracteres e imagem PNG/JPG/WEBP de até 5 MB.

## Mensagens privadas

- Execute `supabase-messages.sql` depois dos outros arquivos SQL.
- `follows` registra quem segue quem; `direct_messages` armazena mensagens privadas de até 2.000 caracteres.
- O painel **Mensagens** permite buscar perfis, seguir/deixar de seguir, ver seguidores e conversas recentes. Só é possível iniciar/enviar mensagem para uma conta que segue o remetente.
- O RLS garante que cada usuário só leia mensagens em que participa; o envio e o grafo de seguidores também são protegidos por políticas no banco.

