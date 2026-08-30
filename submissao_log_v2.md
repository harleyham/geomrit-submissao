# Histórico Técnico do Projeto — Continuação (V2)

Registro cronológico das principais alterações no sistema de gestão de eventos, avaliação de artigos, participação, presença e certificados de participação.

Este arquivo é a continuação de `submissao_log.md`, que registra o histórico até **2026-08-23**. A partir de agora, as novas entradas devem ser registradas **aqui**, mantendo o mesmo formato: seções `## YYYY-MM-DD` com subtítulos `### <título da alteração>` e, ao final de cada item, a linha `Status: ...`.

Versão atual registrada: **V0.32**.

> **Sobre a V0.32**: versão em desenvolvimento desde 28/08/2026, consolidando: responsividade mobile completa (partial `mobile-fixes.ejs` em todas as views, tabelas com rolagem horizontal), seção **Transmissões** na página pública do evento, tipos de sala remodelados (Tipo 1/2/3, Auditório, Mini Auditório, Foyer, Coffee break, Restaurante, Posters) com **capacidade livre** e migração idempotente dos tipos legados, padronização de botões (classe base `.btn`), **nome da sala** no cabeçalho das folhas de presença (lista de assinaturas e folha com QR Code) e, em 30/08, melhorias na página pública: grade (dia × hora) com **intervalo início–fim nas células** e atividades multi-dia em **todos os dias do intervalo**, rótulo **sem o prefixo "Atividade:"** na Programação nas Salas/Agenda por sala e bloco **"Eventos Encerrados"** na página inicial; backup/restore com **verificação de integridade (tamanho + CRC32)** de cada arquivo do ZIP e inclusão dos **fundos de certificado e logo de `assets/`** no pacote. Planejamento aprovado do **Ciclo 5 — TRILHAS** (conceito, filtros públicos, trilhas de revisores e artigos) registrado em `plano.md`. Branch de release: `V0.32` (master acompanha a versão).

> **Sobre a V0.3**: versão de consolidação das correções e refinamentos de 24–26/08/2026 registrados neste arquivo: hardening remanescente do Ciclo 6 (ZIP-bomb no restore, CSRF em uploads multipart, rate limiting imune a spoof de IP, política de senha unificada, `SESSION_SECRET` obrigatória, rollback de uploads no restore, janelas de data no fuso America/Sao_Paulo, XLSX sem corromper dados, operações multi-tabela atômicas e escape de dados), correções críticas (login bloqueado por 403 e restore de backup), refinamentos de usabilidade (datas em `dd/mm/yyyy` via flatpickr em evento/atividades/etapas com correção da conversão dia/mês, descrição breve das etapas, cor uniforme na linha de sessão) e a documentação do plano de administração por evento (`Plano_admin.md`).

> **Sobre a V0.2**: consolidando o estado funcional entregue (eventos, inscrições, artigos, presença, certificados, e-mails, avaliações etc.) e o **hardening de segurança** realizado em 24/08/2026 (bypass de CSRF, session fixation, `RequireSuperAdmin`, senhas legadas em hash, path traversal no upload, reset de senha forte e XSS por JSON cru). As correções pendentes de hardening permanecem documentadas em `plano.md` (Ciclo 6).

## 2026-08-30

### Limpeza de dados: remoção do fundo de certificado órfão "Teste 1"

- Erro de dados no banco de desenvolvimento apontado pelo usuário: `certificate_backgrounds` tinha a linha "Teste 1" (id 4) sem arquivo físico associado (`uploads/certificate-backgrounds/1787794238228-4eee6e726900.png` inexistente — perdido em evento anterior à correção de rollback de uploads).
- Correção: conferência de todas as linhas de `certificate_backgrounds` contra o disco (demais — Fundo 1/2/3 — OK) e exclusão da linha órfã em transação, **após cópia de segurança do banco** (`artigos.db.bak-orphan-2026-08-30T19-29-11-499Z`, ignorada pelo git). As FKs `background_id` das quatro tabelas que referenciam fundos são `ON DELETE SET NULL`: a regra de certificado do evento 2 (participante) e 1 emissão histórica ficaram nulas (fallback já tratado em `getCertificateRule`).
- Pendência operacional: definir um fundo válido para "participante" nos certificados do evento 2 antes de emitir/reemitir; reenviar a imagem se o fundo "Teste 1" ainda for desejado.
- Verificação: contagens pós-limpeza — 0 regras apontando para o id 4, linha removida, emissões íntegras. Sem mudança de código; sem migração.
- Status: **concluído (dados)**.

### Backup/restore: verificação de integridade do ZIP e inclusão dos Fundos/logo de `assets/`

- Demanda do usuário: conferir o que vai para o backup — fundos de certificado e logos pareciam não ser backupados, e após restore em outra máquina uma imagem aparecia **truncada**.
- Auditoria: o ZIP (`services/backup.js`) levava apenas `artigos.db` + `uploads/` + `BACKUP_META.json`; **`assets/Fundos/` (fundos padrão, referenciados no banco como `assets/Fundos/Fundo_*.png`) e `assets/Ligem.png` (logo da plataforma) não eram empacotados** — divergem entre máquinas se substituídos manualmente. Pipeline archiver→adm-zip→`cpSync` testado com 37 arquivos/~50 MB de binários: round-trip fiel (0 truncamentos) — o mecanismo não corrompia; truncamento real vem de ZIP copiado/baixado incompleto (o restore extraía sem conferir nada) ou de arquivo perdido na origem antes do backup (confirmado no dev: linha `certificate_backgrounds` "Teste 1" órfã, arquivo físico já ausente de `uploads/certificate-backgrounds/`).
- `services/backup.js` (`createBackupZip`): passa a empacotar as imagens substituíveis de `assets/` sob o prefixo `assets-user/` no ZIP (`Fundos/*` e `Ligem.png`; CSVs de código continuam fora); `BACKUP_META.json` ganha `user_assets_file_count`.
- `services/backup.js` (`assertZipIntegrityForRestore`, nova): antes de extrair, cada entrada do ZIP é descomprimida e conferida (tamanho contra o cabeçalho central + CRC32 via `zlib.crc32` quando disponível); ZIP incompleto/corrompido é **rejeitado com erro listando os arquivos** em vez de restaurar imagem quebrada. Chamada pelo `restoreFromZip` após a validação anti-ZIP-bomb.
- `services/backup.js` (`restoreFromZip`): re-aplica `assets-user/Fundos` e `assets-user/Ligem.png` sobre `assets/` (com cópia prévia e rollback, dentro do mesmo fluxo que já rolava o banco); backups antigos sem o prefixo pulam a etapa e não alteram os assets do destino.
- Verificação: `node --check`; backup real gerado pelo módulo contém `uploads/*` + `assets-user/Ligem.png` + `assets-user/Fundos/Fundo_1..3` (`user_assets_file_count: 4`); validações passam no ZIP íntegro e um ZIP deliberadamente corrompido (400 bytes do dado comprimido do logo invertidos) é rejeitado com "falha ao descomprimir" — detecção confirmada. E2E de restore na outra máquina fica a cargo do usuário. Efetivo após reinício do servidor; sem migração de banco.
- Observações: restore rejeita ZIPs > 500 MB (limite do `multer` da rota) — backups maiores exigem reduzir uploads antes de gerar. (A linha órfã "Teste 1" encontrada na auditoria foi removida do banco na mesma data — ver entrada anterior.)
- Status: **implementado e validado tecnicamente**.

