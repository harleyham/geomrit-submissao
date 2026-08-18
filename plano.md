# Plano de Implementação — Geomrit-Submissão (V0.1 → V1)

Plano aprovado pelo usuário, organizado em 4 ciclos de execução sequencial.
Documento vivo: atualizar o `Status` de cada item conforme a execução.

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
Status geral: **CONCLUÍDO (código)**. A maior parte foi entregue e validada em 16–17/08 (ver `submissao_log.md`); o fluxo do QR do crachá (1.5b/1.6b/1.7b) está implementado e validado E2E (36/36, 17/08); ainda não commitado.
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
- (c) Credenciamento: botão "Imprimir crachá" por participante na coluna "Conta" de `/admin/events/:id/participants` (`GET .../participants/:registrationId/qr-presenca/print`), PDF direto sem passar pela área do participante (bug de conta admin); layout extraído para `services/cracha.js` — implementado e validado (17/08), não commitado.

### 1.6 Leitura do QR — CONCLUÍDO ✔
- (a) Participante: câmera própria abre o link da folha → auto-check-in em `/presenca/...` — 16/08.
- (b) Operador: câmera + **jsQR servido localmente** (`public/lib/jsQR.min.js`, sem CDN por causa da CSP) + fallback de digitação manual, na própria página de chamada — implementado e validado E2E (17/08), **ainda não commitado**.
- Não há rota `/presenca-qr` separada: a leitura do operador está embutida em `.../attendance` (mesma etapa selecionada).

### 1.7 Fluxo de check-in — CONCLUÍDO ✔
- **Auto-check-in:** `/presenca/:eventId/:activityId(/:sessionId)` — login com retorno via `?next=`, papel exercido, janela de data (dia da etapa / período da atividade, UTC-3) — 16/08.
- **Proxy por admin:** `POST .../attendance/qr` marca a presença da pessoa do crachá, com papel resolvido automaticamente e auditoria `via_qr` — implementado e validado E2E (17/08), **ainda não commitado**.
- HTTPS: a câmera exige HTTPS (ou localhost); fallback de digitação manual coberto. A origem do link da folha vem do campo "URL do Evento" (decisão que substituiu o `BASE_URL` do plano).

### 1.8 Integração — CONCLUÍDO ✔
- Elegibilidade por percentual de etapas presentes, qualificada por tipo de atividade (apresentações oral/pôster e mesa-redonda: qualquer presença; demais: ≥ `ceil(etapas × % / 100)`) — 16/08.
- Carga horária = soma das cargas das etapas presentes (ou carga da atividade, quando sem etapas) — 16/08.

---

## Ciclo 3 — Avaliação de atividades (participante)
Status geral: **CONCLUÍDO ✔** (aprovado em 17/08; implementado e validado E2E 36/36 em 18/08; ainda não commitado).

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
Status geral: **PENDENTE**.
- Novo módulo de e-mails (dependência `nodemailer` — ainda não está em `package.json`).
- Configuração SMTP (env vars), templates EJS, fila/falha com log.
- Gatilhos: confirmação de inscrição, confirmação de presença/aula, certificado disponível, etc.

---

## Ciclo 5 — Fase 2: Auditoria
Status geral: **PENDENTE**.
- Trilha de auditoria (quem fez o quê e quando) nas operações relevantes
  (criação/edição/exclusão de usuários, eventos, inscrições, presenças).
- Tabela de eventos de auditoria + registro nos handlers existentes + listagem admin.

---

## Riscos / observações
- `qrcode` já está em `package.json` (instalada na Fase 1, 16/08); `nodemailer` ainda não (instalar na Fase 3).
- `jsQR` é servido localmente em `public/lib/jsQR.min.js` (sem CDN, por causa da CSP).
- QR/câmera depende de HTTPS em produção; o fallback de digitação manual do código do crachá cobre contextos sem câmera.
- Fluxo do QR do crachá (1.5b/1.6b/1.7b) implementado e validado E2E (36/36, 17/08); ainda não commitado.
- `parseCsvFile` em `routes/users.js` está morto (importação usa `xlsx`) — mantido, fora de escopo.
- Logo do evento (17/08) foi implementado **fora dos ciclos**: upload no formulário do evento, prévia imediata em `new`/`edit`, exibição nas páginas públicas e nos PDFs (crachá, lista de presença, folha com QR Code). O `fileFilter` do Multer foi corrigido para aceitar explicitamente PNG/JPEG e permitir a gravação em `uploads/event-logos/`; validações técnicas de sintaxe, templates e schema concluídas, restando validação funcional pelo usuário após reiniciar o servidor — ver `submissao_log.md`.
