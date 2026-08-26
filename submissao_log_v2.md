# Histórico Técnico do Projeto — Continuação (V2)

Registro cronológico das principais alterações no sistema de gestão de eventos, avaliação de artigos, participação, presença e certificados de participação.

Este arquivo é a continuação de `submissao_log.md`, que registra o histórico até **2026-08-23**. A partir de agora, as novas entradas devem ser registradas **aqui**, mantendo o mesmo formato: seções `## YYYY-MM-DD` com subtítulos `### <título da alteração>` e, ao final de cada item, a linha `Status: ...`.

Versão atual registrada: **V0.2**.

> **Sobre a V0.2**: consolidando o estado funcional entregue (eventos, inscrições, artigos, presença, certificados, e-mails, avaliações etc.) e o **hardening de segurança** realizado em 24/08/2026 (bypass de CSRF, session fixation, `RequireSuperAdmin`, senhas legadas em hash, path traversal no upload, reset de senha forte e XSS por JSON cru). As correções pendentes de hardening permanecem documentadas em `plano.md` (Ciclo 6).

## 2026-08-25

### Hardening: limitação de taxa immune a spoof de IP (`X-Forwarded-For`)

- Removido `app.set('trust proxy', 1)` em `server.js`. Sem a diretiva, o `express-rate-limit` passa a usar `req.ip` = IP real da conexão, ignorando o `X-Forwarded-For` spoofável.
- Impede contornar os limites de login (`10 tentativas/15min`), cadastro (`5/hora`) e admin (`300/15min`) rotacionando o header em ataques de brute-force, quando a aplicação fica exposta sem um proxy reverso que controle o XFF.
- Decisão alinhada com a pendência do Ciclo 6 (`plano.md`): sem proxy controlado, `trust proxy` deve permanecer `false`. Efetiva após reinício do servidor.
- Status: **corrigido e validado** (`node --check` em `server.js`).

### Hardening: política de senha unificada

- Unificada a política forte (8+ caracteres + maiúscula + minúscula + número) em todas as vias que exigiam apenas ≥ 6 caracteres:
  - `routes/users.js` (`POST /change-password`, admin altera propria senha).
  - `routes/events.js` (senha temporária na criação de participante).
  - `routes/public.js` (cadastro público).
- As duas últimas já eram redundantes com validators (`security/validation.js:60-61`, `public.js:2225-2226`) que exigiam 8+ complexidade; a verificação manual em profundidade agora está coerente. Mensagem padronizada: "A senha deve ter ao menos 8 caracteres, com maiúscula, minúscula e número."
- O `/definir-senha` (public.js:2211), o reset forte de admin (`users.js:764`, `crypto.randomBytes`) e os validators não foram alterados — já usavam política forte.
- Status: **corrigido e validado** (`node --check` em `users.js`, `events.js`, `public.js`).

### Correção: restore de backup preserva uploads (rollback)

- Sintoma (bug severidade ALTA): em `services/backup.js`, o diretório `uploads/` era **removido antes** da cópia de volta; se o `fs.cpSync` falhasse (disco cheio, permissão, arquivo corrompido ou interrupção), os arquivos originais eram perdidos de forma irreversível — o rollback existia só para o banco.
- Correção: os uploads são **copiados para um backup temporário** (`uploads-pre-restore`, dentro do workDir) antes de qualquer alteração; em caso de falha do `cpSync`, o diretório original é **restaurado** dele e a exceção é relançada. O caminho do backup entra no cleanup do `finally`.
- Efetiva após reinício do servidor; não exige migração de banco.
- Status: **corrigido e validado** (`node --check` em `services/backup.js`).

### Correção: janelas de data no fuso America/Sao_Paulo

