# Plano — Análise de pedidos de inscrição e aprovação de contas

Data do levantamento: 16/09/2026 (diagnóstico em código, V0.1)

## 1. Como o sistema funciona hoje

### Contas de usuário
- `/cadastro` (pública, link "Solicitar novo cadastro" em `/login` e botão na home)
  cria usuário com `approval_status='pending'` (`routes/public.js:2875-2890`).
- Conta pendente **não pode logar** (bloqueio em `routes/auth.js:867`).
- Aprovação é **exclusiva do superadmin**: `POST /admin/users/:id/approve`
  (`routes/users.js:912-942`) → `is_public=1, approval_status='approved',
  approved_at/by` + e-mail via `queueAccountApproved` (link de uso único para
  definir senha, válido 72 h). Pendências aparecem no dashboard apenas em
  visão global do superadmin ("Solicitações de cadastro não analisadas",
  `routes/auth.js:569-583`) e em `/admin/users` (`routes/users.js:301-308`).

### Inscrição em evento (modo análise)
- `/evento/:id/inscricao` **exige login** (`requireNonAdminAuthorAccess`,
  `routes/public.js:563-578`; rota POST em public.js:1477). A página de
  inscrição **não cria conta** — só quem já tem conta aprovada se inscreve.
- Com o evento em `registration_approval_mode='review'`, a inscrição fica
  `registration_status='pending'` em `event_registrations` (public.js:1654).
- Análise atual: `/admin/events/:id/participants/:regId/review`
  (GET/POST `routes/events.js:3901-3947`) — aprovar grava atividades,
  notas, auditoria e enfileira e-mail da decisão.
- **Nada disso aparece no dashboard em `/admin/dashboard` hoje.**

## 2. Objetivos acordados

1. **Admin de evento** (não staff) analisa pedidos de inscrição nos eventos
   que administra, sem precisar do superadmin.
2. No `/admin/dashboard`, nova seção com esses pedidos + link para a página
   de análise existente (mesma análise já usada pelo superadmin
   admin@admin.com).
3. Aprovar a inscrição **aprove implicitamente a criação da conta** do
   solicitante (quando pendente), incluindo e-mail do link de primeira senha.
4. Novo usuário poderá criar conta também **vinda da página de inscrição do
   evento** ("Porta 1"), com a solicitação visível ao admin do evento.

## 3. O problema do ovo e da galinha (impedido hoje)

- Conta pendente não loga ⇒ não consegue se inscrever ⇒ a inscrição pendente
  no evento jamais existiria para uma conta pendente ⇒ o admin do evento
  nunca veria essa conta na fila.
- Solução desenhada: **Porta 1** — formulário combinado (cadastro + inscricao)
  na página do evento, acessível sem login (detalhes no item 4).

## 4. Desenho proposto

### Porta 1 — inscrição via página do evento (nova)
- Unir campos do cadastro (nome, e-mail, confirmar e-mail, CPF/passaporte,
  instituição) ao formulário de inscrição do evento num único envio.
- Regras no `POST /evento/:id/inscricao`:
  1. E-mail com conta **aprovada** → comportamento atual (exige login).
  2. E-mail com conta **pendente** = reutiliza a conta e anexa a inscrição.
  3. E-mail **novo** = cria conta `pending` + inscrição `pending` (`user_id`).
  4. Conflito (já inscrito) = mensagem atual de "já inscrito".

### Porta 2 — cadastro novo via `/login` (como é hoje, sem mudanças)
- Cria conta `pending` sem inscrição ⇒ fila do **superadmin** (usuarios sem
  vínculo com evento; ex.: quem quiser programar eventos próprios).

### A) Nova seção "Pedidos de inscrição" no `/admin/dashboard`
- Visível apenas para papel **admin de evento** (staff não vê).
- Escopo: `event_registrations` com `registration_status='pending'`,
  filtrado pelos eventos administrados (padrão `evIn`/`evBind` de
  `routes/auth.js:386-677`).
