# Plano: admin por evento (autorização escopada) + STAFF + revisor por evento

> **Documento histórico, superado em 31/08/2026 e corrigido em 01/09/2026.** Este arquivo preserva a proposta original e não descreve integralmente o modelo vigente. A implementação final está documentada em `plano.md`, `submissao_log_v2.md` e `manual.md`. No modelo atual, `/admin/users` e `/admin/dashboard` são exclusivos do superadministrador; `staff` não acessa artigos, pareceres ou relatórios; e o acesso a cada artigo pelo revisor exige simultaneamente atribuição e papel `reviewer` ativo no evento.

> Contexto: no estado atual, um usuário com papel de admin de evento acaba com poder
> sobre **todo** o sistema (via escalada em `requireAuth`), porque `event_user_roles
> role='admin'` é confundido com `session.isAdmin`/`is_admin` (admin global). Além disso,
> o papel de revisor depende de uma flag global (`users.is_reviewer`) e não há perfil de
> apoio ao evento (STAFF).
>
> Este plano (1) substitui o "admin global" por um **admin escopado por evento**, (2)
> cria o perfil **STAFF** escopado ao evento, e (3) faz do **revisor um papel por evento**
> (hoje controlado por flag global). Mantém `admin@admin.com` como única raiz global.

## 1. Modelo de papéis consolidado

| Capacidade | Super-admin | Admin de evento | STAFF (novo) | Revisor |
|---|---|---|---|---|
| Criar evento | sim | sim → vira admin dele | não | não |
| Administrar evento | todos | só os que admin (criados + delegados) | não | não |
| Delegar admin de evento | sim (no que quiser) | só no **seu** evento | não | não |
| Ver artigos/relatórios | todos | **só dos seus eventos** | não | só dos eventos que revisa |
| Gerenciar usuários (`/admin/users`) | sim (concede admin) | sim (não concede admin) | não | não |
| Aprovar usuários | sim | sim | não | não |
| Marcar presença (evento) | sim | sim | **sim (seu evento)** | não |
| Registrar participantes no local | sim | sim | **sim (só participant)** | não |
| Crachás / certificados (listas) | sim | sim | **sim (seu evento)** | não |
| Painel de revisão | — | — | — | **só eventos que revisa** |
| Backup / reset / e-mails | sim | não (`requireSuperAdmin`) | não | não |

**Professor / palestrante (`teacher` / `speaker`)**: já são **por evento** via
`event_user_roles` (um usuário pode ser professor+revisor num evento e somente
participante em outro). Sem mudança de escopo — apenas confirmados.

Regras de origem (sessão, populada do banco a cada request):
- `session.isAdmin` (super-admin): `is_admin=1` **e** (email === `admin@admin.com` **ou** 0 eventos — bootstrap).
- `session.isEventAdmin` / `session.eventAdminIds`: `event_user_roles role='admin'`, independente de `is_admin`.
- `session.isStaff` / `session.staffEventIds`: `event_user_roles role='staff'`.
- O acesso de revisor é consultado diretamente no banco: papel `event_user_roles role='reviewer'` ativo no evento **E** atribuição em `assignments` para o artigo. A flag global `users.is_reviewer` não autoriza acesso.

## 2. O que muda (arquivo a arquivo)

### 2.1 `security/authz.js` (módulo novo) — helpers compartilhados
- `isSuperAdmin(req)` → `req.session.isAdmin === true`
- `canAccessEvent(req, eventId)` → super-admin `OU` eventId ∈ (`eventAdminIds` ∪ `staffEventIds` ∪ `reviewEventIds`)
- `viewableEventIds(req, roles)` → super-admin: `null` (todos); senão a interseção dos conjuntos pelos papéis pedidos
- `requireAdmin` / `requireStaff` / `requireReviewer` → middlewares que exigem o papél correspondente (por evento, quando aplicável)

### 2.2 `routes/auth.js`
- `requireAuth` (linha ~179): para de escalar `event-admin → isAdmin`. Permite super-admin, admin de evento, STAFF ou revisor e popula `session.isAdmin` / `session.isEventAdmin` / `session.isStaff` / `session.isReviewer` + os respectivos `*Ids` direto do banco (fresco, a cada request).
- `doLoginAfterRegen` (linha ~546): deriva `isEventAdmin` / `isStaff` / `isReviewer` de `event_user_roles` (e `assignments` para revisor); `isAdmin` restrito a super-admin/bootstrap.
- Dashboard (linha ~212): super-admin global; escopado ao papél (event-admin/staff/revisor) pelos eventos correspondentes.

### 2.3 `routes/articles.js`
- `requireAuth` local → `requireAdmin`.
- `GET /`: dropdown de evento só com eventos visíveis; rejeita `eventId` fora do escopo.
- Rotas `/:id*` (detalhe, download, PUT, DELETE, assign, final-decision): conferem `canAccessEvent(article.event_id)`.

### 2.4 `routes/reports.js`
- Mesmo padrão que `articles.js` (dropdown escopado + verificação por evento nas rotas de decisão).

### 2.5 `routes/users.js`
- `requireAuth` local → `requireAdmin`.
- Conceder `is_admin` (criar `~430`, update `~644/~668/~681`, bulk `~847`): **somente** se `req.session.isAdmin` (super-admin). Event-admin/STAFF forçam `is_admin=0`.
- Aprovar / editar / deletar usuários: permitidos (super-admin e admin de evento), com proteções existentes mantidas (conta `admin@admin.com` intocável; ≥1 admin ativo). STAFF **não** gerencia usuários.

