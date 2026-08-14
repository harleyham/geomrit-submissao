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
- Ordem: **Fase 0 → Fase 1 (Aulas+QR) → Fase 2 (Auditoria) → Fase 3 (E-mails)**.

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
Status geral: **PENDENTE**.

### 1.1 Modelo de dados — aulas
- Nova tabela `activity_sessions` (aulas/sessões vinculadas a evento/atividade).
- Coluna `min_sessions` em `events` (mínimo de aulas para elegibilidade).
- Coluna `session_id` nas presenças (presença **por aula**).

### 1.2 CRUD de aulas (admin)
- Listar/criar/editar/excluir aulas por evento.
- Validação de ordem/duração conforme necessário.

### 1.3 Chamada por aula
- Registro de presença por aula (substitui/estende a presença por atividade).
- Sem flag presencial/remoto.

### 1.4 PDF de lista (por aula)
- PDF da lista de presença de cada aula.

### 1.5 QR Code — impressão
- Geração do QR por participante (requer dependência `qrcode` — ainda não está em `package.json`).
- QR impresso (crachá/comprovante).

### 1.6 `/presenca-qr` — leitura
- Página de leitura com câmera + **jsQR vendido localmente** (`public/lib/`; CSP `scriptSrc ['self','unsafe-inline']` → sem CDN).
- Fallback de digitação manual do código.

### 1.7 Fluxo de check-in
- **Auto-check-in:** participante escaneia e registra presença na aula.
- **Proxy por admin:** operador registra presença de terceiros.
- Exige **domínio HTTPS** (acesso à câmera) — documentar `BASE_URL` no `README.md`.

### 1.8 Integração
- Elegibilidade do certificado condicionada a `min_sessions`.
- Carga horária calculada por aulas presenciais.

---

## Ciclo 3 — Fase 2: Auditoria
Status geral: **PENDENTE**.
- Trilha de auditoria (quem fez o quê e quando) nas operações relevantes
  (criação/edição/exclusão de usuários, eventos, inscrições, presenças).
- Tabela de eventos de auditoria + registro nos handlers existentes + listagem admin.

---

## Ciclo 4 — Fase 3: E-mails
Status geral: **PENDENTE**.
- Novo módulo de e-mails (dependência `nodemailer` — ainda não está em `package.json`).
- Configuração SMTP (env vars), templates EJS, fila/falha com log.
- Gatilhos: confirmação de inscrição, confirmação de presença/aula, certificado disponível, etc.

---

## Riscos / observações
- `qrcode` e `nodemailer` ainda não estão em `package.json` (instalar na Fase 1 e Fase 3, respectivamente).
- QR/câmera depende de HTTPS em produção.
- `parseCsvFile` em `routes/users.js` está morto (importação usa `xlsx`) — mantido, fora de escopo.
