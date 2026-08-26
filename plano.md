# Plano de Implementação — Geomrit-Submissão (V0.2 → V1)

Plano aprovado pelo usuário, organizado em 4 ciclos de execução sequencial.
Documento vivo: atualizar o `Status` de cada item conforme a execução.

> **Sobre a V0.2**: versão de lançamento inicial do projeto. Consolida a funcionalidade entregue (eventos, inscrições, submissão/artigos, presença por QR, certificados, e-mails transacionais, avaliações, triagem de inscrições etc.) e o **hardening de segurança** de 24/08/2026 (Ciclo 6 do plano). As pendentes de hardening seguem listadas e a serem implementadas a partir desta versão.

## Convenções do projeto
- Node.js/Express + SQLite (`better-sqlite3`) + EJS + PDFKit.
- Root: `/media/ham1/350_EXT4/Codigo/artigos/geomrit-submissao`.
- Timestamps UTC-3 (`datetime('now','-3 hours')`), CSRF global (`security/csrf.js`).
- Sem hot-reload: **restart obrigatório** após mudança em `routes/`, `services/` ou `server.js`.
- Seed: `admin@admin.com` / `123456` (super-admin).
- Toda mudança documentada em `submissao.md` + `submissao_log.md`.
- DB dev: `artigos.db` (WAL, `foreign_keys=ON`).

## Decisões do usuário
- Presença é **por aula** (não por evento), sem flag presencial/remoto.
- QR Code: exige **domínio HTTPS**; fluxo de **auto-check-in** (participante) + **proxy por admin** (operador).
- Evento encerrado: status **`'encerrado'`** explícito (não reutilizar `draft`/`published`).
- "Não possui curso de graduação": disponível em **todas** as áreas de formação; ao selecioná-la, **esconder** Titulação e Status.
- Módulos novos nesta roadmap: **somente e-mails** (Fase 3).
- Ordem: **Fase 0 → Fase 1 (Aulas+QR) → Avaliação de atividades → Fase 3 (E-mails) → Fase 2 (Auditoria)** (ordem ajustada em 17/08 a pedido do usuário: troca E-mails/Auditoria e inserção da Avaliação de atividades como próxima execução; nomes das fases mantidos).
- Inscrições públicas podem ser de confirmação automática ou sujeitas à análise da organização, inclusive com aprovação parcial das atividades solicitadas.

---

## Entrega complementar — triagem de inscrições

Status: **CONCLUÍDO (código + verificação técnica)**.

- Eventos possuem o modo `registration_approval_mode`: `automatic` confirma a inscrição imediatamente; `review` registra a solicitação como pendente para análise administrativa.
- A análise permite aprovar todas, algumas ou nenhuma das atividades solicitadas, registra responsável, data e observação e só cria vínculos de atividade para itens aprovados.
- Solicitações pendentes não entram no contador de inscritos; a listagem administrativa mostra a coluna **Em análise** em laranja quando o total é diferente de zero.
- A área do participante e as páginas públicas exibem corretamente os estados pendente, aprovado, parcialmente aprovado e recusado. Em eventos sujeitos à análise, a seleção de atividades decidida pela administração fica bloqueada ao participante.
- Os gatilhos de e-mail cobrem o recebimento da solicitação, o resultado da análise e alterações posteriores de atividades feitas pela administração.

---

## Entrega complementar — página do evento em PDF

Status: **CONCLUÍDO (código + verificação técnica)**.

- O formulário de criação/edição aceita um PDF opcional de até 50 MB, com substituição e remoção do documento anterior.
- Eventos publicados ou encerrados disponibilizam uma URL estável em `/evento/:id/conteudo`, com visualização incorporada e acesso direto ao arquivo.
- Eventos em rascunho mantêm o PDF privado até sua publicação; a exclusão do evento também remove o arquivo armazenado.

---

## Entrega complementar — descrição de palestras e minicursos

Status: **CONCLUÍDO (código + verificação técnica)**.

- Palestras e minicursos possuem descrição breve ou ementa de até 2000 caracteres na criação e edição administrativa.
- O conteúdo é persistido em `event_activities.description`; ao mudar a atividade para outro tipo, a descrição é removida.
- A página pública do evento apresenta a informação na nova coluna **Descrição / Ementa** da tabela de atividades.

---

## Ciclo 1 — Fase 0: Quick Wins
Status geral: **CONCLUÍDO (código + verificação)**; documentação e verificação final do refinamento 0.3 pendentes.