### Home: seção "Eventos Encerrados"

- Requisito: eventos com status `encerrado` não apareciam em `/` (decisão anterior os mantinha fora da home, acessíveis apenas por URL); passam a ser listados em uma seção própria **"Eventos Encerrados"**, abaixo dos eventos publicados.
- `routes/public.js` (`GET /`): nova consulta `closedEvents` (`status = 'encerrado'`, ordem `date_start DESC`), com os mesmos wraps `withSubmissionMeta`/`withAreaMeta` da lista de publicados.
- `views/public/home.ejs`: o card do evento foi extraído para o partial `views/public/home-event-card.ejs` (reutilizado pelas duas seções); a seção encerrada exibe o badge âmbar **"Encerrado"** no lugar do badge de submissão (status encerrado já bloqueia inscrição/submissão na página do evento); a seção só aparece quando há eventos encerrados; o estado vazio da lista publicada permanece inalterado.
- Verificação: `node --check` em `routes/public.js`; render com dados mock — título "Eventos Encerrados" presente, badge "Encerrado" no card encerrado, card publicado mantém o badge de submissão. Efetivo após reinício do servidor; sem migração de banco.
- Status: **implementado e validado tecnicamente**.

### Programação nas Salas: atividade sem etapas exibida sem o prefixo "Atividade:"

- Sintoma: no bloco **Programação nas Salas** da página pública (e na **Agenda por sala** administrativa), uma alocação de atividade sem etapas aparecia como `Atividade: <nome>`, enquanto uma etapa aparecia como `<Atividade>: <Etapa>` — o prefixo na atividade sozinha era redundante.
- `services/rooms.js` (`assignmentLabel`): alocação de atividade sem etapas passa a exibir **somente o nome da atividade**; permanecem `Atividade: Etapa` para etapas, `Etapa: <nome>` quando a etapa não traz a atividade e `Reserva do evento` para reservas do evento. O helper é compartilhado por `/evento/:id` (Por dia/Por sala) e `/admin/events/:id/rooms/agenda` — as duas telas acompanham.
- Verificação: `node --check` + chamada direta do helper (atividade → `Cofee Break`; etapa → `C++: Aula 1`; reserva → `Reserva do evento`; etapa sem atividade → `Etapa: Aula 1`). Efetivo após reinício do servidor; sem migração de banco.
- Status: **implementado e validado tecnicamente**.

### Grade (dia × hora): atividade de vários dias aparece em todos os dias

- Sintoma: atividade cadastrada com intervalo de vários dias (ex.: "Almoço", 14/09 a 18/09/2026) aparecia na grade **apenas no dia de início**.
- `views/public/event.ejs`: na construção do `actOcc` da grade, atividade **sem etapas** passou a ser expandida dia a dia entre `date_start` e `date_end` (iteração em UTC com teto de 92 dias, sem efeito de fuso/DST); cada dia recebe a própria célula no horário de início. As colunas de dias da grade acompanham automaticamente (derivação por `Set`). Etapas permanecem no dia próprio (`session_date` é um único dia); a reserva de sala de atividade multi-dia continua valendo no dia de início (regra da Seção 9 do manual, sem mudança).
- Verificação: compilação EJS e render mock com dados reais do evento 2 ("Almoço" 14–18/09 12:00–14:00) — 5 colunas de dias na grade e "Almoço" nas células dos 5 dias; etapas de "C++" seguem nos dias corretos. Efetivo após reinício do servidor; sem migração de banco.
- Status: **implementado e validado tecnicamente**.

### Grade (dia × hora): hora de início e fim nas células

- A visão **Grade (dia × hora)** da seção "Atividades do Evento" (`/evento/:id`) exibia apenas o nome da atividade/etapa na célula; passa a exibir também o intervalo **início–fim** (`HH:MM–HH:MM`) antes do nome, no mesmo padrão das demais visualizações (o fim ausente aparece como `?`).
- `views/public/event.ejs`: `actOcc` passou a carregar o campo `time` (derivado de `time_start`/`time_end` da etapa ou da atividade sem etapas); `gridCell` acumula os objetos (em vez de só o nome) e a célula renderiza o intervalo em destaque seguido do nome.
- Verificação: compilação EJS e render com dados mock (atividade sem etapas, etapas com e sem hora de fim) — intervalos corretos nas células. Efetivo após reinício do servidor; sem migração de banco.
- Status: **implementado e validado tecnicamente**.

## 2026-08-28

### Nome da sala nas folhas de presença (lista e QR Code)

- As duas folhas impressas de presença passam a exibir a **sala** no cabeçalho, abaixo da data: a **lista de presença** (`GET /admin/events/:id/activities/:activityId/attendance-print`, linha `Sala: <nome>` entre a data e a tabela Nome/E-mail/Assinatura) e a **folha com QR Code** (`GET .../checkin-print`, linha `Sala: <nome>` após `Data:`/`Etapa:`, antes do QR).
- Resolução centralizada no helper `resolvePrintRoomName` (`routes/events.js`): alocação direta da etapa (`targetAssignment` por `session_id`) ou da atividade sem etapas (`activity_id`); sem alocação direta, usa a **reserva do evento** (`eventReservation` + nome via `getRoom`); sem nenhuma, imprime `Sala: A definir` (mesmo padrão da data quando indefinida).
- Verificação: `node --check`; função validada no dev contra dados reais (etapa alocada → nome da sala; sem alocação → "A definir"; com reserva do evento → nome da sala reservada, inserida e removida em teste); servidor sobe limpo e as rotas seguem protegidas (302 sem login). Efetivo após reinício do servidor.
- Status: **concluído (código + verificação técnica)**.