- Sintoma (bug severidade MÉDIA): as janelas do cronograma pública (`inscrição`, `submissão`, `revisão`, `certificados`) e os status de etapa construíam `new Date('YYYY-MM-DDT00:00:00')` no **fuso do host**. Em máquinas em UTC (Docker/CI comum) ou com DST, tudo se deslocava ~3h, fazendo janelas "encerrar" mais cedo ou "abrir" mais tarde e status incorretos. O check-in já usava UTC-3 explícito (inconsistência).
- Correção: serviço novo `services/datetime.js` centraliza `brDate()` (data em `YYYY-MM-DD` interpretada como meia-noite UTC-3) e `brToday()` (hoje 00:00 no Brasil via `Intl.DateTimeFormat`). Aplicado em `routes/public.js` (`getSubmissionWindow`, `getEventStatus`, `getRegistrationStatus`, `getAnalysisStatus`, `getRegistrationWindow`, `getCertificatesWindow`, `buildEventTimeline`) e `routes/users.js` (`getSubmissionWindow`, cópia duplicada).
- O ajuste corrige tanto a **lógica** (comparação de janelas) quanto a **exibição** (datas renderizadas), que antes também se deslocavam em host não-UTC-3. O check-in (UTC-3) permaneceu inalterado.
- Status: **corrigido e validado** (`node --check` em `public.js`, `users.js`; `npm run verify-env` passando).

### Correção: importação XLSX não corromper CPF/dados

- Sintoma (bug severidade MÉDIA): o `services/sheet-reader.js` guardava o valor bruto da célula do exceljs; números viravam `number` (CPF/CEP perdiam zero à esquerda) e datas viravam `Date`, corrompendo a busca por CPF e gerando contas duplicadas em importações em massa.
- Correção: `normalizeCellValue()` passa a usar `cell.text` (valor já formatado pelo exceljs, preservando zeros à esquerda e datas como string), com fallback para `cell.value` (datas convertidas para `YYYY-MM-DD`). Comportância de linha vazia e pulo de linhas totalmente vazias preservados.
- Status: **corrigido e validado** (`node --check` em `services/sheet-reader.js`).

### Correção: operações multi-tabela atômicas e enfileiramento de e-mail

- `routes/events.js` (criação de evento): `INSERT INTO events` + `INSERT OR IGNORE INTO event_user_roles` (papel admin do criador) agora estão dentro de um único `db.transaction`; antes, se o segundo statement falhasse, o evento existia sem o papel de admin.
- `routes/events.js` (exclusão de evento): `DELETE FROM events` agora roda **antes** de remover logo/PDF do disco, evitando arquivos órfãos se o DELETE falhar.
- `routes/events.js` (emissão em lote de certificados): os e-mails de certificado passam a ser enfileirados **fora** da transação (coletados em `pendingEmails` e enviados em loop com `try/catch`). Antes, um erro de enqueue dentro da transação poderia reverter a emissão de todos os certificados do lote.
- `routes/users.js` (criação e aprovação de usuário): o `queueAccountApproved` agora está cercado por `try/catch`; antes, uma falha de enfileiramento gerava HTTP 500 mesmo após a gravação bem-sucedida.
- Status: **corrigido e validado** (`node --check` em `events.js`, `users.js`).

### Hardening/robustez: `SESSION_SECRET` obrigatória, `VACUUM INTO` e escape em templates

- `server.js`: `SESSION_SECRET` passou a ser **obrigatória** — ausente, o servidor falha cedo (`process.exit(1)`) em vez de randomizar uma chave que invalidaria todas as sessões a cada reinício. A importação `crypto` (que só servia ao fallback) foi removida.
- `services/backup.js`: `VACUUM INTO ?` (bind) foi substituído por concatenação do caminho sanitizado (escapa asas simples), pois o SQLite não aceita params bindados neste comando; o caminho vem de `mkdtempSync` (tmpdir do sistema, não controlável).
- `views/admin/events/participants.ejs` e `views/complete-profile.ejs`: dados controláveis (nome de participante, mapas de curso) deixaram escape frágil manual/`JSON.stringify` em `confirm()` inline e `<script>`, passando a usar `jsonForScript` (via `res.locals`), prevenindo breakout de atributo/tag.
- Validação: `node --check` passando em `server.js`, `backup.js`, `events.js`, `users.js`, `public.js`, `sheet-reader.js`, `datetime.js`; templates EJS compilam via `ejs.compile`; `npm run verify-env` passando.
- Status: **concluído e validado**.

### Etapas: campo de descrição breve