### 0.1 Dashboard — novos contadores — CONCLUÍDO ✔
- Arquivos: `routes/auth.js` (GET `/dashboard`), `views/admin/dashboard.ejs`.
- Adicionados: `totalUsers`, `concludedEvents` (`date_end < brToday`), `futureRegistrations` (inscrições em eventos com `date_start >= brToday`).
- Verificado via curl: contadores corretos.

### 0.2 `/author/profile` — telefone, formação e troca de senha — CONCLUÍDO ✔
- Arquivos: `security/validation.js` (`participantProfile`), `routes/public.js` (helpers `renderParticipantProfile`, `validateParticipantFormacao`; GET/POST), `views/public/participant-profile.ejs`.
- Adicionados: campo telefone, seção formação (área/curso/titulação/status), seção "Trocar senha" (current/new/confirm, bcrypt, `password_changed=1`).
- Verificado: renderiza, salva e troca de senha funciona (login com nova senha OK).

### 0.3 Opção "Não possui curso de graduação" — CONCLUÍDO ✔ (refinamento 0.3b/c/d: código ok, verificação funcional pendente)
- **Base (0.3):** `services/academic-formation.js` — constante `NO_DEGREE_COURSE`, `getCursosByArea` a insere a opção; deduplicação: `routes/users.js` e `routes/events.js` usam `getCursosMap()` do serviço.
- **Refinamento 0.3b:** opção aparece em **todas** as áreas (não só "Outros"/11).
- **Refinamento 0.3c:** titulação/status opcionais quando o curso é o especial; `normalizeFormacaoForStorage` (`routes/auth.js`) e normalização no POST (`routes/public.js`) gravam `null`.
- **Refinamento 0.3d:** esconder Titulação/Status nos 4 templates (wrapper `#formacao-titulacao-status` + `hidden`/`display:none` + JS `syncTitulacaoVisibility` + toggle de `required`):
  - `views/admin/users/form.ejs`
  - `views/complete-profile.ejs`
  - `views/public/participant-profile.ejs`
  - `views/admin/events/participant-form.ejs`
- Handlers: `routes/users.js` (create + `updateUser`) e `routes/events.js` (`updateParticipant`) gravam `null` quando curso especial.

### 0.4 Status `encerrado` para eventos — CONCLUÍDO ✔
- Arquivos: `routes/events.js`, `routes/public.js`, `views/admin/events/form.ejs`, `views/admin/events/list.ejs`, `views/public/event.ejs`.
- `normalizeEventStatus` helper; `POST /:id/close` (published→encerrado); select 3 opções no form; badge âmbar + botão "Encerrar" na list; home exclui encerrados; `/evento/:id` e `/evento/:id/certificates` aceitam `IN ('published','encerrado')`; timeline remove ações de inscrição/submissão quando encerrado; `.closed-notice` no template.
- Verificado: publish→home→close→home, inscricao/submeter=404, certificates=200.
- Obs: `events.status` é TEXT sem CHECK constraint → sem migração.

### Correção de bug pré-existente (fora de escopo, detectada) — CONCLUÍDO ✔
- `views/error.ejs:23`: `<%= message || '' %>` → `<%= locals.message || '' %>` (ReferenceError em ~20+ rotas 404).

### Pendências do Ciclo 1
- [ ] Verificação funcional do refinamento 0.3b/c/d (especial em área ≠ 11; titulação/status ocultos; POST sem eles → sucesso + `null` no DB).
- [x] Atualizar `submissao.md` + `submissao_log.md` cobrindo Fase 0 (0.1–0.4) + refinamento 0.3 + fix do `error.ejs` (concluído em 2026-08-14).

---

## Ciclo 2 — Fase 1: Aulas + QR Code
Status geral: **CONCLUÍDO (código)**. A maior parte foi entregue e validada em 16–17/08 (ver `submissao_log.md`); o fluxo do QR do crachá (1.5b/1.6b/1.7b) está implementado e validado E2E (36/36, 17/08); commitado em 18/08.
Nomenclatura: "aulas" foram implementadas como **etapas** (`activity_sessions`) de uma atividade, conforme alinhado em 16/08.

### 1.1 Modelo de dados — etapas — CONCLUÍDO ✔
- Tabela `activity_sessions` (etapas vinculadas à atividade: nome, `sequence_no`, data, carga horária; FK `ON DELETE CASCADE`) — 16/08.
- Coluna `session_id` em `activity_attendance_records` (presença **por etapa**) + índices parciais únicos (por pessoa sem etapa e por pessoa+etapa) — 16/08.
- `min_sessions` em `events`: **não adotada** — a elegibilidade usa "Presença mínima (%)" por papel em `event_certificate_rules` (default 75; revisor 0), aplicada atividade a atividade por tipo (16/08).