### Salas: novos tipos com capacidade livre

- Os tipos de sala deixam de ser "tamanho com capacidade fixa" (Pequena 10 / Média 50 / Grande 100 / Auditório livre) e passam a ser **tipo com capacidade livre** (informada pelo admin): **Tipo 1, Tipo 2, Tipo 3, Auditório, Mini Auditório, Foyer, Coffee break, Restaurante e Posters**.
- `services/rooms.js`: `ROOM_SIZES` redefinido com as 9 chaves (`type1`…`type3`, `auditorium`, `mini_auditorium`, `foyer`, `coffee_break`, `restaurant`, `posters`), sem capacidade fixa; `resolveRoomCapacity` passa a aceitar a capacidade informada para **qualquer** tipo (inteiro > 0 ou nulo).
- `routes/events.js`: `parseRoomForm` valida a capacidade para todos os tipos (opcional; se preenchida, inteiro > 0), mensagem "Selecione um tipo de sala válido."; as renderizações de atividades passaram a expor `roomLabel` à view.
- Views: `admin/events/rooms.ejs` — campo de capacidade sempre visível (antes só aparecia para `auditorium`), cabeçalho "Tamanho"→"Tipo" e redação "classificando por tipo e informando a capacidade"; `admin/events/activities.ejs` — o `<select>` de sala usava um ternário hardcoded com os rótulos antigos, trocado por `roomLabel(room.size)` (+ capacidade). Páginas que já usavam `roomLabel` (agenda, ocupação, programação pública) acompanham automaticamente.
- Migração idempotente em `services/db-reset.js` (`initializeDbSchema`): `small→type1` (cap. 10), `medium→type2` (cap. 50), `large→type3` (cap. 100); `auditorium` permanece; capacidade existente preservada como valor livre inicial. Coluna `size` e demais dados não mudam; default da tabela passou a `type1`.
- Verificação: `node --check` em `rooms.js`/`db-reset.js`/`events.js`; migração aplicada no dev (`Sala 01→type1(10)`, `Sala 02→type2(50)`, `Auditório→auditorium`); `rooms.ejs` renderiza com os 9 tipos no seletor, capacidade visível e coluna "Tipo"; servidor sobe limpo e `/`, `/evento/1`, `/revisores` respondem 200. Efetivo após reinício do servidor.

### Botões "Ocupação por dia" e "Agenda por sala" fora do padrão

- Sintoma: em `/admin/events/:id/rooms`, os botões "Ocupação por dia" e "Agenda por sala" apareciam como texto solto com leve fundo, sem a forma de botão (sem `padding`/`border-radius`/`inline-flex`).
- Causa: o padrão do app é `class="btn btn-secondary"` — a classe base `.btn` fornece formato (padding, raio, `inline-flex`, tamanho) e a `.btn-secondary` só fornece a cor. Os dois `<a>` tinham apenas `btn-secondary`, então herdavam só a cor.
- Correção: padronizados os links "Ocupação por dia"/"Agenda por sala" e "Cancelar" em `admin/events/rooms.ejs`, "Cancelar" em `admin/events/activity-sessions.ejs` e "Voltar ao Início" em `public/reviewers.ejs` para `class="btn btn-secondary"`. Nas páginas de importação que não têm a classe base `.btn`, a cor `.btn-secondary` recebeu `padding`/`border-radius`/`font-size` próprios (`admin/events/import-users.ejs`, `admin/users/import-users.ejs`), alinhando ao mesmo formato.
- Verificação: todas as views afetadas compilam; `/revisores` responde 200 já com o botão no padrão. Painéis administrativos validados por compilação. Efetivo após reinício do servidor; sem migração de banco.

### Página pública do evento: nova seção "Transmissões"

- `/evento/:id` ganhou a seção **Transmissões** (após "Programação nas Salas"), listando apenas atividades/etapas com transmissão: botão **Assistir transmissão** quando há link (o da etapa quando preenchido, senão herdado da atividade) e o aviso "Transmissão prevista — link a ser divulgado" quando a flag está marcada sem link — mesma regra de herança já usada na visão Lista.
- Linhas com data (formato `dd/mm/aaaa`), horário início–término, nome "Atividade : Etapa" (ou só a atividade, quando sem etapas), sala e vídeo; ordenação por data e horário. Seção oculta quando não há transmissões.
- Implementação somente no template `views/public/event.ejs` (dados `activities`/`sessions` já chegavam à view); reutiliza `.timeline-table-wrap` (rolagem horizontal no celular).
- Verificação: servidor sobe e `/evento/1` e `/evento/2` respondem 200 com a seção presente (evento 2: "C++ : Aula 1" e "Python" com botão, "C++ : Aula 2" como prevista; evento 1 com os vídeos próprios). Efetivo após reinício do servidor; sem migração de banco.

### Responsividade mobile: cards/tabelas com rolagem horizontal e grids adaptativos