- Linhas: evento, nome, e-mail, status da conta (aprovada / "conta aguardando
  aprovação"), data do pedido e link **"Analisar"** →
  `/admin/events/:id/participants/:regId/review` (reutiliza a análise atual;
  não duplicar lógica de decisão no dashboard).

### B) Aprovação implícita de conta na análise
- Em `POST /admin/events/:id/participants/:regId/review` (events.js:3912),
  na decisão `approved`:
  - Se `registration.user_id` aponta para conta `pending` (ou `user_id` nulo
    mas e-mail casa com conta `pending`): aprovar a conta
    (`is_public=1, approval_status='approved', approved_at/by`) +
    `queueAccountApproved` + registro de auditoria.
  - Conta já aprovada: nada muda.
  - **Rejeição não altera a conta** (segue pendente para o superadmin
    decidir).

## 5. Avisos na interface (decidido separadamente, ainda não saído da discussão)

Contexto: leigo pode pedir cadastro via `/login` achando que quem analisa é a
equipe do evento; esclarecer que ali quem analisa é a administração do sistema.

Arquivos: `views/login.ejs` (links, ~linhas 70-76 — **vermelho, chamativo**,
padrão `var(--danger)`/`--danger-subtle`/`--danger-border`), `views/public/
register.ejs:58` e `views/public/home.ejs:67` (aviso abaixo do botão).

Texto depende do item 6:

- **A** (fluxo atual): "Este pedido é analisado pela administração do sistema.
  Após a aprovação do cadastro você poderá solicitar a inscrição na página do
  evento desejado."
- **B** (minimal): "⚠ Este pedido é analisado pela administração do sistema,
  não pela equipe dos eventos."

## 6. Decisão pendente: sequência de entrega

- **Opção A ou B agora** — avisos coerentes com o fluxo atual; Porta 1 fica
  para depois.
- **Opção C** — implementar **primeiro a Porta 1** (mudanças em
  `requireNonAdminAuthorAccess`, formulário de inscrição, rota de inscrição,
  seção no dashboard do admin, aprovação implícita de conta) e só depois
  publicar os avisos — passando a usar o texto original:
  "Este pedido é analisado pela administração do sistema. Para participar de
  um evento, solicite a inscrição na própria página do evento."
  (Correto pois a Porta 1 cria conta `pending` + inscrição `pending` de uma vez.)
- Recomendação anterior: se a meta final é a Porta 1, sequência natural é a
  Opção C (avisos entram coerentes com a nova realidade).

## 7. Pontos já decididos pelo usuário

- Papel com acesso: **apenas admin do evento** (não staff).
- Ação na seção do dashboard: **link para a página de análise existente**.
- Aprovação de inscrição **aprova a conta** (item 4B).
- Aviso no `/login` em **vermelho bem chamativo**.
- Texto do aviso será o sugerido (falta escolher entre A/B/C do item 6).

---

## 8. Conversa sobre o assunto (transcrição resumida, em ordem cronológica)

**Pergunta:** "Como poderia implementar o seguinte comportamento: a) os admin de Evento poderiam autorizar pedidos de inscrição no sistema de novos usuários que estão solicitando inscrição para os eventos que administram (vindo, por exemplo, da página do evento?); b) seria simplesmente incluir os pedidos de inscrição no sistema na view de dashboard dos usuários que são admin daquele evento?"

**Resposta inicial:** apresentei o fluxo atual (inscrição pendente em `event_registrations`, análise em `/admin/events/:id/participants/:regId/review`, dashboard escopado por papel com seções de pendências) e perguntei três pontos: (1) escopo do papel (só admin ou também staff); (2) ação no dashboard (link para análise existente ou aprovar/negar inline); (3) se "novos usuários" incluiria também a aprovação da **conta** (`users.approval_status`), hoje exclusiva do superadmin.

**Pergunta:** "1. Apenas admin do Evento. 2. Link para a página de análise, tal como atualmente para o admin@admin.com. 3. Aprovação de criação da conta. Minha dúvida é se um usuário não vier por inscrição em Eventos, mas simplesmente quiser criar uma conta para poder programar seus próprios Eventos."

**Resposta:** verifiquei o fluxo de contas em código (resumo no item 1 deste documento) e propus (a) seção "Pedidos de inscrição" no dashboard para admin de evento; (b) aprovação implícita da conta pendente quando a inscrição for aprovada, com e-mail do link de primeira senha; (c) recomendação de manter contas sem vínculo com evento **na fila do superadmin** como hoje. Perguntei se o desenho do 3 (aprovação implícita) estava OK.

**Pergunta:** "Mas aí um novo usuário teria duas formas de solicitar cadastro no sistema? a) Uma vinda da página de inscrição em Evento, onde qualquer admin daquele evento poderia ver; b) Outra pela página http://127.0.0.1:3000/login"

**Resposta:** examinei o código de inscrição e descobri o ponto-chave: a inscrição exige login (`requireNonAdminAuthorAccess` → `/login`), e login exige conta aprovada. Por isso, a conta pendente jamais teria inscrição pendente — impedimento lógico ("ovo e galinha"). Respondi: sim, com o objetivo (a) haverão **duas portas de entrada, mas um único processo de conta**: Porta 1 (página do evento: formulário combinado que cria conta `pending` + inscrição `pending`, analisadas pelo admin do evento) e Porta 2 (`/login` → "Solicitar Cadastro": conta `pending` sem inscrição, fila do superadmin como hoje). Detalhei regras de e-mail (aprovado → exige login; pendente → reutiliza conta; novo → cria ambos) e perguntei se o autor/submissão de artigos também precisaria da mesma porta.

**Pergunta:** "Mas um usuário leigo no sistema pode sem querer pedir cadastro no sistema via /login. Dessa forma o admin de Evento não veria essa solicitação. Talvez um aviso explícito em /login para deixar claro que solicitar cadastro no sistema por ali não significa que quem fará a análise é a equipe do Evento ao qual ele quer se registrar, mas sim a administração do sistema."

**Resposta:** concordei e propus avisos: (1) `/login` junto ao link "Solicitar novo cadastro"; (2) ajuste do texto em `/cadastro` (register.ejs); (3) aviso opcional na home abaixo do botão. Sem mudanças de backend.

**Pergunta:** "1. Nos dois. 2. Pode ser esse texto sugerido."

**Resposta:** apresentei o plano final com os três arquivos e o texto sugerido.

**Pergunta:** "No 1. o texto de aviso deve ser em vermelho, bem chamativo."

**Resposta:** atualizei o item 1: aviso em `var(--danger)` vermelha, com opção de caixa de destaque (`--danger-subtle`/`--danger-border`) ou só texto vermelho. Perguntei qual estilo.

**Pergunta:** "Tem algo que estou estranhando: quando em 1. você diz '... solicite a inscrição na própria página do evento (após ter conta aprovada)', mas se é um usuário novo ele ainda não tem conta aprovada."

**Resposta:** reconheci a contradição: o texto proposto antecipa a Porta 1, que **ainda não existe** — descreveria uma realidade inexistente. Ofertei: Opção A (texto coerente com o fluxo atual: "Após a aprovação do cadastro você poderá solicitar a inscrição na página do evento"), Opção B (aviso minimal: "Este pedido é analisado pela administração do sistema, não pela equipe dos eventos") ou Opção C (implementar **primeiro a Porta 1** e então usar o texto original, que passaria a estar correto). Recomendei a Opção C como sequência natural se a meta final for a Porta 1.

**Pergunta:** "Salve esse plano no arquivo 'plano_inscricao.md' para eu poder avaliar melhor depois."

**Resposta:** criei este arquivo com o plano consolidado (itens 1-7).

**Pergunta:** "Pode incluir no arquivo toda a conversa que tivemos sobre esse assunto da inscrição."

**Resposta:** acrescentada esta seção 8 com a transcrição.