### 1.2 CRUD de etapas (admin) — CONCLUÍDO ✔
- `GET/POST .../activities/:activityId/sessions` + edição/remoção por etapa (`strictLimiter`) — 16/08.
- Data da etapa validada contra o intervalo da atividade; exibição/ordem por `sequence_no`.

### 1.3 Chamada por etapa — CONCLUÍDO ✔
- Chamada com abas por etapa; marcar/atualizar/remover por `session_id` (nulo sem etapas); lote ("Marcar/Desmarcar (todos)") também por etapa — 16/08.
- Sem flag presencial/remoto (conforme decisão do usuário).

### 1.4 PDF de lista (por etapa) — CONCLUÍDO ✔
- `attendance-print?session_id=` com cabeçalho de etapa/data; botão "Imp. Lista · <etapa>" por etapa na listagem — 16/08.

### 1.5 QR Code — impressão — CONCLUÍDO ✔
- (a) Folha letter por etapa com QR do link de presença (`GET .../checkin-print`) — 16/08; dependência `qrcode` instalada.
- (b) Crachá com QR **pessoal** do participante: token por usuário/evento em `event_qr_codes`, exibido em `/evento/:id/qr-presenca` e imprimível em PDF via `/evento/:id/qr-presenca/print` (padrão das rotas de impressão; o `onclick` de `window.print()` era bloqueado pela CSP `script-src-attr 'none'` do helmet 8) — implementado e validado E2E (17/08), commitado em `61ac481`.
- (c) Credenciamento: botão "Imprimir crachá" por participante na coluna "Conta" de `/admin/events/:id/participants` (`GET .../participants/:registrationId/qr-presenca/print`), PDF direto sem passar pela área do participante (bug de conta admin); layout extraído para `services/cracha.js` — implementado e validado (17/08), commitado em 18/08.

### 1.6 Leitura do QR — CONCLUÍDO ✔
- (a) Participante: câmera própria abre o link da folha → auto-check-in em `/presenca/...` — 16/08.
- (b) Operador: câmera + **jsQR servido localmente** (`public/lib/jsQR.min.js`, sem CDN por causa da CSP) + fallback de digitação manual, na própria página de chamada — implementado e validado E2E (17/08), commitado em 18/08.
- Não há rota `/presenca-qr` separada: a leitura do operador está embutida em `.../attendance` (mesma etapa selecionada).

### 1.7 Fluxo de check-in — CONCLUÍDO ✔
- **Auto-check-in:** `/presenca/:eventId/:activityId(/:sessionId)` — login com retorno via `?next=`, papel exercido, janela de data (dia da etapa / período da atividade, UTC-3) — 16/08.
- **Proxy por admin:** `POST .../attendance/qr` marca a presença da pessoa do crachá, com papel resolvido automaticamente e auditoria `via_qr` — implementado e validado E2E (17/08), commitado em 18/08.
- HTTPS: a câmera exige HTTPS (ou localhost); fallback de digitação manual coberto. A origem do link da folha vem do campo "URL do Evento" (decisão que substituiu o `BASE_URL` do plano).

### 1.8 Integração — CONCLUÍDO ✔
- Elegibilidade por percentual de etapas presentes, qualificada por tipo de atividade (apresentações oral/pôster e mesa-redonda: qualquer presença; demais: ≥ `ceil(etapas × % / 100)`) — 16/08.
- Carga horária = soma das cargas das etapas presentes (ou carga da atividade, quando sem etapas) — 16/08.

---

## Ciclo 3 — Avaliação de atividades (participante)
Status geral: **CONCLUÍDO ✔** (aprovado em 17/08; implementado e validado E2E 36/36 em 18/08; commitado em 18/08 em `700114f`).

### 3.1 Modelo de dados — avaliações — CONCLUÍDO ✔
- Tabela `activity_evaluations` (`event_id`, `activity_id`, `user_id`, `evaluation`, `created_at`, `updated_at`; `UNIQUE(activity_id,user_id)`; FKs `ON DELETE CASCADE`) em `services/db-reset.js` + inclusão na lista `TABLES` (reset).
- Avaliação opcional/removível (texto vazio remove a linha); máximo 2000 caracteres.

### 3.2 Página pública de atividades (`/evento/:id/atividades`) — CONCLUÍDO ✔
- Campo de avaliação (textarea) em cada atividade **inscrita**; evento `encerrado` mantém a página acessível com inscrições travadas (checkboxes sem envio) e apenas avaliações editáveis.
- `POST /evento/:id/atividades` (mesma rota): publicado salva inscrição + avaliações; encerrado ignora `activity_ids` e processa apenas avaliações das atividades já inscritas; IDs não inscritos ignorados (anti-tampering).