- Sintoma: em celulares, diversos cards não se adaptavam à rolagem horizontal — tabelas largas cortavam o conteúdo (botões de ação inacessíveis), a página inteira arrastava para o lado e formulários mantinham colunas lado a lado.
- Auditoria completa das 54 views (sem CSS global; cada página repete um `<style>` próprio): ~30 tabelas sem contêiner de rolagem; 2 contêineres com `overflow:hidden` (cortavam); 11 páginas sem `box-sizing:border-box` (inputs `width:100%` + padding estouravam a viewport); grades fixas `1fr 1fr`/`repeat(3,1fr)` sem breakpoint; `minmax(N px)` > largura útil de telas ≤375px; `textarea{min-width:320px}`; topbars sem `flex-wrap`.
- Novo partial `views/partials/mobile-fixes.ejs` (injetado antes do `</head>` de **todas** as 50 páginas, via `scripts/fix-mobile.js`): `box-sizing:border-box` universal; utilitário `.table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}` (visível no print); topbar com `height:auto` + `flex-wrap` ≤860px; colapso de `.form-row`/`.detail-grid`/`.decision-grid`/`#formacao-titulacao-status` para 1 coluna ≤720px (com `!important` para vencer style inline).
- Envolvidas com `<div class="table-scroll">` as tabelas sem contêiner (13 arquivos, 27 tabelas): `admin/dashboard` (a classe existia no CSS mas nunca era usada no markup), `admin/users/list` (2), `admin/users/import-users-result`, `admin/articles/list`, `admin/events/roles`, `admin/events/activity-sessions`, `admin/events/rooms` (3), `admin/events/rooms-agenda`, `admin/events/rooms-occupancy`, `admin/events/import-users-result`, `admin/reports/list` (6), `public/author-dashboard` (3), `reviewer/dashboard` (2). Já rolavam via `.section`/`.section-body`/`.grid-wrap`: `events/list`, `participants`, `activity-attendance`, grade do `event.ejs`.
- `public/event.ejs` (`.timeline-table-wrap`) e `public/activity-sessions.ejs` (`.table-wrap`): `overflow:hidden` → `overflow-x:auto` com `-webkit-overflow-scrolling:touch` (as 5+1 tabelas do cronograma/etapas cortavam no celular).
- `admin/events/certificates.ejs`: stats inline `repeat(3,1fr)` → `repeat(auto-fit,minmax(min(100%,180px),1fr))` (style inline não era afetado pela media query existente).
- `minmax(≥200px,1fr)` → `minmax(min(100%,Npx),1fr)` em 10 ocorrências (home, evento, atividades, certificados, participantes-form, relatórios, inscrição, revisores, dashboard do revisor/admin); `textarea{min-width:320px}` → `min(320px,100%)` em `rooms`, `rooms-agenda`, `rooms-occupancy` e `activity-sessions`.
- Verificação: compilação EJS das 68 views (0 erros); resolução do include do partial testada em todas as profundidades; servidor sobe e `/`, `/login`, `/evento/1` (timeline+grade), `/evento/1/atividades/1/etapas`, `/revisores`, `/consultar`, `/cadastro` respondem 200 com o novo CSS presente; wrappers `<div class="table-scroll">` pareados 1:1 com as tabelas nos 13 arquivos. Painéis administrativos verificados por compilação (acesso E2E não executado por não dispor da senha do admin). Efetivo após reinício do servidor; sem migração de banco.

## 2026-08-27

### Dashboard: fila de e-mails pendentes com atualização automática

- Relato do usuário: no `/admin/dashboard`, os e-mails enviados continuavam aparecendo na lista "Ver mensagens pendentes" como se estivessem na fila — a lista só corrigia ao sair da página e voltar (render nova). Causa: o bloco era renderizado apenas uma vez no HTML; o worker de envio roda em background (tick de 15 s em `services/email.js`) e não havia nada que atualizasse a seção.
- `views/partials/email-queue.ejs` (novo): bloco da fila extraído do dashboard (form "Limpar fila" + `<details>` com a tabela), reutilizável em render inicial e em atualizações parciais. O `confirm()` do botão Limpar saiu do `onsubmit` inline (incompatível com fragmentos substituídos sob CSP nonce) e passou a um listener `submit` delegado registrado no script da página.
- `routes/auth.js`: nova rota `GET /email/pending-list` (`requireAuth` + `requireSuperAdmin`) que renderiza o partial e devolve JSON `{ count, html }`.
- `views/admin/dashboard.ejs`: bloco envolto em `#email-queue-live` (oculto quando a fila está vazia), contador do master switch marcado com `#email-pending-count`, e script com nonce que a cada 15 s (e ao voltar de aba oculta) busca o fragmento e substitui a seção apenas quando o HTML mudou, preservando o estado aberto do `<details>`; o texto do contador é atualizado junto.
- Validação: `node --check` em `routes/auth.js`; compilação e render completo do dashboard com dados fictícios (linha da fila, span do contador, script com nonce, sem `onsubmit` inline no form da fila); partial vazio renderiza "Fila de e-mails vazia."; rota registrada (302 para `/login` sem sessão). Servidor de desenvolvimento reiniciado. Verificação funcional na fila real fica a cargo do usuário em homologação.
- Status: **implementado e validado tecnicamente** (efetivo após reinício do servidor; não exige migração de banco).

### CSP com nonce: removido `'unsafe-inline'` de `scriptSrc`/`scriptSrcAttr`

- Pendência em `plano.md` (Ciclo 6, hardening remanescente): remover `'unsafe-inline'` de `scriptSrc`/`scriptSrcAttr` via nonce. O helmet 8 já estava com `'unsafe-inline'` nesses dois diretivos (na época, necessitado pelos blocos `<script>` inline e handlers `onclick`/`onsubmit`/`onchange`), e nenhum `<script>` externo usava CDN (tudo em `/lib/`, coberto por `'self'`).
- `server.js`: adicionado middleware gerador de nonce **antes** do helmet — `res.locals.cspNonce = crypto.randomBytes(16).toString('base64')`. Os diretivos passaram a `scriptSrc: ["'self'", (req,res) => `'nonce-${res.locals.cspNonce}'`]` e `scriptSrcAttr: [(req,res) => `'nonce-${res.locals.cspNonce}'`]`. `'unsafe-inline'` removido de ambos; `'unsafe-eval'` nunca esteve presente.
- Views: todos os `<script>` (inline e os `src="/lib/..."`) e todos os handlers inline (`onclick`/`onsubmit`/`onchange` — 27 elementos) ganharam o atributo `nonce="<%= cspNonce %>"`. O nonce é inserido **antes** do atributo `on*=` nas linhas com `confirm()` acentuada, para não tocar nas strings.
- **Ajustes descobertos nesta build (helmet 8.3.0)**: a forma de objeto `{nonce:true}` não é suportada e gera `[object Object]` no header; escrever a função como *string* (`["(req,res) => ..."]`) é rejeitada porque a vírgula dos parâmetros ativa a validação de diretiva. Solução: usar a função real, sem aspas em volta.
- Verificação: `node --check` em todos os `.js`; `git diff --check` OK; cabeçalho das páginas confirmando `script-src 'self' 'nonce-...'` e `script-src-attr 'nonce-...'` (por-request, coincidentes), **0** `<script>` sem nonce e o `<select onchange="filterReviewers()" nonce="...">` de `/revisores` carregando o nonce correspondente. `'unsafe-inline'` mantido apenas em `style-src` (blocos `<style>` inline e Google Fonts).
- **Pendente relacionado**: reforçar sanitização de HTML armazenado (`sanitize-html`/`DOMPurify` — não instaladas). É endurecimento XSS separado do header CSP e exige nova dependência; não implementado nesta etapa.
- Status: **implementado e validado** (efetivo após recarga do servidor — mudança de servidor).