- A página de etapas (`/admin/events/:id/activities/:activityId/sessions`) ganhou o campo "Descrição breve da etapa" (opcional, máximo 2000 caracteres), no mesmo padrão da descrição/ementa das atividades (palestras e minicursos).
- `services/db-reset.js`: coluna `description TEXT DEFAULT ''` adicionada ao schema de `activity_sessions` + migração idempotente (`ALTER TABLE activity_sessions ADD COLUMN description`) para bases existentes.
- `routes/events.js`: `POST .../sessions` (criação) e `POST .../sessions/:sessionId` (edição) persistem a descrição (trimada) com validação server-side de 2000 caracteres — excesso redireciona com o erro "A descrição da etapa deve ter no máximo 2000 caracteres." (com `edit_session_id` na edição para preservar o estado do formulário).
- `views/admin/events/activity-sessions.ejs`: textarea `name="description"` (`rows=3`, `maxlength=2000`) no formulário de criação/edição de etapa e nova coluna **Descrição** na tabela de etapas cadastradas (traço quando vazia; quebra de palavra para textos longos).
- Verificação: `node --check` OK; INSERT/UPDATE com a nova coluna validados no banco real (atividade 3 do evento 2, linha de teste criada e removida); template EJS compila; migração aplicada em `artigos.db`; servidor reiniciado e respondendo.
- Status: **concluído e validado** (migração idempotente; efetivo após o reinício já realizado).

### Página pública: descrição das etapas no card "Atividades do Evento"

- A linha de etapa (sub-linha da atividade) na página pública do evento (`/evento/:id`) agora exibe a descrição breve da etapa na coluna **Descrição / Ementa** — antes exibia sempre "—".
- `routes/public.js`: a query de etapas do evento passou a selecionar `description` de `activity_sessions`.
- `views/public/event.ejs`: a célula da descrição da linha de sessão exibe `session.description` (com "—" quando vazia).
- Verificação: servidor de teste na porta 3100 — as três etapas da atividade "C++" (evento 2) renderizaram as descrições cadastradas ("Essa será a aula de introdućão", "Sabe tudo de C--", "Agora o Vibe Coder vai a loucura"); servidor de teste encerrado.
- Status: **concluído e validado** (efetivo após reinício do servidor).

### Página pública: cor da linha de sessão uniformizada (diferenciar tarefa de atividade)

- A linha de sessão/etapa/tarefa passou a ter cor uniforme em todas as células (`color: #94a3b8` no seletor `.timeline-table tr.session-row td`), diferenciando visualmente da linha de atividade que mantém `color: #f8fafc` (inline `style="color:#f8fafc"` na descrição) e das demais células da tabela (`#e2e8f0`). Antes, data e descrição da sessão usavam classes diferentes (`muted` e a cor global do `td`), causando variação de tom entre as colunas da mesma linha.
- `views/public/event.ejs`: `.timeline-table tr.session-row td { color: #94a3b8 }` e célula de descrição da atividade com `style="color:#f8fafc"` (inline).
- Status: **concluído e validado**.

## 2026-08-24

### Auditoria de segurança — hardening (rodada de correção)

Auditoria pontual de segurança (análise de código + agentes especializados por área). Status das correções: **concluído** (`node --check`, compilação EJS e `npm run verify-env` passando). Detalhes no `plano.md` (Ciclo 6).