### 3.3 Visão administrativa — CONCLUÍDO ✔
- Chamada da atividade: seção "Avaliações dos participantes" (nome + data + texto, estado vazio).

### 3.4 Relatório do evento (`/admin/reports?eventId=`) — CONCLUÍDO ✔
- Card "Participantes que avaliaram" nas estatísticas: `COUNT(DISTINCT user_id)` por evento (participantes distintos, não total de avaliações).
- Card "Atividades do Evento": por atividade, contagem de avaliações + botão "Ver avaliações (n)" que expande a lista (nome + data + texto).

### 3.5 Documentação e validação — CONCLUÍDO ✔
- `submissao.md` + `submissao_log.md` + `README.md` — 18/08.
- Validação E2E em sandbox isolada (script Node) — 36/36 checks, sandbox porta 3102, 18/08.

---

## Ciclo 4 — Fase 3: E-mails
Status geral: **CONCLUÍDO (código)** — 20/08/2026.
- `nodemailer` com SMTP configurável (Zoho por padrão), templates EJS HTML/texto e logo do evento incorporado quando existe.
- Fila persistente `email_outbox`, retentativa exponencial, recuperação após reinício, deduplicação, supressão e cancelamento.
- Master switch global (superadmin) e por evento, ambos desligados por padrão; desligar cancela pendências e não há replay automático.
- Gatilhos: solicitação/aprovação de conta, lembrete às 09h do dia anterior, certificado/reemissão e inclusão/alteração/remoção de link de transmissão (atividade/etapa, consolidação de 5 minutos).
- Importações: lote persistente, autorização explícita pós-relatório, mensagens combinadas por situação e link de definição de senha de uso único (72h).

---

## Ciclo 5 — Fase 2: Auditoria
Status geral: **PENDENTE**.
- Trilha de auditoria (quem fez o quê e quando) nas operações relevantes
  (criação/edição/exclusão de usuários, eventos, inscrições, presenças).
- Tabela de eventos de auditoria + registro nos handlers existentes + listagem admin.

---

## Ciclo 6 — Auditoria de Segurança (hardening)

Data: **24/08/2026**. Auditoria pontual de segurança (análise de código + 5 agentes especializados por área).

### Correções aplicadas nesta rodada

Status: **concluído** (verificação: `node --check`, compilação EJS e `npm run verify-env` passando).

- **Bypass de CSRF (CRÍTICO)** — `security/csrf.js`: o token CSRF deixou de ser aceito a partir do cookie `csrf_token` (o navegador o envia automaticamente em navegações top-level cross-site com `sameSite: lax`); agora só `header X-CSRF-Token` ou body `_csrf`. Função `getCookieValue` e o cookie `csrf_token` removidos.
- **`crypto.timingSafeEqual` frágil** — `security/csrf.js`: protegido contra buffers de comprimentos diferentes (tokens de tamanho inválido agora geram 403 em vez de 500).
- **Session fixation (CRÍTICO)** — `routes/auth.js`: `req.session.regenerate()` após verificar a credencial no login, preservando o destino pós-login (`?next=`).
- **`RequireSuperAdmin` frágil** — `security/super-admin.js`: passou a validar no banco `is_public`, `is_admin`, `approval_status != pending`, `password_changed == 1` e `isAdmin` na sessão, não apenas `session.userEmail === 'admin@admin.com'`.
- **Log de credenciais** — `services/db-reset.js`: removido o `console.log` que expunha `admin@admin.com / 123456` em logs; troca de senha continua obrigatória no primeiro acesso (`password_changed=0`).
- **Migração de senhas em plaintext** — `services/db-reset.js`: `admins`/`reviewers` migrados passam por `bcrypt.hashSync` em vez de gravar a senha cruza em `users.password` (`password_changed=0` mantém a troca obrigatória).
- **Path traversal no upload de importação** — `routes/users.js`: `filename` do Multer usa `path.basename(file.originalname)`.
- **Reset de senha fraco** — `routes/users.js`: removida a hardcoded `123456`; agora gera senha temporária forte/aleatória (`crypto.randomBytes`), valida o ID do usuário e exibe o valor em tela (não em query param).
- **XSS stored por JSON cru** — `server.js` + `views/admin/events/participant-form.ejs`: JSON de `selectedExistingUser` (dado de conta controlável) injetado em `<script>` passou por `jsonForScript()` (helper exposta como `res.locals.jsonForScript`), escapando `<`, `>`, `/` e os delimitadores Unicode U+2028/U+2029.

### Reavaliação (falsos positivos descartados)