## 2026-08-26

### Confirmação de exclusão de usuário: modal customizado no lugar do `confirm()` nativo

- Relato do usuário (26/08): ao pressionar **Excluir** em `/admin/users`, o navegador exibia o popup nativo `confirm()` com o título "127.0.0.1:3000 diz" (prefixo do host adicionado pelo navegador) — o título não pode ser trocado em diálogos nativos.
- `views/admin/users/list.ejs`: substituído o `confirm()` dos dois botões "Excluir" (usuários aprovados e cadastros pendentes) por um **modal customizado**, no mesmo padrão já usado em `views/admin/articles/list.ejs` e `views/public/author-dashboard.ejs`.
  - Novos estilos `.modal-backdrop`/`.modal-card`/`.modal-actions` (com `white-space: pre-line` na mensagem para quebrar as linhas).
  - Modal único `#delete-user-modal` com título e mensagem dinâmicos ("Excluir usuário" / "Excluir solicitação de cadastro") e botões **Cancelar** e **Excluir**.
  - Os formulários ganharam `class="js-delete-user"` / `class="js-delete-user-pending"` + `data-email`; o `onsubmit` com `confirm()` nativo foi removido. Um script captura o `submit`, `preventDefault()`, preenche o modal e, ao confirmar, chama `pendingForm.submit()` (que preserva o `_method=DELETE` e o `_csrf`). Clicar fora ou em Cancelar fecha sem enviar.
- Validação: `ejs.compile` de `list.ejs` OK, `git diff --check` OK e render com dados fictícios confirma modal presente e ausência de `onsubmit`/`confirm()` nativo restante. Efetiva após recarregar `/admin/users` (mudança apenas de template).
- Status: **implementado e validado** (efetivo após recarga da página).

### Correção: exclusão de usuário retornava 403 "O token de segurança não foi fornecido" (aspas mal fechadas no `onsubmit`)

- Relato do usuário (26/08): ao clicar em **Excluir** em `/admin/users`, o sistema respondia com a página de erro `Solicitação inválida — O token de segurança não foi fornecido. Recarregue a página e tente novamente.` (403 do `security/csrf.js`).
- Causa raiz: em `views/admin/users/list.ejs` (botão "Excluir" dos usuários aprovados), o atributo `onsubmit` do formulário estava sem a **aspas dupla de fechamento** — `onsubmit="return confirm('...')>` em vez de `...')">`. Com o HTML malformado, o navegador tratava os campos ocultos seguintes (`_csrf` e `_method=DELETE`) como parte do atributo, e o POST era enviado **sem o token CSRF** — daí a mensagem "não foi fornecido" (o servidor não recebe o `_csrf` no body). A validação de CSRF e o `method-override` estavam íntegros.
- Por que os testes manuais por HTTP não reproduziam: scripts `curl`/`fetch` enviam o corpo diretamente, ignorando o parse do HTML; o defeito só se manifesta quando um **navegador real** faz o parse do formulário malformado.
- Correção: fechada a aspas do atributo (`')">`). Uma linha, somente no template.
- Verificação: `git diff --check` OK, `ejs.compile` de `list.ejs` OK. Efetiva após recarregar `/admin/users` (mudança apenas de template, sem reinício).
- Status: **corrigido e validado** (efetivo após recarga da página).

### Correção crítica: login bloqueado por 403 (cookie de sessão suprimido sem `trust proxy`)