### 2.6 `routes/events.js` + `server.js` — criação self-service
- Gate por evento (`events.js:191`) e delegação de papéis (`events.js:2599-2631`) já são escopados — **sem mudança**.
- `server.js:229`: remove `requireAuth` do mount `app.use('/admin/events', requireAuth, eventsRouter)`.
- Dentro de `events.js`: `GET /` (listagem) → `requireAdmin`; `GET /new` e `POST /` (criação) → `requireApprovedUser`.
- Rotas `/:id*` continuam protegidas pelo router-level `events.js:191`.
- `events.js:867` continua grantando `admin` ao criador.

### 2.7 Middlewares novas
- `requireApprovedUser`: passa se usuário logado (`session.userId`) **e** `is_public=1` **e** `approval_status != 'pending'`. Impede contas pendentes/inativas de criar evento.
- `requireStaff`: passa se `session.isStaff` e o `event_id` da rota ∈ `session.staffEventIds`.

## 3. Perfil STAFF (novo)

- `db-reset.js`: adiciona `'staff'` ao CHECK de `event_user_roles.role` + **migração idempotente** da tabela existente (hoje: `'admin','participant','reviewer','speaker','teacher','oral_presenter','poster_presenter'`).
- Acesso escopado aos `staffEventIds`, reusando a lógica existente:
  - Marcar presença: rotas de marcação (`events.js:2232` manual, `2203` QR, `2263` bulk) — gate → `requireStaff` no evento.
  - Registrar participantes no local: reusa `events.js:2793` (`account_mode='new'`), limitado ao papel `participant` (sem `is_admin`).
  - Listas de crachás: `services/cracha.js:32` (papéis do evento).
  - Listas de certificados: rotas de geração de lista do evento, gate → `requireStaff`.
  - Ver a lista de participantes do evento.
- UI: navegação/redirecionamento do STAFF para seus eventos; badges de papel `staff` nos templates de participante/papéis.

## 4. Revisor por evento

- `reviewer.js`: o gateway exige papel `reviewer` em ao menos um evento; dashboard, detalhe e envio de parecer repetem a autorização pelo evento do artigo e exigem atribuição correspondente.
- `doLoginAfterRegen` / `authz`: `session.isReviewer` derivado dos dois canais (papel no evento e atribuição de artigo).
- Dashboard (`reviewer.js:8-65`): passa a filtrar pelos eventos que revisa (union dos dois canais), mantendo a carga por `assignments.reviewer_id`.
- UI: badge de revisor passa a refletir o evento (conforme já exibido em `events.js`/`reports.js` via union).

## 5. Invariantes de segurança (mantidos)
- Backup / reset de banco / toggle de e-mails continuam sob `requireSuperAdmin` (`admin@admin.com`).
- Proteções de "último admin ativo" (`getActiveAdminCount` / `isRemovingLastActiveAdmin`) e conta `admin@admin.com` intocável.
- Rotação de token CSRF pós-login (`session.regenerate` + novo `csrfToken` em `res.locals.csrfToken`) e `session.regenerate` de fixação permanecem.
- `event_user_roles.role` permanece restrito ao CHECK SQL (somente acrescida de `staff`).

## 6. Validação (E2E em sandbox isolado)
1. Usuário comum approved → cria evento → 302 → vira admin dele; dashboard escopado apenas àquele evento.
2. Artigos/relatórios de outros eventos → 403/redirecionamento para `/admin`.
3. Event-admin edita usuário mas não consegue setar `is_admin` (forçado a 0); super-admin consegue.
4. Event-admin delega admin de evento apenas no seu evento; super-admin delega em qualquer evento.
5. STAFF marca presença, registra participante e gera lista de crachás **só no seu evento** (403 em eventos alheios); não gerencia usuários.
6. Revisor vê só artigos dos eventos que revisa (por papel `event_user_roles` e por atribuição `assignments`); flag global `is_reviewer` não controla mais o acesso.
7. Super-admin: backup/reset funcionam; event-admin/STAFF/revisor: 403 nas funções reservadas.
8. `node --check` em `authz.js`, `auth.js`, `articles.js`, `reports.js`, `users.js`, `events.js`, `reviewer.js`, `db-reset.js`, `server.js`; `npm run verify-env` passando.

## 7. Ordem de execução recomendada
- **Fase 1** — núcleo de autorização (`security/authz.js` + `auth.js`): define super-admin, admin de evento, STAFF e revisor e as sessions/flags.
- **Fase 2** — escopar visualização (`articles.js`, `reports.js`, dashboard).
- **Fase 3** — gestão de usuários (`users.js`).
- **Fase 4** — criação self-service (`events.js`, `server.js`, `requireApprovedUser`).
- **Fase 5** — perfil STAFF (`db-reset.js` migração do CHECK + rotas escopadas de presença/registro/crachás + UI).
- **Fase 6** — revisor por evento (`reviewer.js` gate + dashboard escopado; `doLoginAfterRegen`).

Efetiva após reinício do servidor. Não exige migração de banco (exceto a adição idempotente de `staff` ao CHECK de `event_user_roles`).