- **`XSS reflexivo em certificado/consultar artigo`**: reavaliado e **descartado** — as views renderizam com `<%= %>` (autoescape do EJS 3.1.10), não havendo injeção.

### Pendentes — hardening remanescente (maior escopo / exigem decisão)

- **Impersonação/preview** — escopar a prévia (`server.js:144-185`, `routes/users.js:479-513`): exigir re-autenticação; limitação a leitura; não replicar `isAdmin`/`isReviewer`; expirar `previewUserId`.
- ~~**ZIP-bomb / descompressão no restore**~~ — **RESOLVIDO em 2026-08-24** (ver `submissao_log_v2.md`): os tetos de tamanho descomprimido/comprimido e a razão de compressão estavam lendo `entry.size`/`entry.compressedSize` (inexistentes no `adm-zip` — código morto); corrigidos para `entry.header.size`/`entry.header.compressedSize`. A limitação de nº de arquivos (100.000) e a troca atômica da conexão do DB via proxy `setDb` já existiam.
- **Spoof de IP no rate limiting** — **RESOLVIDO em 2026-08-25** (ver `submissao_log_v2.md`): `app.set('trust proxy', 1)` removido em `server.js`, de forma que o `express-rate-limit` use o IP real da conexão (`req.ip`) e ignore o `X-Forwarded-For` spoofável enquanto não há proxy reverso controlado.
- **CSP** — remover `'unsafe-inline'`/`'unsafe-eval'` em `scriptSrc`/`scriptSrcAttr` (`server.js:34-35`) via nonce; reforçar sanitização de HTML armazenado (`sanitize-html`/`DOMPurify` — não instaladas).
- **Upload por mimetype** — definir extensão pelo `file.mimetype` (não pelo `originalname`) e não servir uploads executáveis; cobrir pontos de upload que confiam só no mimetype (`routes/events.js`).
- **(Opcional)** `requireAuth`/`requireReviewer` revalidando o DB em operações sensíveis; `session.regenerate` em troca de papéis; store de sessão persistente (Redis/sqlite3).

---

## Riscos / observações
- `qrcode` e `nodemailer` estão em `package.json`.
- `jsQR` é servido localmente em `public/lib/jsQR.min.js` (sem CDN, por causa da CSP).
- QR/câmera depende de HTTPS em produção; o fallback de digitação manual do código do crachá cobre contextos sem câmera.
- Fluxo do QR do crachá (1.5b/1.6b/1.7b) implementado e validado E2E (36/36, 17/08); commitado em 18/08.
- `parseCsvFile` em `routes/users.js` está morto (importação usa `exceljs`) — mantido, fora de escopo.
- Logo do evento (17/08) foi implementado **fora dos ciclos**: upload no formulário do evento, prévia imediata em `new`/`edit`, exibição nas páginas públicas e nos PDFs (crachá, lista de presença, folha com QR Code). O `fileFilter` do Multer foi corrigido para aceitar explicitamente PNG/JPEG e permitir a gravação em `uploads/event-logos/`; validações técnicas de sintaxe, templates e schema concluídas, e validação funcional pelo usuário confirmada após o reinício do servidor (18/08) — ver `submissao_log.md`.
- Correção da prévia da área do participante (18/08) foi implementada **fora dos ciclos**: impersonação por sessão — as ações na prévia (`GET /admin/users/:id/participant`) são registradas em nome do usuário visualizado, e a identidade do admin é restaurada automaticamente em qualquer request em `/admin/*`; validação E2E no servidor real concluída e commitado em `a301f8e` — ver `submissao_log.md`.
- Card de atividades com link de transmissão (18/08) foi implementado **fora dos ciclos**: coluna `video_url` em `event_activities`, campo no cadastro/edição de atividades e card "Atividades do Evento" na página pública do evento (atividades ordenadas por data, link ao lado do nome); validação E2E 20/20 em sandbox isolado — ver `submissao_log.md`.
- Descrição breve das etapas (25/08) foi implementada **fora dos ciclos**: coluna `description` (máx. 2000 caracteres) em `activity_sessions` com migração idempotente, campo no formulário de criação/edição de etapas, coluna "Descrição" na listagem administrativa e exibição da descrição na sub-linha da etapa na página pública do evento — ver `submissao_log_v2.md`.
- Cor da linha de sessão uniformizada (25/08): todas as células da linha de sessão/etapa/tarefa passaram a usar `color: #94a3b8`, e a descrição da atividade passou a usar `color: #f8fafc` (inline), diferenciando visualmente atividade de tarefa na página pública do evento — ver `submissao_log_v2.md`.