- Sintoma: nenhum usuário conseguia autenticar. O GET `/login` renderizava o formulário com token CSRF, mas **não enviava nenhum `Set-Cookie`**; o POST seguinte chegava sem cookie de sessão, o servidor criava uma sessão vazia nova com outro token e toda tentativa retornava **403 "O token de segurança não é válido"** — inclusive com credenciais corretas.
- Causa raiz: regressão do hardening de 25/08. Com `NODE_ENV=production`, o cookie de sessão usa `secure: true`; o `express-session` só emite cookies Secure quando considera a requisição segura (`issecure()`: socket TLS **ou** proxy confiável indicando HTTPS). A remoção de `app.set('trust proxy', 1)` fez `req.secure` virar sempre `false` atrás do nginx (terminação TLS), e o middleware passou a **suprimir por completo** o `Set-Cookie` — sem cookie não há sessão nem CSRF que bata. Reproduzido por curl (A/B contra a instância anterior na porta 3000, que ainda tinha `trust proxy`).
- Correção:
  - `server.js`: restaurado `app.set('trust proxy', 1)` (confia apenas no último hop/nginx), necessário para `req.secure` e para os cookies `connect.sid; Secure`.
  - `security/rate-limits.js`: todos os limitadores receberam `keyGenerator` próprio baseado no IP do socket (`req.socket.remoteAddress`), **não** em `req.ip`. Assim a limitação de taxa continua imune a spoof de `X-Forwarded-For` (objetivo do ajuste de 25/08), mesmo com `trust proxy` ativo; com `keyGenerator` customizado, o express-rate-limit também deixa de aplicar a validação `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
  - `routes/auth.js` (POST `/login`): após `session.regenerate()`, a sessão nova nasce sem `csrfToken` e a página re-renderizada num erro de credenciais exibia o token antigo → a segunda tentativa caía em 403. Agora um token novo é gerado na sessão regenerada e replicado em `res.locals.csrfToken` antes do re-render.
- Validação E2E em sandbox isolado (cópia do projeto + cópia do banco, porta 3105, simulando nginx com `X-Forwarded-Proto: https`): **8/8 checks + teste de limite** — Set-Cookie `connect.sid` presente e com flag Secure; senha errada → 200 "Credenciais inválidas" (antes 403); segunda tentativa com o token re-renderizado → 200; login correto → 302 `/admin/dashboard`; dashboard autenticado → 200; 12 POSTs com XFF rotacionado → bloqueio 429 pelo teto de login (chave por socket). Acesso direto por HTTP puro com `NODE_ENV=production` continua sem cookie por design (cookies Secure exigem HTTPS — acessar via domínio HTTPS ou rodar sem `NODE_ENV=production` localmente).
- Efetiva após reinício do servidor. Não exige migração de banco.
- Status: **corrigido e validado**.

### Correção: restore de backup não quebrava por escopo de `uploadsBackupPath` no `finally`

- Sintoma (bug severidade ALTA): ao restaurar um backup em produção, o servidor logava `ReferenceError: uploadsBackupPath is not defined` em `services/backup.js:301` e relançava a exceção, impedindo a restauração mesmo quando o banco e os uploads haviam sido copiados com sucesso. O erro ocorria sempre, inclusive com backups válidos.
- Causa raiz: a variável `uploadsBackupPath` (usada para o backup/rollback dos uploads) era declarada com `let` **dentro** do bloco `try` de `restoreFromZip` (linha `let uploadsBackupPath = null;`, dentro do `try`). O bloco `finally` — responsável pela limpeza dos arquivos temporários — acessa `uploadsBackupPath` nessa linha fora do escopo do `try`. Como `let` é delimitado pelo bloco, a variável não existia no `finally` → `ReferenceError` antes da própria execução do cleanup do `workDir`. As variáveis irmãs de rollback (`preRestoreMain`, `preRestoreWal`) eram declaradas **fora** do `try` e funcionavam normalmente; a inconsistência de posicionamento entre as declarações era a causa.
- Correção: `services/backup.js` passou a declarar `uploadsBackupPath` junto das demais variáveis de controle do restore (`preRestoreMain`, `preRestoreWal`, `newDb`, `swapped`), **antes** do `try`, mantendo-a acessível tanto ao `try` (que atribui o caminho do backup) quanto ao `finally` (que a usa no cleanup). Removida a declaração duplicada que estava dentro do `try`. A lógica de backup/restauração de uploads e o rollback permanecem inalterados.
- Efetiva após reinício do servidor; não exige migração de banco.
- Status: **corrigido e validado** (`node --check` em `services/backup.js`).

### Opção de excluir atividade administrativa

- Requisito do usuário: em `/admin/events/:id/activities`, a listagem de atividades exibia "Editar", "Etapas", "Marcar Presença", "Vídeo/Transmissão", "Imp. Lista" e "QR Presença", mas **não** havia como excluir a atividade.
- `routes/events.js`: nova rota `POST /:id/activities/:activityId/delete` (`strictLimiter`) que remove o registro de `event_activities`. Como todas as FKs ligadas à atividade são `ON DELETE CASCADE` (`activity_sessions`, `participant_activity_enrollments`, `activity_attendance_records`, `activity_evaluations`) e `foreign_keys=ON` no `db.js`, etapas, inscrições, presenças e avaliações são removidas em cascata sem código extra.
- **Proteção**: a exclusão é bloqueada (302 com erro) quando a atividade já possui registro de presença (`activity_attendance_records`), preservando o histórico de presença — consistente com a regra do manual de que presença registrada não deve ser perdida.
- `views/admin/events/activities.ejs`: botão "Excluir" ao lado de "Editar", com diálogo de confirmação (`confirm`) listando o que será removido. O `_csrf` é injetado automaticamente pelo partial `csrf-inject`.
- `certificate_emissions` **não** tem FK com `activity_id`, então certificados já emitidos não são afetados pela exclusão.
- Validação: `node --check` em `routes/events.js`, compilação EJS do template e `npm run verify-env` passando. Efetiva após reinício do servidor.
- Status: **implementado e validado**.

### Página Pública do abre na mesma aba (removido `target="_blank"`)

- Requisito do usuário: em `/admin/events`, o botão "Página Pública" abria outra aba no navegador (`target="_blank"`), exigindo voltar atrás para continuar administrando.
- `views/admin/events/list.ejs`: removido `target="_blank"` do link "Página pública" (mantido `rel="noopener noreferrer"`, mesmo sem efeito sem `target=_blank`). Agora a página pública abre na misma aba.
- Deixei o botão "Conteúdo PDF" ao lado ainda abrindo em nova aba; se uniformizar os dois, é uma linha parecida.
- Validação: compilação EJS do template passando. Efetiva após reinício do servidor.

### Datas do formulário de evento em formato dd/mm/yyyy (flatpickr)

- Requisito do usuário: em `/admin/events/:id/edit`, as datas apareciam em `mm/dd/yyyy` porque os `<input type="date">` nativos seguem o **locale do navegador** (en-US), e não há forma de forçar `dd/mm/yyyy` só com HTML/CSS.
- Solução: datepicker local **flatpickr** (sem CDN, mesmo padrão do `jsQR` em `public/lib/`), com locale pt-BR e técnica `altInput`: o usuário vê `dd/mm/yyyy`, mas o valor enviado continua em `yyyy-mm-dd` — **sem mudança no backend** (validações de data existentes permanecem válidas).
- Novos: `public/lib/flatpickr/flatpickr.min.js`, `flatpickr.min.css`, `init.js` (inicializa todos os `input[type="date"]` da página com `altInput`, `altFormat: 'dd/mm/yyyy'`, `dateFormat: 'yyyy-mm-dd'`, `locale: 'pt'`, `disableMobile: true`) e `l10n/pt.js` (o locale `pt` vem em arquivo separado e precisa ser carregado antes do `init.js`).
- `views/admin/events/form.ejs`: incluí o `<link>` do CSS no `<head>`, as tags `<script>` do `flatpickr.min.js`, `l10n/pt.js` e `init.js` antes do fechamento do body, e `npm install flatpickr` (adicionado ao `package.json`).
- CSP (`server.js`): sem alteração necessária — `scriptSrc`/`styleSrc` permitem `'self'` e `styleSrc` já permite `'unsafe-inline'` (o flatpickr injeta estilos inline no calendário), e o `<script src>` é de mesma origem.
  - Validação: carreguei os tres arquivos num jsdom (instalado só pra teste, removido depois) e confirmei: `flatpickr.l10ns.pt` registrado, instância criada, `dateFormat: 'yyyy-mm-dd'` e `altFormat: 'dd/mm/yyyy'`, locale `pt`. (Os valores de data exibidos pelo jsdom vinham corrompidos — artefato do jsdom, que não replica 100% o parse de Date/DOM do navegador real; a configuração é uso padrão do flatpickr.) `npm run verify-env` passando. Efetiva após reinício do servidor.

### Correção crítica: conversão de data no submit invertia dia/mês (`init.js`) — datas gravadas como `yyyy-dd-mm`

- Sintoma (bug severidade ALTA): ao salvar o formulário de evento com uma data cujo **dia > 12**, o campo era gravado com dia e mês trocados (ex.: `20/12/2026` virava `2026-20-12` no banco). Com dia ≤ 12 a corrupção era **silenciosa** (ex.: `05/08/2026` virava `2026-05-08` — 8 de maio em vez de 5 de agosto). Ao reabrir o formulário, a data exibia o valor cru (`2027-15-02`), pois `formatBRDate` não consegue parsear mês > 12 e devolve a string original — o "formato estranho" relatado em `/admin/events/1/edit`.
- Causa raiz: em `public/lib/flatpickr/init.js` (`prepareDateInputsOnSubmit`), o regex captura `m[1]=dia`, `m[2]=mês`, `m[3]=ano`, mas a linha montava `m[3] + '-' + m[1] + '-' + m[2]` → `yyyy-dd-mm` em vez de `yyyy-mm-dd`.
- Correção: a linha passou a montar `m[3] + '-' + m[2] + '-' + m[1]` (`yyyy-mm-dd`). Vale para todos os formulários com `input.datepicker` (evento, atividades e etapas).
- Dados corrompidos: apenas o evento 1 (salvo hoje, 2026-08-26, após a introdução do bug) tinha datas detectavelmente corrompidas — `date_start='2027-15-02'` e `date_end='2027-17-02'` — restauradas para `2027-02-15`/`2027-02-17` (dia/mês trocados, recuperáveis). Evento 2 e atividades/etapas foram salvos em 20/08, antes do bug, e estão íntegros. Backup consistente do banco antes da correção: `/tmp/opencode/artigos_backup_antes_fix.db`.
- Validação: reprodução E2E em Chrome real (CDP) contra a porta 3000 — `setDate('20/12/2026')` exibe `20/12/2026` e o submit converte para `2026-12-20`. `node --check` em `init.js` passando.
- Status: **corrigido e validado** (efetivo após reinício do servidor; não exige migração de banco).

### Correção: datas das páginas de atividades e etapas em dd/mm/yyyy (flatpickr)

- Sintoma: em `/admin/events/:id/activities` e `/admin/events/:id/activities/:activityId/sessions`, os campos de data (`date_start`, `date_end`, `session_date`) ainda usavam `<input type="date">` nativo, que segue o locale do navegador — em en-US exibem `mm/dd/yyyy` e, sem data, mostram o placeholder literal "mm/dd/aaaa". A conversão para flatpickr (entrada anterior) só havia sido aplicada ao formulário do evento (`form.ejs`).
- Solução: mesmo padrão do `form.ejs` — `type="text"` com `class="datepicker"`, valor renderizado por `formatBRDate(...)` (vazio quando sem data), e inclusão do CSS/JS do flatpickr (já em `public/lib/flatpickr/`) no `<head>` e antes do `</body>` de:
  - `views/admin/events/activities.ejs` (`date_start`, `date_end`).
  - `views/admin/events/activity-sessions.ejs` (`session_date`).
- Sem mudança no backend: os POSTs continuam recebendo `yyyy-mm-dd` (o `init.js` converte no submit) e re-renderizam via GET com dados do banco. `formatBRDate` retorna `null` para datas vazias, que o EJS renderiza como string vazia.
- Validação: E2E em Chrome real contra a porta 3000 — `date_start=14/09/2026`, `date_end=15/09/2026`, `session_date=14/09/2026` em dd/mm/yyyy; 0 `input[type=date]` nas páginas. Templates EJS compilam; `node --check` em `init.js` passando.
- Status: **corrigido e validado** (efetivo após reinício do servidor).

### Refinamento: placeholder "dd/mm/aaaa" nos campos de data vazios

- Após a conversão das páginas para flatpickr, os campos de data vazios perderam a dica visual do formato (o `<input type="date">` nativo mostrava o placeholder "mm/dd/aaaa" conforme o locale do navegador).
- `public/lib/flatpickr/init.js`: ao inicializar cada `input.datepicker`, se o campo não tiver `placeholder` definido, ele recebe `placeholder="dd/mm/aaaa"` — dica aplicada de forma centralizada a todos os formulários com datas (evento, atividades e etapas), atuais e futuros.
- Validação: E2E em Chrome real contra a porta 3000 — campos vazios com placeholder "dd/mm/aaaa" no formulário do evento, em atividades e em etapas; campos com valor seguem exibindo a data em dd/mm/yyyy. `node --check` em `init.js` passando.
- Status: **implementado e validado** (efetivo após reinício do servidor).

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

### Fundo de certificado por evento (visibilidade e uso restritos ao evento de origem)

- Contexto: pedido — "O fundo para certificado enviado de um evento deve ser visto e possível de ser usado apenas para esse evento". A tabela `certificate_backgrounds` era uma biblioteca global: qualquer evento listava, visualizava e referenciava o upload de qualquer outro evento.
- Schema (`services/db-reset.js`): nova coluna `certificate_backgrounds.event_id` (FK para `events` com `ON DELETE CASCADE`) no DDL + `ALTER TABLE` idempotente (padrão `PRAGMA table_info`) + índice `idx_certificate_backgrounds_event`. Migração idempotente atribui uploads legados (sem dono) ao(s) evento(s) que os referenciam em `event_certificate_rules`: o menor `event_id` mantém a linha original e cada outro evento recebe uma cópia da linha (mesmo arquivo em disco, sem exclusões), com as regras re-apontadas (`event_certificate_rules` e a legada `certificate_rules`). Uploads sem referência ficam sem dono e invisíveis. Rodas padrão (`assets/Fundos/…`) permanecem com `event_id` nulo = compartilhadas.
- Rotas (`routes/events.js`): helpers `getEventBackground(eventId,id)` e `listEventBackgrounds(eventId)` (`file_path LIKE 'assets/Fundos/%' OR event_id = ?`); aplicado na listagem da página de certificados, na visualização do arquivo (agora 404 entre eventos), na prévia (400), no salvar regra e no "salvar configuração geral" (erro "Selecione um fundo de certificado válido para este evento."). O upload passa a gravar `event_id` do evento (com validação de existência do evento antes de gravar/aceitar o arquivo).
- UI (`views/admin/events/certificates.ejs`): grupo "Fundos enviados" renomeado para "Fundos deste evento" e nota na biblioteca ("Os fundos enviados são visíveis e utilizáveis apenas neste evento"). Mensagem de upload: "Fundo enviado e disponível apenas para este evento."
- Verificação: `node --check` OK; teste sintético de migração (upload compartilhado por 2 eventos → cópia + re-apontamento, legado órfão preservado sem dono, idempotência em 2ª execução; consultas de escopo corretas). Smoke HTTP completo (usuário administrador temporário, removido ao final): evento dono vê/usua o upload; outro evento não lista, recebe 404 na visualização, 400 na prévia e tem a regra recusada sem gravar; fundos padrão visíveis para todos; limpeza total dos dados sintéticos conferida. Banco de dev migrado sem perdas (regras do evento 1 intactas; evento 2 segue aguardando escolha de fundo).
- Observação: o fundo enviado legado "Verde_e_amarelo" (dev, sem referência em regras) ficou sem dono e está invisível para todos os eventos até ser reenviado no evento correto (ou atribuído manualmente).
- Status: **implementado e validado** (efetivo após reinício do servidor; migração automática na inicialização).

### Biblioteca de fundos: miniaturas dos fundos do evento com renomear e excluir

- Contexto: pedido — no card "Biblioteca de fundos" da página de certificados devem aparecer os thumbnails dos fundos do evento, com edição de nome e exclusão.
- Rotas (`routes/events.js`): `findOwnedBackground(eventId,id)` (exige `event_id` do evento e `file_path` em `uploads/` — fundos padrão nunca gerenciáveis aqui); `POST /:id/certificates/backgrounds/:backgroundId/rename` (nome obrigatório, até 120 caracteres) e `POST /:id/certificates/backgrounds/:backgroundId/delete`. A exclusão é **bloqueada** enquanto houver `certificate_emissions` referenciando o fundo (mensagem "O fundo está em uso em N certificado(s) emitido(s)..."), para não alterar PDFs já emitidos; remove o arquivo em disco apenas se nenhuma outra linha compartilhar o mesmo `file_path` (cópias da migração); regras que usavam o fundo ficam com `background_id` nulo (FK `SET NULL`) e a mensagem avisa ("As regras que o utilizavam ficaram sem fundo").
- UI (`views/admin/events/certificates.ejs`): abaixo do formulário de upload, grade de cartões com thumbnail (rota de visualização do evento), nome, formulário de renomear e botão Excluir com `confirm()`. Correção adjacente: faltava o campo oculto `_csrf` nos formulários "Emitir todos os elegíveis" e "Enviar fundo" (com o CSRF global, esses POSTs dariam 403 no navegador); todos os novos formulários incluem o token.
- Verificação: `node --check` e compilação EJS OK. Smoke HTTP (usuário temporário, removido ao final): upload aparece no card do dono (com ações) e não no de outro evento; rename/delete de fundo de outro evento e de fundo padrão → 404; renomear atualiza banco e página; exclusão bloqueada com emissão inserida (linha permaneceu) e liberada após removê-la; exclusão com regra ativa retorna aviso e deixa a regra sem fundo; arquivo some do disco; zero resíduos (conferido em banco e `uploads/certificate-backgrounds`). **Tudo passando.**
- Status: **implementado e validado** (efetivo após reinício do servidor; sem migração de banco).

### Correção: confirmação de exclusão de fundo (CSP) e layout do campo de renomear

- Contexto: relatório de uso em `/admin/events/2/certificates` — (a) botão "Excluir" sem pop-up de confirmação, (b) "Renomear" "não fazia nada", (c) campo com nome do fundo estreito demais (só aparecia um pedaço do texto, parecido com um terceiro botão).
- Causa (a): o `confirm()` estava num handler inline (`onsubmit="..."`) e o **CSP do helmet (`script-src` com nonce) bloqueia event handlers inline** (só `<script>` com nonce executa) — o formulário era submetido sem confirmação. Correção: listener `submit` registrado no script com nonce da página (`views/admin/events/certificates.ejs`), com `data-background-name` no formulário e `preventDefault()` quando cancelado.
- Causa (b/c): a rota de renomear funcionava (provada por teste HTTP); o problema era de layout — dentro do grid de ~135px, o par input+botão em linha deixava o input com ~60px, truncando o nome e dificultando editar (clicar em "Renomear" sem editar não muda nada, parecendo inerte). Correção: cards do grid da biblioteca com `minmax(240px,1fr)`, input largura total acima do botão (empilhados) e `title="Edite o nome e clique em Renomear"`.
- Verificação: EJS compila; HTML renderido conferido (sem `onsubmit` inline, `data-background-name` presente, listener dentro do `<script nonce>`). Necessário reiniciar o servidor.
- Status: **corrigido** (visual: confirmar pop-up ao excluir e campo de nome largo na página de certificados).

### Texto orientativo de proporção no card "Biblioteca de fundos"

- Pedido: incluir no card o texto informando que os certificados são A4 paisagem (297×210 mm / 842×595 pt), que o fundo é esticado para a página inteira e que imagens na mesma proporção (ex.: 1980×1400, 2970×2100 px) evitam distorção.
- Implementação: segundo parágrafo `.hint` no card "Biblioteca de fundos" (`views/admin/events/certificates.ejs`), antes do formulário de upload; sem mudança de código/lógica. EJS compila OK; efetivo após reinício do servidor.

### Meus comentários de funções a implementar

- Fotinha redonda e mini currículo dos palestrantes e professores
- Fotinha redonda dos usuários
- Os pôster ficarem arquivados e visíveis dentro do sistema
- Galeria de fotos do evento
- https://editorialexpress.com/conference/IIOC2026/program/IIOC2026.html
- Conceito de TRILHA
- Várias Atividades/Etapas ao mesmo tempo. Melhor forma de mostrar no grade de dia e horário ?
- Filtro por trilha ? Filtro por Sala ?