- **Bypass de CSRF (crítico)** — `security/csrf.js`: o token CSRF deixou de ser aceito a partir do cookie `csrf_token` (o navegador o envia automaticamente em navegações top-level cross-site com `sameSite: lax`); agora só `header X-CSRF-Token` ou body `_csrf`. Função `getCookieValue` e o cookie `csrf_token` removidos do fluxo de validação.
- **`crypto.timingSafeEqual` frágil** — `security/csrf.js`: protegido contra buffers de comprimentos diferentes (tokens de tamanho inválido agora geram 403 em vez de 500). A comparação normaliza o comprimento antes de chamar `timingSafeEqual`, capturando exceção como `false`.
- **Session fixation (crítico)** — `routes/auth.js`: o handler de login (`router.post('/')`) passou a chamar `req.session.regenerate()` após verificar a credencial, antes de associar o usuário à sessão. O destino pós-login (`session.afterLoginPath`, `?next=`) é preservado antes da regeneração (que zera o conteúdo da sessão) e reestabelecido dentro do callback.
- **`RequireSuperAdmin` frágil** — `security/super-admin.js`: a verificação deixou de basear-se só em `session.userEmail === 'admin@admin.com'`. A função `isRealSuperAdmin` valida no banco `is_public`, `is_admin`, `approval_status != pending`, `password_changed == 1` e `req.session.isAdmin` — cobrindo condições de fixation/steal de sessão.
- **Log de credenciais** — `services/db-reset.js`: removido o `console.log('Seed admin criado: admin@admin.com / 123456')`, que expunha a senha do super-admin em logs (stdout/daemon). A troca de senha continua obrigatória no primeiro acesso (`password_changed=0`).
- **Migração de senhas em plaintext** — `services/db-reset.js`: na migração de bases legadas, `admins`/`reviewers` agora inserem em `users.password` via `bcrypt.hashSync(password, 10)` em vez do valor cru. Migração idempotente para instalações existentes; `password_changed=0` mantém a troca obrigatória para as contas migradas.
- **Path traversal no upload de importação** — `routes/users.js`: o `filename` do `multer.diskStorage` do upload de importação (`imports/`) passa a usar `path.basename(file.originalname)`, impedindo `../`.
- **Reset de senha fraco** — `routes/users.js`: `POST /:id/reset-password` deixou de usar `bcrypt.hashSync('123456', 10)`. Agora gera `crypto.randomBytes(16)` (base64), valida o ID do usuário e renderiza uma tela com a senha temporária (escapada por `sanitizeHtml`) em vez de redirecionar com a senha em query param.
- **XSS stored por JSON cru** — `server.js` + `views/admin/events/participant-form.ejs`: adicionada a helper `jsonForScript()` (exposta como `res.locals.jsonForScript`), que codifica valores para inserção segura em `<script>` (escapa `<`, `>`, `/` e U+2028/U+2029). O `selectedUser` da prévia de conta existente deixou de usar `<%- JSON.stringify(...) %>` e passou por `jsonForScript()`.

### Reavaliação — falso-positivos descartados

- **`XSS reflexivo em certificado/consultar artigo`**: reavaliado — as views (`views/public/certificado-consulta.ejs`, `views/public/consultar.ejs`, `views/partials/country-select.ejs`, `views/emails/layout.ejs`) renderizam com `<%= %>` (autoescape do EJS 3.1.10), não havendo injeção. Nenhuma alteração necessária nesses pontos.

### Pendentes (maior escopo / exigem decisão do usuário)

- Impersonação/preview: escopar à leitura, exigir re-autenticação, não replicar `isAdmin`/`isReviewer`, expirar `previewUserId` (`server.js:144-185`, `routes/users.js:479-513`).
- ~~ZIP-bomb/descompressão no restore de backup~~ — **RESOLVIDO** nesta data (ver item "Correção: proteção contra ZIP-bomb no restore" abaixo).
- Spoof de IP no rate limiting: `keyGenerator` por identificador não spoofável ou validação do último hop confiável (`server.js:23` `trust proxy 1`, `security/rate-limits.js`).
- CSP: remover `'unsafe-inline'`/`'unsafe-eval'` via nonce; reforçar sanitização de HTML armazenado (`sanitize-html`/`DOMPurify` não instaladas) (`server.js:34-35`).
- Upload por mimetype: definir extensão pelo `file.mimetype` e não servir uploads executáveis; cobrir pontos de upload que confiam só no mimetype (`routes/events.js`).
- (Opcional) revalidação de `requireAuth`/`requireReviewer` no DB; `session.regenerate` em troca de papéis; store de sessão persistente.

### Correção: validação CSRF em uploads multipart pelo body após upload (sem cookie)

- Sintoma: todas as rotas de upload com `enctype="multipart/form-data"` (restore de backup, submissão de artigos, inscrição em eventos, importação de planilhas, fundos de certificado e logo de evento) retornavam 403 "O token de segurança não foi fornecido", ainda que o formulário contesse o campo `_csrf`.
- Causa: o middleware global `csrfProtection` (`security/csrf.js`) roda **antes** do `multer` configurado em cada rota. Em requisições multipart, o `req.body` só é preenchido quando o `multer` executa (depois dessa middleware), então o field `_csrf` vinha vazio na validação global. Formulários HTML comuns não enviam o header `X-CSRF-Token`, e o cookie `csrf_token` nunca foi lido pela validação (o token só é aceito por header ou body — ver o comentário de segurança em `security/csrf.js`), logo nunca resolveu o caso multipart. A entrada anterior do log ("bypass CSRF em uploads multipart/form-data") descrevia uma via baseada em cookie que não se aplicava ao fluxo real.
- Correção: em `POST` com `multipart/form-data`, o `csrfProtection` adia a validação (retorna `next()`); cada rota de upload passa a chamar `validateCsrfToken` (função extraída em `security/csrf.js`) **após** o `multer`, quando o body já está parseado. A validação lê o token do body `_csrf` (campo hidden injetado automaticamente pelo partial `views/partials/csrf-inject.ejs`) ou do header `X-CSRF-Token`, com comparação `timingSafeEqual` contra o token da sessão. O cookie `csrf_token` continua não sendo usado, mantendo a proteção contra bypass same-site.
- Arquivos afetados: `security/csrf.js` (adiamento da validação para multipart e função `validateCsrfToken`); `routes/auth.js` (restore), `routes/public.js` (wrappers `runUpload`/`runRegistrationUpload`), `routes/users.js` (`/import`), `routes/events.js` (`runEventAssetUpload`, `/:id/import-users`, `/:id/certificates/backgrounds`).
- Status: **corrigido e validado** (teste de integração com os módulos reais: multipart com token correto -> 200; token inválido -> 403 "não é válido"; sem token -> 403 "não foi fornecido"; POST urlencoded -> 200).

### Correção: proteção contra ZIP-bomb no restore (tamanhos lidos do `header` do adm-zip)

- Contexto: verificação da proteção contra ZIP-bomb/descompressão (item de hardening) em `services/backup.js` (`assertZipSafeForRestore`, chamado por `restoreFromZip` antes da extração).
- Achado: a função somava os tamanhos via `entry.compressedSize` e `entry.size`, mas na versão instalada do `adm-zip` essas propriedades **não existem** (vêm `undefined`); os tamanhos reais ficam em `entry.header.compressedSize` e `entry.header.size`. Consequência: `compressedBytes` e `uncompressedBytes` permaneciam **0**, então o teto de tamanho descomprimido (10 GB), o teto comprimido (550 MB) e a **razão de compressão** (100) — o coração da proteção — **nunca disparavam** (código morto). Funcionavam apenas o limite de nº de entradas (100.000), o comprimento de nome de entrada e a profundidade de diretório (usam `entryName`/`entries.length`).
- Impacto: um ZIP pequeno com payload altamente comprimível (ex.: 500 MB comprimidos expandindo para dezenas de GB) passava pela validação e era descompactado por `zip.extractAllTo`, esgotando o disco (ZIP-bomb). Mitigadores existentes não bastavam: o `multer` da rota limita o upload a 500 MB (tamanho comprimido), e a rota é restrita a `requireSuperAdmin`, mas o limite de 10 GB descomprimido era exatamente o que não funcionava.
- Correção: `services/backup.js` (`assertZipSafeForRestore`) passa a somar `(entry.header && entry.header.compressedSize)` e `(entry.header && entry.header.size)`, com fallback para `0` se o `header` estiver ausente. Demais limites e a ordem de validação (antes de `extractAllTo`) são mantidos.
- Verificação: `node --check` OK em `services/backup.js` e `routes/auth.js`. Teste funcional com o módulo real (`adm-zip`): (1) ZIP vazio rejeitado; (2) ZIP válido e pequeno (padrão de backup real) aprovado; (3) ZIP-bomb por razão (payload de 6 MB de zeros, razão >> 100) rejeitado com "razão de compressão excede o limite permitido (possível ZIP-bomb)"; (4) ZIP com 100.001 entradas rejeitado pelo teto de nº de entradas. **4/4 checks.**
- Status: **corrigido e validado** (efetiva após reinício do servidor; não exige migração de banco).

