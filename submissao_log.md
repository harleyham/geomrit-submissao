# Histórico Técnico do Projeto

Registro cronológico das principais alterações no sistema de gestão de eventos, avaliação de artigos, participação, presença e certificados de participação.

Versão atual registrada: **V0.1**.

## 2026-08-20

### Correção: e-mail na inclusão manual de participante

- A inclusão em `/admin/events/:id/participants` não acionava o serviço de e-mail, embora criasse a conta e a inscrição normalmente.
- Contas novas agora enfileiram a mensagem combinada de criação de conta e inscrição, com link de definição de senha; contas existentes enfileiram a confirmação de inscrição no evento.
- O envio continua condicionado aos switches global e do evento. Falhas ao enfileirar são registradas sem desfazer a inclusão do participante.

### Fase 3: módulo de e-mails transacionais

- Dependência `nodemailer`; serviço `services/email.js` com SMTP Zoho configurável, fila SQLite, retentativa exponencial, recuperação de envio interrompido e worker/agendador iniciado pelo `server.js`.
- Novas tabelas: `system_settings`, `email_settings_log`, `email_outbox`, `user_setup_tokens`, `import_batches` e `import_batch_entries`; novas colunas de identidade e `email_enabled` em `events`. Master global e de evento iniciam desligados.
- Dashboard e `/admin/events`: controle global restrito a `admin@admin.com`; listagem e formulário do evento possuem switch próprio. Desativação cancela pendências e revoga tokens ainda não enviados.
- Templates EJS neutros: solicitação/aprovação, conta importada, conta+inscrição, inscrição, lembrete, certificado e transmissão. Logo do evento é incorporado somente quando existe; não há imagem fallback.
- Gatilhos implementados: pedido/aprovação de conta, lembrete às 09h do dia anterior, emissão/reemissão, inclusão/alteração/remoção de link em atividade ou etapa (debounce de cinco minutos).
- Correção após teste funcional: a criação direta de usuário em `/admin/users/new` também enfileira o aviso de conta aprovada; inicialmente apenas a aprovação de solicitação pública estava conectada ao gatilho.
- Importações gerais e por evento criam lote persistente e mostram botão de autorização no resultado. Contas novas recebem link de definição de senha de uso único válido por 72h; a senha fixa de importação foi removida.
- Configuração por ambiente: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, identidade global e `APP_BASE_URL`.
- Status: **implementado**; master switches permanecem desligados até configuração das credenciais e ativação administrativa.
- O arquivo .env contém os valores reais e secretos da instalação. Ele não deve ir para o GitHub.
O projeto já possui no .gitignore:
.env
.env.local
O .env.example pode ir para o GitHub porque contém apenas exemplos, sem senhas reais.
Atenção: atualmente o sistema não carrega .env automaticamente. Com a versão atual do Node, execute usando:
node --env-file=.env server.js
Para produção, configure pelo menos:
NODE_ENV=production
SESSION_SECRET=chave-aleatoria-gerada
APP_BASE_URL=https://www.ham.eng.br
SMTP_HOST=smtp.zoho.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=eventos@ham.eng.br
SMTP_PASS=senha-de-aplicativo-do-zoho
MAIL_FROM_ADDRESS=eventos@ham.eng.br
MAIL_FROM_NAME=Equipe de Eventos
MAIL_PLATFORM_NAME=Plataforma de Eventos
MAIL_SIGNATURE=Equipe de Eventos
MAIL_REPLY_TO=eventos@ham.eng.br
Gere o segredo da sessão com:
openssl rand -hex 32
Use uma senha de aplicativo do Zoho em SMTP_PASS, especialmente se a conta tiver autenticação em dois fatores. Não coloque a senha normal nem qualquer segredo no .env.example.
 - Para testar o envio de email coloque a senha SMTP no arquivo local .env:
SMTP_USER=eventos@ham.eng.br
SMTP_PASS=SENHA_DE_APLICATIVO_DO_ZOHO
Use preferencialmente uma senha de aplicativo criada no Zoho, não a senha normal da conta.



### Inscrição pública ou somente pela administração (`public_registration`)

- Requisito do usuário: assim como há a chave de submissão de artigos, o evento deve permitir selecionar se as inscrições serão feitas pelo público ou somente pela administração.
- `services/db-reset.js`: coluna `public_registration INTEGER DEFAULT 1` em `events` (schema + migração idempotente `ALTER TABLE ... ADD COLUMN` para bases existentes — eventos existentes permanecem com inscrição pública).
- `views/admin/events/form.ejs`: novo toggle "Inscrições abertas ao público?" no formulário de criação/edição de evento (mesmo padrão visual do toggle de submissão); pré-marcado por padrão, inclusive para eventos anteriores à coluna.
- `routes/events.js`: criação e edição de evento leem o checkbox `public_registration` e persistem `1`/`0` (campo ausente = `0`); o valor é preservado no re-render em caso de erro de validação/upload.
- `routes/public.js` (`getRegistrationWindow`): quando `public_registration = 0`, a janela de inscrição retorna sempre fechada com a mensagem "As inscrições deste evento são realizadas somente pela administração." — o formulário público (`/evento/:id/inscricao`) é exibido com o botão de envio desabilitado e o `POST` é bloqueado na mesma verificação.
- Cadastro administrativo de participantes (formulário/importação) não é afetado: a administração continua inscrevendo normalmente.
- Status: **implementado** (efetiva após reinício do servidor; migração aplicada na inicialização; validado via HTTP com usuário de teste em janela aberta/fechada).

### Cronograma público: linha "Inscrições" oculta quando a inscrição é somente pela administração

- Requisito do usuário: em `/evento/:id`, eventos com inscrição somente pela administração não devem exibir a linha "Inscrições" no Cronograma.
- `routes/public.js` (`buildEventTimeline`): o item "Inscrições" só é adicionado ao cronograma quando `public_registration !== 0`; as demais linhas (Submissão Artigos, Análise Submissão, Evento, Certificados) não mudam.
- A inserção das linhas de submissão deixou de usar índice fixo (`splice(1, 0, ...)`) e passou a usar `timeline.indexOf(eventItem)`, mantendo a ordem correta (`Inscrições → Submissão Artigos → Análise Submissão → Evento → Certificados`) com ou sem a linha de inscrições.
- Status: **implementado** (efetiva após reinício do servidor; validado em `/evento/2` com o toggle ligado e desligado e em evento com submissão configurada).

## 2026-08-19

### Listagem administrativa de atividades: ordenação por data

- Requisito do usuário: em `/admin/events/:id/activities`, as atividades apareciam ordenadas alfabeticamente por nome dentro de cada card de tipo de atividade; devem ser ordenadas por data.
- `views/admin/events/activities.ejs`: o comparador de `sortedActivities` passou a ordenar por `date_start` (atividades sem data por último, via sentinel `9999-99-99`), com desempate por nome. A query da rota (`routes/events.js`, `ORDER BY ea.date_start, ea.name`) já retornava nessa ordem, mas o sort do template a sobrescrevia; o agrupamento em cards por tipo de atividade é mantido.
- Status: **implementado** (efetiva após reinício do servidor).

### Transmissão prevista sem link (`has_video`) nas atividades

- Requisito do usuário: ao lado do campo do link da transmissão no formulário de atividades, deve haver um checkbox/chave indicando que haverá transmissão, mesmo que o link ainda não seja conhecido; o sistema deve informar que haverá transmissão e, quando o link existir, exibi-lo.
- `services/db-reset.js`: coluna `has_video INTEGER DEFAULT 0` em `event_activities` (schema + migração idempotente `ALTER TABLE ... ADD COLUMN`).
- `routes/events.js`: criação e edição de atividade gravam `has_video` (checkbox `= '1'`); `video_url` preenchido impõe `has_video = 1` automaticamente; link vazio preserva a flag conforme o checkbox.
- `views/admin/events/activities.ejs`: checkbox "Haverá transmissão de vídeo (mesmo que o link ainda não esteja disponível)" ao lado do campo de link (pré-marcado quando há flag ou link); na listagem, atividade com `has_video` e sem link exibe o rótulo "Transmissão" (estilo de ação, sem link) no lugar do botão "Vídeo".
- `routes/public.js`: a query de atividades do evento público passa a incluir `has_video`.
- `views/public/event.ejs`: no card "Atividades do Evento", a coluna Transmissão exibe o botão "Assistir transmissão" com link (quando há `video_url`), o aviso "Transmissão prevista — link a ser divulgado" (quando `has_video` sem link) ou o espaço vazio (sem transmissão).
- Status: **implementado** (efetiva após reinício do servidor; migração aplicada na inicialização).

### Botão "Página pública" na listagem administrativa de eventos

- Requisito do usuário: em `/admin/events`, cada evento deve ter um botão levando à sua página pública (`/evento/:id`).
- `views/admin/events/list.ejs`: nova ação "Página pública" no início da coluna Ações, aberta em nova aba (`target="_blank" rel="noopener noreferrer"`), exibida apenas para eventos `published`/`encerrado` — a rota pública `GET /evento/:id` (`routes/public.js`) retorna 404 para rascunhos, então o botão não aparece para `draft`.
- Status: **implementado** (efetiva após reinício do servidor).

### Correção: período do evento deslocado um dia na área do participante

- Relatório do usuário: em `/admin/users/:id/participant` (prévia admin) e `/author`, o período do evento aparecia com o dia anterior ao cadastrado.
- Causa raiz: `new Date('YYYY-MM-DD')` (data ISO sem horário) é interpretada como meia-noite **UTC**; em UTC-3 (Brasil), `toLocaleDateString('pt-BR')` renderizava o dia anterior.
- `routes/public.js` e `routes/users.js` (`withSubmissionMeta`): `formatDate` passou a parsear `String(value).slice(0,10) + 'T00:00:00'` (meia-noite local, mesmo padrão do `formatBRDate` de `server.js`).
- `views/public/author-dashboard.ejs`: a tabela "Minhas Participações" usava `new Date(...).toLocaleDateString()` no navegador (mesmo bug); passou a usar o helper `formatBRDate`.
- Obs.: o mesmo padrão ainda existe em `views/public/home.ejs` e em `formatDisplayDate` (cronograma público) — não alterado nesta rodada.
- Status: **corrigido** (efetiva após reinício do servidor).

### Etapas no card público do evento com vídeo por etapa

- Requisito do usuário: `/evento/:id` deve mostrar as etapas de cada atividade; as etapas podem ter vídeos diferentes do da atividade.
- `services/db-reset.js`: coluna `video_url TEXT` em `activity_sessions` (schema + migração idempotente `ALTER TABLE ... ADD COLUMN`).
- `routes/events.js`: criação e edição de etapa gravam `video_url` (trim; vazio → `NULL`; acima de 500 caracteres é rejeitado).
- `views/admin/events/activity-sessions.ejs`: campo "Link da transmissão da etapa (opcional — se vazio, usa o vídeo da atividade)" no formulário e coluna "Transmissão" na listagem ("Vídeo" quando há link).
- `routes/public.js` (`GET /evento/:id`): consulta `activity_sessions` do evento e anexa a cada atividade como `sessions` (ordem `sequence_no`).
- `views/public/event.ejs`: o card "Atividades do Evento" renderiza sub-linha por etapa (data, nome indentado, classe CSS `session-row`); a etapa exibe o próprio vídeo quando configurado, senão herda o vídeo da atividade.
- Status: **implementado** (efetiva após reinício do servidor; migração aplicada na inicialização).

### Transmissão prevista sem link por etapa (`activity_sessions.has_video`)

- Requisito do usuário: o formulário da etapa deve ter o mesmo checkbox/chave da atividade para informar que haverá transmissão ainda que o link só seja conhecido depois.
- `services/db-reset.js`: coluna `has_video INTEGER DEFAULT 0` em `activity_sessions` (schema + migração idempotente).
- `routes/events.js`: criação e edição de etapa gravam `has_video` (checkbox `= '1'`); `video_url` preenchido impõe `has_video = 1` automaticamente.
- `views/admin/events/activity-sessions.ejs`: checkbox "Haverá transmissão de vídeo (mesmo que o link ainda não esteja disponível)" ao lado do campo de link (pré-marcado quando há flag ou link); a coluna "Transmissão" da listagem exibe "Transmissão" quando a flag está definida sem link.
- `routes/public.js`: a query de etapas inclui `has_video`.
- `views/public/event.ejs`: prioridade da linha da etapa — vídeo próprio da etapa → aviso "Transmissão prevista — link a ser divulgado" (flag da etapa) → vídeo da atividade → aviso (flag da atividade) → espaço vazio.
- Status: **implementado** (efetiva após reinício do servidor; migração aplicada na inicialização).

## 2026-08-18

### Card de atividades com link de transmissão no evento público

- Requisito do usuário: na página pública do evento (`/evento/:id`), um novo card deve exibir as atividades do evento ordenadas por data e hora, com um espaço ao lado do nome de cada atividade para o link da transmissão de vídeo (backlog "Link para a palestra/aula").
- `services/db-reset.js`: coluna `video_url TEXT` em `event_activities` (schema + migração idempotente `ALTER TABLE ... ADD COLUMN` para bases existentes).
- `routes/events.js`: criação e edição de atividade passam a gravar `video_url` (trim; vazio → `NULL`; acima de 500 caracteres é rejeitado com mensagem de erro — o handler revalida porque o `validateAndHandle` segue com `next()` em falhas de formulários não-XHR); a listagem administrativa exibe ação "Vídeo" para atividades com link.
- `security/validation.js`: `activityForm` valida `video_url` opcional (máximo 500 caracteres).
- `routes/public.js`: `GET /evento/:id` passa a consultar as atividades do evento ordenadas por data (sem data por último) e nome, incluindo `video_url`, e as envia ao template.
- `views/public/event.ejs`: novo card "Atividades do Evento" após o cronograma — colunas Data | Atividade | Transmissão; o botão "Assistir transmissão" abre o link em nova aba (`rel="noopener noreferrer"`); atividade sem link exibe o espaço vazio (—).
- `views/admin/events/activities.ejs`: campo "Link da transmissão de vídeo" no formulário de cadastro/edição (pré-preenchido na edição) e ação "Vídeo" na listagem.
- Validação E2E (18/08, sandbox isolado na porta 3104 + backup do banco real): **20/20 checks** — migração da coluna no boot; card público com atividades ordenadas por data; link existente exibe o botão com a URL correta em nova aba; espaço vazio sem link; data em formato BR; form admin com valor pré-preenchido; "Vídeo" na listagem; criação, edição e limpeza do link (vazio → `NULL`); link >500 caracteres rejeitado com erro e nada gravado.
- Status: **implementado e validado**; servidor reiniciado e a página `http://127.0.0.1:3000/evento/1` exibe o card (atividade sem link exibe o espaço vazio até o admin configurar).

### Bug: prévia da Área do Participante interpretava os comandos como a conta do admin

- Bug reportado: ao acessar a página de um usuário ("Área do Participante", `GET /admin/users/:id/participant`), os comandos que o admin dava eram interpretados como a conta do admin, e não como o usuário sendo visualizado.
- Causa: a prévia renderizava `public/author-dashboard` com `previewMode`, mas os links/formulários daquela página apontam para rotas públicas que usam `req.session.userId` — a conta do admin logado.
- Correção (impersonação por sessão, escopo da prévia):
  - `routes/users.js` (`GET /:id/participant`): grava `session.realIdentity` (backup da identidade do admin: `userId`, `userName`, `userEmail`, `userInstitution`, `isPublic`, `isAdmin`, `isReviewer`) e `session.previewUserId`, e aplica a identidade do usuário pré-visualizado à sessão; usuário inativo (`is_public = 0`) retorna 400 "Conta inativa" em vez do dashboard (evita ações ambíguas).
  - `server.js`: novo middleware (antes de `requireActiveAccount`) — em requests fora de `/admin/*`, mantém a sessão com a identidade do usuário pré-visualizado (revalidando a cada request que ele exista e esteja ativo; senão restaura o admin); em qualquer request em `/admin/*`, restaura `realIdentity` e limpa `previewUserId`/`realIdentity` (a saída da prévia é automática ao voltar ao painel).
- `views/public/author-dashboard.ejs`: o aviso da prévia passa a explicar que as ações são registradas em nome do usuário visualizado, com link "Sair da visualização".
- Validação E2E (18/08, servidor real): sem prévia o admin (não inscrito no evento 1) recebe 403 em `/evento/1/qr-presenca`; com a prévia do usuário 2 a mesma rota retorna 200 com o token QR do usuário 2; `POST /evento/1/atividades` (avaliação) gravou em nome do usuário 2 (auditoria `participant_activities_updated_self_service`), sem tocar a conta do admin; ao voltar a `/admin/users` a identidade do admin foi restaurada (403 de novo no QR); prévia de usuário inativo retornou 400 "Conta inativa". Estado original restaurado após os testes.
- Status: **implementado, validado e commitado em `a301f8e`**.

### Participante: edição de perfis por evento no formulário de edição do participante

- Requisito do usuário: na edição do participante (`/admin/events/:id/participants/:registrationId/edit`), além dos dados e das atividades da inscrição, permitir editar também os perfis do usuário para aquele evento (como a seção "Perfis por evento" de `/admin/users/:id/edit`).
- `routes/events.js`:
  - `updateParticipant`: quando a inscrição possui conta vinculada, passa a chamar `validateAndSaveParticipantEventRoles` (função existente, até então nunca utilizada) antes da transação principal; erro de validação (ex.: apresentador sem artigo aprovado) bloqueia o salvamento inteiro com a mensagem exibida no formulário.
  - `requestedEventRoles`: o ID do artigo é normalizado (inteiro positivo ou `null`), evitando bind de `NaN` no SQLite.
  - `validateAndSaveParticipantEventRoles`: papel de apresentador (oral/pôster) sem artigo selecionado agora retorna erro de validação em vez de consultar o banco com `NaN`.
  - Auditoria `participant_updated_manually` passa a registrar `event_roles` anterior e atual nos detalhes.
- `views/admin/events/participant-form.ejs`: nova seção "Perfis no evento (da conta vinculada)" (apenas na edição com conta vinculada): checkboxes Palestrante, Professor, Apresentador Oral e Apresentador Pôster (pré-marcados com os perfis atuais, usando a classe CSS `event-role-option` já existente) + seletores de artigo aprovado oral/pôster (pré-selecionados); o link para "Perfis por evento" do usuário permanece (papéis de administrador, revisor e participante continuam sendo administrados lá).
- Escopo (decisão confirmada com o usuário): o formulário de participante gerencia apenas os papéis operacionais (speaker, teacher, oral_presenter, poster_presenter), conforme o design já documentado em `validateAndSaveParticipantEventRoles`; os demais papéis são preservados intactos.
- Validação E2E (18/08, servidor real): a seção renderiza com o perfil atual pré-marcado (Professor para o usuário 2); POST marcando "Palestrante" salvou o papel preservando Professor/Participante; Apresentador Oral sem artigo retornou 400 com a mensagem e nada foi gravado; auditoria registrou anterior/atual; estado original restaurado após os testes.
- Status: **implementado e validado**.

### Crachá em PDF: remoção dos rótulos "QR DE PRESENÇA" e "CÓDIGO DO CRACHÁ"

- Requisito do usuário: no PDF do crachá (rotas pública e admin), retirar o texto "QR DE PRESENÇA" e o texto "CÓDIGO DO CRACHÁ".
- `services/cracha.js` (`renderCrachaPdf`): removidas as duas chamadas de `doc.text(...)` e os ajustes de `y` subsequentes; o layout ficou logo → nome do evento → linha → nome → instituição → papéis → QR → código em destaque → rodapé.
- Validação: PDF gerado diretamente via serviço e texto extraído (`pdftotext`) — os dois rótulos não aparecem mais; o código segue logo abaixo do QR.
- Status: **implementado e validado**.

### Relatório: status "Conta inativa" na coluna Participação

- Requisito do usuário: no relatório do evento (`/admin/reports?eventId=`), os inscritos com conta inativa (`is_public = 0`) devem ter esse status exibido na coluna "Participação".
- `routes/reports.js`: a query de participantes passou a fazer `LEFT JOIN users` e retorna `account_status` (o `is_public` da conta vinculada; `NULL` quando a inscrição não possui conta vinculada).
- `views/admin/reports/list.ejs`: quando `account_status = 0`, a célula de "Participação" exibe o badge "Conta inativa" (mesmo estilo vermelho da listagem de participantes), mantendo os badges existentes (papéis e/ou situação de participação).
- Validação E2E (18/08, sandbox isolada na porta 3103 + backup do banco real): **8/8 checks** — os 3 inscritos inativos do evento 1 exibem o badge, o inscrito ativo não exibe, total de badges = 3 e o badge de situação pré-existente permanece.
- Status: **implementado e validado** (efetiva após reinício do servidor).

### Avaliação de atividades pelo participante (Ciclo 3)

- Requisito (item do backlog "Implementar Campo para os participantes avaliarem as Etapas, Tarefas e Eventos"): o participante inscrito em atividades registra avaliação por atividade, visível ao administrador na chamada da atividade e no relatório do evento.
- `services/db-reset.js`: nova tabela `activity_evaluations` (`event_id`, `activity_id`, `user_id`, `evaluation`, `created_at`, `updated_at`; `UNIQUE(activity_id,user_id)`; FKs para `events`/`event_activities`/`users` com `ON DELETE CASCADE`) com índices por evento+atividade e por usuário; incluída na lista `TABLES` do reset.
- `routes/public.js`:
  - `GET /evento/:id/atividades`: cada atividade inscrita exibe textarea com a avaliação existente; evento `encerrado` mantém a página acessível (200, não 404) com aviso "somente as avaliações podem ser editadas", sem checkboxes de inscrição enviáveis e botão "Salvar avaliações".
  - `POST /evento/:id/atividades`: evento publicado valida as atividades enviadas e grava inscrições + avaliações no mesmo request; evento encerrado ignora `activity_ids` (inscrições preservadas) e processa apenas avaliações das atividades já inscritas; campos `evaluation_<id>` de atividades não inscritas são ignorados (anti-tampering); texto acima de 2000 caracteres é rejeitado com mensagem e nada é gravado; texto vazio (apenas espaços) remove a avaliação existente (upsert `ON CONFLICT(activity_id,user_id) DO UPDATE`, com `updated_at` em UTC-3).
- `routes/events.js`: a chamada da atividade (`GET .../attendance`) passa a renderizar a seção "Avaliações dos participantes" (nome + data + texto), com estado vazio "Nenhuma avaliação registrada para esta atividade".
- `routes/reports.js`: `evaluatorsCount` (`COUNT(DISTINCT user_id)`) e mapa de avaliações por atividade (nome + texto + data, ordenado por atividade e nome) passados ao template.
- `views/public/event-activities.ejs`: textareas `evaluation_<activityId>` por atividade inscrita (valor persistido), aviso e botão "Salvar avaliações" no estado encerrado.
- `views/admin/events/activity-attendance.ejs`: seção "Avaliações dos participantes" na chamada, com lista nome + data + texto.
- `views/admin/reports/list.ejs`: card "Participantes que avaliaram" nas estatísticas e, por atividade com avaliações, botão "Ver avaliações (n)" (toggle, oculto por padrão) com a lista.
- Validação E2E (18/08, sandbox isolada na porta 3102 + backup do banco real): **36/36 checks** — login do participante; textareas apenas para atividades inscritas; gravação de duas avaliações no mesmo POST; `evaluation_99` (não inscrita) ignorado; texto vazio remove a avaliação; atualização sobrescreve; >2000 rejeitado com mensagem e valor anterior preservado; evento encerrado: página 200, sem checkboxes, aviso e botão presentes, inscrições preservadas e avaliação atualizável; admin: chamada exibe a seção com as avaliações e o estado vazio para atividade sem avaliações; relatório: card "Participantes que avaliaram" com DISTINCT correto (3 linhas, 2 usuários distintos), contagens por atividade corretas (2 e 1) e blocos ocultos por padrão.
- Status: **implementado, validado e commitado em `700114f`** (Ciclo 3 do `plano.md` concluído).

## 2026-08-17

### Manual inicial do sistema

- Criado `manual.md` como guia operacional inicial, cobrindo introdução, instalação, primeiro acesso, usuários, eventos, participantes e papéis, atividades, etapas, presença/QR Code, certificados, dashboard, relatórios, fluxo recomendado e solução de problemas.
- `README.md` passou a apontar para o manual; o documento será ampliado posteriormente com capturas de tela, FAQ e procedimentos de implantação.

### Correção: upload e prévia do logo do evento

- Corrigido o `fileFilter` do Multer usado pelo logo do evento: imagens PNG/JPEG válidas agora são aceitas explicitamente com `cb(null, true)` e gravadas em `uploads/event-logos/`.
- Os formulários de criação e edição de evento agora mostram imediatamente a prévia e o nome do arquivo selecionado, antes de salvar.
- Ao selecionar uma nova imagem na edição, a opção de remover o logo atual é desmarcada automaticamente.
- Verificações locais concluídas: sintaxe de `routes/events.js` e `services/event-logo.js`, compilação EJS dos formulários e páginas públicas, presença das colunas `logo_path` e `logo_original_name` no schema e `git diff --check`; validação funcional pelo usuário requer reinício do servidor.

### Correção: importação CSV com quebras de linha CRLF ("arquivo vazio")

- Relatório do usuário: a importação de participantes via CSV em `/admin/events/:id/import-users` falhava com "O arquivo está vazio ou não possui dados." para CSVs exportados do Excel no Windows (quebras CRLF); XLSX continuava funcionando.
- Causa raiz: o `skipLineEnding` do parser CSV próprio consumia apenas o `\r` da quebra CRLF (`\r\n`), deixando o cursor no `\n`. A linha seguinte era lida como vazia e interpretada como fim de arquivo, fazendo `parseCsvContent`/`parseImportCsvContent` retornarem 0 linhas para qualquer CSV com quebras de linha do Windows.
- Correção: `skipLineEnding` avança 2 posições ao detectar CRLF (1 para `\r` ou `\n` isolados) em `routes/events.js` (parser da rota `/admin/events/:id/import-users`) e `routes/users.js` (parser da rota `/admin/users/import`).
- Verificação: arquivo real `Even3_1.csv` (13 colunas, 3 linhas, CRLF, sem BOM) parseado corretamente; variações cobertas — LF, CRLF, CRLF/LF misturados, CR isolado, BOM, campos entre aspas com o delimitador, linhas vazias no fim e arquivo somente com cabeçalho (0 linhas).
- Status: **implementado e validado** (efetiva após reinício do servidor).

### Página pública de atividades: contador e etapas de presença

- Requisito do usuário: no card de cada atividade em `/evento/:id/atividades` (ex.: "Minicurso 1"), mostrar **quantas presenças** o usuário tem na atividade e **quais etapas** já marcou presença.
- `routes/public.js` (GET `/evento/:id/atividades`):
  - A query principal passa a computar `sessions_total` (`COUNT(*)` de `activity_sessions` por atividade).
  - Nova consulta auxiliar lista as etapas frequentadas pelo usuário no evento (join de `activity_attendance_records` com `activity_sessions`, `role='participant'`, ordenado por `sequence_no`) e monta o mapa `attendedSessionsByActivity`; cada atividade recebe `attended_sessions` (nomes das etapas) e `sessions_total` normalizado (número).
- `views/public/event-activities.ejs`: para atividades com etapas, o badge `.present` passa a exibir "**N de M presenças — Etapa1 · Etapa2…**" (contagem + relação das etapas frequentadas); atividades sem etapas mantêm o texto anterior ("Presença registrada — inscrição preservada").
- Verificação em sandbox (cópia do projeto + banco real): "Minicurso 1" (5 etapas) renderiza "3 de 5 presenças — Aula 1 · Aula 2 · Aula 3"; "Palestras" (sem etapas) não exibe contador. A inscrição de atividades com presença continua preservada (checkbox bloqueado).
- Status: **implementado e validado**.

### Presença por QR Code do crachá (código pessoal + leitura pelo operador)

- Requisito do usuário: além da folha impressa por etapa (auto-check-in), o participante deve ter um QR Code **pessoal** (crachá) que o operador lê na chamada para registrar a presença de terceiros (proxy por admin).
- `services/db-reset.js`: nova tabela `event_qr_codes` (`event_id`, `user_id`, `token`, `created_at`; `UNIQUE(event_id,user_id)` + índice único em `token`), incluída na lista de tabelas do reset.
- `routes/public.js`:
  - Token de 10 caracteres (alfabeto sem caracteres ambíguos, derivado de `crypto.randomBytes`), criado sob demanda e estável por usuário/evento (`ensureEventQrToken`).
  - `GET /evento/:id/qr-presenca` (`requireNonAdminAuthorAccess`): 404 para evento inexistente ou `draft`; 403 sem inscrição nem papel no evento; renderiza `views/public/qr-presenca.ejs` com o QR Code (PNG dataURL via `qrcode`), o código em texto grande, os papéis do usuário no evento e CSS `@media print` para imprimir o crachá.
  - `getEventQrRoles`: papéis em `event_user_roles` (sem `admin`) + `reviewer` quando há artigo atribuído.
- `views/public/author-dashboard.ejs`: botão "QR de presença" por participação.
- `routes/events.js`:
  - `POST /:id/activities/:activityId/attendance/qr` (`strictLimiter`): normaliza o código (A-Z0-9, 8–16 caracteres), busca em `event_qr_codes` restrita ao evento, resolve o papel via `resolveScanRole` (mantém o papel já marcado na etapa; senão `participant` se inscrito na atividade; senão o primeiro papel elegível que a pessoa possui no evento) e grava via `applyAttendanceMark` com auditoria `activity_attendance_marked` + detalhe `via_qr: true`. Erros redirecionam com mensagem específica (código inválido, código não pertence ao evento, pessoa sem papel elegível).
  - Refatoração: `applyAttendanceMark` extraída do `POST .../attendance/:userId` e compartilhada entre a marcação manual e a leitura do crachá (mesmas validações de papel/inscrição e mesma auditoria); o handler manual passou a redirecionar com `?error=` em caso de falha.
  - GET da chamada passa `markedUserId` para destacar e rolar até a linha da pessoa marcada.
- `views/admin/events/activity-attendance.ejs`: seção "Presença por QR Code (crachá)" com campo de código + botão "Marcar"; botão "Ler QR Code" abre a câmera (`getUserMedia`, `facingMode: environment`) e decodifica com **jsQR servido localmente** (`public/lib/jsQR.min.js`, sem CDN por causa da CSP); fallback de digitação manual; vibração, destaque da linha e scroll até ela após o scan; aviso quando a câmera está indisponível (exige HTTPS ou localhost).
- `server.js`: sem mudança — `express.static('public')` já servia a pasta (o jsQR é a primeira estática dela).
- Validação E2E (17/08, sandbox isolada na porta 3010): **38/38 checks passaram** — público (redirect de anônimo, página do crachá 200 com QR em PNG dataURL, token de 10 caracteres estável e distinto por evento, 403 sem inscrição/papel, 404 para evento inexistente/draft, jsQR servido localmente); admin (scan do crachá com `marked_user_id` no redirect, registro com papel/sessão corretos, auditoria `via_qr`, idempotência de rescan, presença nas 5 etapas, atividade sem etapas com sessão nula, rejeição de código malformado/inexistente/de outro evento, resolução de papel teacher/speaker/participant, bloqueio de não-admin no POST, destaque da linha `row-marked`, elegibilidade no painel de certificados); impressão (PDF do crachá 200 com QR embutido, 403 sem vínculo).
- Correção feita durante a validação: `views/admin/events/activity-attendance.ejs` usava ternário dentro de `<%= %>`, o que escapava as aspas e renderizava `class=&#34;row-marked&#34;` — trocado por `<% if (markedUserId === p.user_id) { %> class="row-marked"<% } %>` (atributo renderizado literalmente).
- Impressão do crachá (reportado pelo usuário em 17/08: o botão "Imprimir crachá" não fazia nada): o `onclick="window.print()"` inline era bloqueado pela CSP do helmet 8 (default `script-src-attr 'none'`). Substituído pelo padrão do sistema — link "Imprimir crachá" para a nova rota `GET /evento/:id/qr-presenca/print` (`routes/public.js`), que gera **PDF** (PDFKit) com o conteúdo do crachá (nome, instituição, papéis, QR do token, código em destaque e observações), `Content-Disposition: inline`; mesmos guards da página (404 para draft/inexistente, 403 sem inscrição/papel). Nota: `doc.text()` desta versão do pdfkit retorna o documento — o layout acompanha `doc.y` após cada chamada.
- Status: **implementado e validado (E2E 38/38 em 17/08); fluxo do crachá commitado em `804e40c` — impressão do crachá (PDF) commitada em `61ac481`**.

### Correção: CSP `script-src-attr 'none'` bloqueando `onclick` inline em toda a app

- Alerta de segurança registrado em 17/08: o default do helmet 8 (`script-src-attr 'none'`) bloqueava todos os handlers `onclick` inline (13 views). Impacto mais grave: nos `<a onclick="return confirm()">` do admin (backup/restore/reset), o clique navegava **sem** a confirmação — as ações perigosas perdiam o `confirm()`.
- Correção: `server.js` — adicionado `scriptSrcAttr: ["'unsafe-inline'"]` às direções da CSP no helmet (1 linha), permitindo handlers inline nos templates.
- Verificação: servidor de teste na porta 3099; header `Content-Security-Policy` passa a incluir `script-src-attr 'unsafe-inline'`.
- Status: **implementado e validado** (efetiva após reinício do servidor — o servidor em execução na porta 3000 ainda roda com a CSP anterior).

### Credenciamento: botão "Imprimir crachá" por participante na listagem admin

- Requisito do usuário: em `/admin/events/:id/participants`, a coluna "Conta" deve ter botão de impressão do crachá **por participante**, gerando o PDF direto — o encaminhamento para a área do participante leva a um bug conhecido (com a conta de admin logada, o sistema interpreta como a área do participante do admin).
- `services/cracha.js` (novo): extraída a lógica do crachá de `routes/public.js` — `QR_TOKEN_ALPHABET`/`generateQrToken`/`ensureEventQrToken`, `getEventQrRoles`, `QR_ROLE_LABELS` e `renderCrachaPdf(res, { event, registration, roles, token, nameFallback })` (layout PDF idêntico ao anterior: A4, card 420x600, QR do token, código em destaque).
- `routes/public.js`: helpers locais removidos (importados do serviço); a rota `GET /evento/:id/qr-presenca/print` passou a usar `renderCrachaPdf` (comportamento inalterado).
- `routes/events.js`: nova rota `GET /:id/participants/:registrationId/qr-presenca/print` — valida os IDs com `parseInt`, 404 para evento/inscrição inexistente no evento, 400 quando a inscrição não tem conta vinculada (o código do crachá é por usuário/evento), senão emite o PDF do participante via `renderCrachaPdf`.
- `views/admin/events/participants.ejs`: botão "Imprimir crachá" na coluna "Conta" (linha de ações, antes de "Editar"), exibido apenas quando `participant.user_id` existe; link GET sem `onclick`, imune à CSP.
- Validação: realizada pelo usuário (17/08).
- Status: **implementado e validado**.

### Correção: exclusão de usuário/participante via `_method=DELETE` (erro NOT NULL)

- Relatório do usuário (17/08): ao clicar em "Excluir" em `/admin/users`, erro `SqliteError: NOT NULL constraint failed: users.name` em `updateUser` (routes/users.js:646).
- Causa raiz: na versão instalada do `method-override`, getter por string que não começa com `X-` lê **somente a query string** (`createQueryGetter`), nunca o body. O hidden input `_method=DELETE` dos formulários nunca era processado (a ordem dos middlewares em `server.js` era sintoma, não causa); o POST caía em `router.post('/:id(\\d+)')` → `updateUser` com body vazio (`{ _csrf, _method }`). `validateAndHandle` prossegue via `next()` em falhas de validação de não-XHR, e o SELECT de `user` no `updateUser` não trazia `name`/`email`, então `name || user.name` gerava `undefined` → bind NULL → `NOT NULL constraint failed`.
- Correções:
  - `server.js`: `methodOverride` com **getter por função** — lê `req.body._method` (string) e, se ausente, `_method` na query (mantém compatibilidade com `?_method=`); posicionado **depois** de `express.json`/`express.urlencoded` (o getter por função precisa do body parseado).
  - `routes/users.js` (`updateUser`): SELECT passa a incluir `name`/`email`; binds usam `displayName = name || user.name` e `displayEmail = email || user.email` (body parcial não mais zera/quebra o registro).
  - `views/admin/users/list.ejs`: `confirm()` do "Excluir" (usuários aprovados) passa a detalhar o impacto definitivo — remove papéis em eventos, inscrições em atividades, presenças, crachá (QR Code) e atribuições de revisão — e sugere desligar o controle "Conta ativa" quando o objetivo for só bloquear acesso (histórico preservado); nota da seção reforça: desativar preserva histórico, excluir é definitivo (reservado para cadastros por engado).
  - Decisão do usuário: **inabilitar ("Conta ativa") é a operação principal**; exclusão permanece para cadastros por engado, com o aviso acima.
  - Efeito colateral positivo: a remoção de participante (`/admin/events/:id/participants/:registrationId`, mesmo padrão `_method=DELETE`) — igualmente quebrada — também passou a funcionar.
- Validação E2E (17/08, sandbox isolada na porta 3099 + snapshot do banco via `better-sqlite3 .backup()`): (a) POST `/admin/users/:id` com só `_csrf`+`_method=DELETE` → 302 `success=Usuário excluído` e linha removida do banco (antes: 500 NOT NULL); (b) update normal com form completo → 302 e dados persistidos (name/email/institution); (c) remoção de participante via `_method=DELETE` → 302 `Participante removido com sucesso`.
- Status: **implementado e validado** (efetiva após reinício do servidor).

### Inativação de conta com efeitos práticos (is_public=0)

- Relatório do usuário (17/08): inabilitar um usuário não tinha efeito prático — inscrito em uma atividade e inabilitado, "continuava ativo nas atividades". A flag `is_public` só bloqueava o login.
- Semântica adotada (consistente com a decisão anterior de preservar histórico na inativação): inativação = bloquear acesso e impedir **novas** presenças; presenças/inscrições já registradas e elegibilidade de certificados são preservadas; correções (desmarcar) continuam permitidas.
- Mudanças:
  - `routes/auth.js`: novo middleware `requireActiveAccount` (exportado) — em todo request autenticado, se `is_public=0` destrói a sessão e redireciona para `/login?error=...` com aviso; `GET /login` passa a exibir o `error` da query.
  - `server.js`: `requireActiveAccount` aplicado globalmente, antes de `requireOnboarding`.
  - `routes/events.js` (chamada): a query da listagem passa a trazer `account_active` (`MAX(COALESCE(u.is_public,0))` com `LEFT JOIN users`); `applyAttendanceMark` (manual + QR do crachá) rejeita conta inativa com erro explicativo; "Marcar presença (todos)" pula contas inativas (contabilizadas em "ignoradas"); "Desmarcar (todos)" continua removendo (correção).
  - `views/admin/events/activity-attendance.ejs`: badge "Conta inativa" na linha da pessoa, sem botão "Marcar/Atualizar" (o "Remover" permanece); nota "Presença bloqueada — conta inativa" no lugar do botão.
  - `routes/events.js` (participantes) + `views/admin/events/participants.ejs`: badge "Conta inativa" na coluna "Conta" da listagem do evento.
- Validação E2E (17/08, sandbox isolada porta 3099 + snapshot do banco): usuário ativo acessa `/evento/1/atividades` (200) → inabilitado no banco → próximo request cai em `302 /login?error=Conta inativa...`; chamada exibe badge/nota e sem botão de marcar; marcação manual e scan do crachá do inativo rejeitados com o erro explicativo; "Marcar (todos)" pulou o inativo (0 marcadas, 4 ignoradas, sem registro); reativado → marcação manual OK; inabilitado → "Desmarcar (todos)" removeu a presença existente (correção permitida); listagem de participantes exibiu o badge; reativado → login volta a funcionar.
- Status: **implementado e validado** (efetiva após reinício do servidor).

### Logo do evento (PNG/JPEG) nas páginas públicas e nos PDFs

- Requisito do usuário: cada evento pode ter um logo (PNG/JPEG, até 5 MB), exibido nas páginas públicas e nos materiais impressos do evento (crachá, lista de presença, folha com QR Code).
- `services/event-logo.js` (novo): `getEventLogoAbsPath(event)` resolve o `logo_path` para caminho absoluto com proteção contra path traversal (aceita apenas valores com prefixo `uploads/event-logos/` e nome de arquivo único; retorna `null` se o arquivo não existir); `removeEventLogoFile(logoPath)` remove o arquivo do disco ignorando falhas; `drawEventLogo(doc, event, { x, y, width, height })` desenha o logo centralizado na caixa via `doc.image(..., { fit })` sem alterar o cursor do documento — falha de renderização é logada e o PDF continua sem o logo (retorna `false`).
- `services/db-reset.js`: `events` ganha `logo_path` e `logo_original_name` (TEXT) no schema + migração idempotente (`ALTER TABLE ... ADD COLUMN` quando ausente).
- `routes/events.js`:
  - Nova instância `multer` `eventLogoUpload` (diskStorage em `uploads/event-logos/`, nome `<timestamp>-<hex>.<ext>`, limite 5 MB, `fileFilter` só `image/png`/`image/jpeg`) e wrapper `runEventLogoUpload` que converte erro de upload em `req.logoUploadError` (removendo o arquivo gravado em caso de falha, para o form ser re-renderizado sem 500).
  - `POST /` (criar) e `POST /:id` (editar): `runEventLogoUpload` na cadeia; criação grava `logo_path`/`logo_original_name`; edição substitui o logo atual (removendo o arquivo antigo do disco) quando há arquivo enviado, e o remove quando o checkbox `remove_logo` está marcado; em erro de validação, o arquivo já enviado é removido.
  - `DELETE /:id`: remove o arquivo do logo antes de excluir o evento.
  - `GET /:id/activities/:activityId/attendance-print` e `GET /:id/activities/:activityId/checkin-print`: desenham o logo no topo da página via `drawEventLogo` e deslocam o título quando presente; sem logo o layout é inalterado.
- `services/cracha.js` (`renderCrachaPdf`): quando o evento tem logo, desenha no topo do card (altura 46pt) e reduz o QR de 240 para 216pt para manter o card no limite; sem logo o layout original é preservado.
- `server.js`: `app.use('/uploads/event-logos', express.static(...))` para servir o logo (junto às demais estáticas, antes da sessão).
- `views/admin/events/form.ejs`: form principal passa a ter `enctype="multipart/form-data"`; campo "Logo do Evento" (`input type="file"`, aceita PNG/JPEG) com prévia imediata do arquivo selecionado, nome do arquivo, preview do logo atual e checkbox "Remover logo atual" na edição.
- `views/public/home.ejs` e `views/public/event.ejs`: exibem o logo no card do evento (home) e no topo da página pública do evento, quando `logo_path` existe.
- Diagnóstico concluído: o `fileFilter` chamava `cb(null)` para MIME válido, sem o segundo argumento exigido pelo Multer; por isso o arquivo era silenciosamente ignorado, `req.file` permanecia vazio, `logo_path` ficava nulo e a pasta não recebia a imagem. Corrigido para `cb(null, true)`.
- Status: **corrigido, validado (validação funcional confirmada pelo usuário em 18/08 após reinício do servidor) e commitado em `700114f`**.

### Ajuste de plano: troca da ordem de execução entre Fase 2 e Fase 3

- Decisão do usuário (17/08): executar **Fase 3 (E-mails)** antes de **Fase 2 (Auditoria)**; os nomes das fases foram mantidos.
- `plano.md`: linha "Ordem" das decisões atualizada para `Fase 0 → Fase 1 (Aulas+QR) → Fase 3 (E-mails) → Fase 2 (Auditoria)` e seções dos ciclos reordenadas (Ciclo 3 agora cobre E-mails, Ciclo 4 cobre Auditoria).
- `submissao.md`: referência ao plano na seção "Planejamento Proposto" atualizada para a nova ordem.

### Conta inativa: oculta nas listas de presença e sem ações aplicáveis

- Requisito do usuário (17/08): usuários inativos (`is_public = 0`) não devem aparecer nas listas de presença nem ser alvo de qualquer outra ação (antes apareciam na chamada com badge "Conta inativa" e botão bloqueado).
- `routes/events.js`:
  - Chamada da atividade (`GET .../attendance`): a query de pessoas agora faz `JOIN users` + `HAVING COALESCE(u.is_public, 0) = 1` — inativos saem da listagem por completo.
  - Lista de presença em PDF (`GET .../attendance-print`): a subquery carrega `MAX(ep.user_id)` e aplica `LEFT JOIN users ... AND (u.id IS NULL OR u.is_public = 1)` — inativos saem do PDF; inscrições sem conta vinculada continuam listadas.
  - Impressão do crachá via credenciamento (`GET .../participants/:registrationId/qr-presenca/print`): nova guarda retorna 400 com mensagem "Conta inativa" quando `is_public = 0`.
- `views/admin/events/activity-attendance.ejs`: removidos o badge "Conta inativa", a nota "Presença bloqueada — conta inativa" e o CSS associado (ramos inacessíveis após o filtro na query).
- `views/admin/events/participants.ejs`: botão "Imprimir crachá" passa a exigir `account_active`; o badge "Conta inativa" permanece — é a visão de gestão onde a reativação ocorre.
- Regras de backend mantidas (sem mudança): marcação manual e scan do crachá rejeitam conta inativa via `applyAttendanceMark`; "Marcar presença (todos)" continua ignorando inativos; "Desmarcar (todos)" continua permitindo correção; histórico (inscrições, presenças registradas, elegibilidade) preservado.
- Validação E2E (17/08, sandbox isolada na porta 3100 + backup do banco real): **22/22 checks** — chamada lista somente contas ativas (usuários inativos pré-existentes e o usuário testado somem ao inativar e voltam ao reativar); PDF da lista inclui/exclui o e-mail conforme o estado (verificação por decodificação dos glifos hex do PDFKit); crachá 400 inativo / 200 PDF ativo; marcação manual e scan do crachá rejeitados; lote "Marcar (todos)" ignora inativo sem criar registro; listagem de participantes mantém o badge e oculta/exibe o botão "Imprimir crachá" conforme o estado.
- Status: **implementado e validado** (efetiva após reinício do servidor em produção).

### Logo do evento no relatório do evento

- Requisito do usuário (17/08): o relatório em `/admin/reports?eventId=` deve incluir o logo do evento.
- `views/admin/reports/list.ejs`:
  - Cabeçalho de impressão (`print-only`, usado pelo "Imprimir em PDF"): `<img>` do logo acima do título, somente quando `event.logo_path` existe.
  - Cabeçalho da tela (`page-header`): logo ao lado do título, com o mesmo tratamento condicional.
  - CSS `.report-logo` (tela) e `.report-logo-print` (impressão): `object-fit: contain`, fundo branco e cantos arredondados, no padrão das páginas públicas.
- Sem mudança de rota: `routes/reports.js` já passa o `event` completo ao template e o arquivo é servido pela estática `/uploads/event-logos/` (`server.js`).
- Validação E2E (17/08, sandbox isolada na porta 3101 + backup do banco real): **7/7 checks** — relatório 200 com `<img>` no cabeçalho da tela e no de impressão, arquivo do logo servido (200 image/jpeg), evento sem logo não renderiza a tag e seções do relatório intactas.
- Status: **implementado e validado** (efetiva após reinício do servidor).

### Correção: logo (e título) duplicados no PDF do relatório

- Relatório do usuário (17/08): com o logo adicionado, o PDF imprimível exibia o logo duas vezes — o cabeçalho de tela (`.page-header`, que já continha o segundo logo) não era ocultado na impressão, duplicando também o título.
- `views/admin/reports/list.ejs`: `@media print` passa a ocultar `.page-header` (junto a topbar, `.no-print`, footer e `.report-selection`). Na tela o cabeçalho permanece; no PDF o único cabeçalho é o `print-only` (logo + "Evento — Relatório do Evento" + "Gerado em"). Nada se perde: a seção "Informações do Evento" já traz nome, localização, período, área e website.
- Status: **corrigido** (CSS de impressão; efetiva após reinício do servidor).

## 2026-08-16

### Atividades: intervalo de datas e etapas (presença por etapa)

- Requisito do usuário: (a) manter os 7 tipos de atividade; (b) trocar a data única por **início e fim**; (c) permitir dividir a atividade em **etapas** (ex.: minicurso com 4 aulas, seminário com 4 períodos), com presença por etapa.
- Decisões alinhadas: carga horária **por etapa** (o certificado soma as cargas das etapas presentes); cada etapa tem **data própria** (validada contra o intervalo da atividade); o certificado **não exibe fração de etapas** (apenas os nomes das atividades).
- Schema (`services/db-reset.js`):
  - `event_activities` ganha `date_start`/`date_end` (migração idempotente faz backfill de `activity_date` → `date_start`; a coluna legada é mantida).
  - Nova tabela `activity_sessions` (`activity_id`, `name`, `sequence_no`, `session_date`, `workload_hours`, FK com `ON DELETE CASCADE`).
  - `activity_attendance_records` ganha `session_id` (reconstrução da tabela com FK `ON DELETE CASCADE` para `activity_sessions`) + índices parciais únicos: `(activity_id,user_id)` para `session_id IS NULL` e `(activity_id,session_id,user_id)` para etapas.
- `routes/events.js`:
  - Helpers `getActivitySessions`, `resolveSession`, `sessionDateError`, `activityDateRangeError`.
  - CRUD de atividades passa a gravar `date_start`/`date_end` (valida fim >= início).
  - Novas rotas de etapas: `GET/POST .../sessions`, `POST .../sessions/:sessionId` (edição) e `POST .../sessions/:sessionId/delete` (com `strictLimiter`; data fora do intervalo é rejeitada).
  - Chamada (`GET .../attendance`) lista as etapas como abas e mostra presença da etapa selecionada; `POST .../attendance/:userId` e `POST .../attendance-bulk` operam por `session_id` (nulo quando a atividade não tem etapas) e redirecionam preservando `?session_id=`.
  - Impressão (`GET .../attendance-print?session_id=`): título com nome da etapa e data da etapa (ou intervalo da atividade quando sem etapas).
  - `getRoleActivityAttendance`: para atividades com etapas, a carga horária efetiva é a soma das cargas das etapas presentes (`session_id` não nulo); sem etapas, usa `event_activities.workload_hours`. A elegibilidade (`min_attendance`) continua contando **atividades** presentes.
- `routes/public.js`, `routes/reports.js`, `db.js`: queries passam a usar `date_start`/`date_end`; contadores de presentes passam a `COUNT(DISTINCT user_id)` (evita duplicar pessoas com presença em várias etapas).
- `server.js`: helpers globais `formatBRDate` e `activityDateRange` (intervalo "dd/mm/aaaa a dd/mm/aaaa") via `res.locals`.
- Views:
  - `views/admin/events/activities.ejs`: form com duas datas; lista mostra intervalo, carga (soma das etapas quando houver, marcada com "(etapas)") e link "Etapas (n)".
  - `views/admin/events/activity-sessions.ejs` (nova): lista de etapas (ordem, nome, data, carga), adicionar/editar etapa e remover (com confirmação).
  - `views/admin/events/activity-attendance.ejs`: abas de etapa, campos hidden `session_id` nos forms individual e em lote, link de impressão por etapa.
  - `certificates.ejs`, `participant-form.ejs`, `event-register.ejs`, `event-activities.ejs`, `reports/list.ejs`: exibem o intervalo via `activityDateRange`.
- Verificação:
  - Migração em banco antigo simulado: backfill de data, presença legada preservada com `session_id` nulo, etapas + presenças por etapa, cascata na remoção da etapa, idempotência.
  - E2E HTTP em sandbox (cópia do projeto + banco real): login admin; lista com intervalo e botão Etapas; criação de atividade com datas; criação de etapa; rejeição de etapa fora do intervalo; presença individual e em lote por etapa; PDF da lista por etapa (cabeçalho com etapa/data); carga horária do certificado = soma das etapas presentes (2h de 4h); página de chamada com abas; atividade sem etapas continua sem `session_id`; relatório e página pública de inscrição exibem o intervalo.
  - Status: **implementado e validado**. A migração é aplicada automaticamente no próximo start do servidor (banco atual migra na inicialização).

### Esquema de backup e restauração (super-admin)

- Motivação: o sistema é desenvolvido em três máquinas diferentes; o backup permite sincronizar o estado completo (banco + arquivos enviados) entre elas.
- `services/backup.js` (novo):
  - `createBackupZip(destPath)`: snapshot consistente do banco via `VACUUM INTO` (não bloqueia nem altera o banco em uso) + pasta `uploads/` completa + `BACKUP_META.json` (versão, data UTC-3, node, plataforma, tamanhos) empacotados em ZIP via `ZipArchive` (mesmo padrão dos downloads de artigos/certificados).
  - `restoreFromZip(zipPath)`: validações em camadas — ZIP válido (`adm-zip`), proteção contra path traversal (`..`/caminhos absolutos), presença de `artigos.db` na raiz, `integrity_check` ok e tabelas principais (`users`, `events`) no banco do backup. Antes de substituir, faz `wal_checkpoint(TRUNCATE)`, copia o banco atual (com WAL) como cópia de segurança (`artigos.db.pre-restore`), fecha as conexões em cache, substitui os arquivos, reabre a conexão com `journal_mode=WAL`/`foreign_keys=ON`, aplica `initializeDbSchema` (migrações idempotentes + seed do admin) e substitui `uploads/` pelo conteúdo do backup. Em qualquer falha após a troca, rola o banco de volta a partir da cópia de segurança e reabre a conexão para o servidor continuar funcionando. A cópia de segurança é removida após o sucesso.
- `routes/auth.js`:
  - `GET /admin/backup/download` (`requireAuth` + `requireSuperAdmin`): gera o ZIP em disco temporário e envia como download `artigos-backup-AAAA-MM-DD_HH-mm-ss.zip`.
  - `GET /admin/backup/restore` (`requireAuth` + `requireSuperAdmin`): página de confirmação com upload.
  - `POST /admin/backup/restore` (`requireAuth` + `requireSuperAdmin` + `strictLimiter` + `multer` com limite de 500 MB, arquivo em disco temporário): exige campo de confirmação `RESTAURAR`, valida extensão `.zip`, executa a restauração e redireciona para `/admin/dashboard?restore=success` ou de volta à página de confirmação com a mensagem de erro.
- `views/admin/dashboard.ejs`: nova seção "Backup e Restauração" visível apenas para `admin@admin.com`, com botões "Baixar Backup" (verde), "Restaurar Backup" (âmbar) e "Resetar Banco de Dados" (vermelho), além de banners de sucesso/falha (`?restore=success`).
- `views/admin/backup-restore.ejs` (novo): página de confirmação no mesmo padrão da de reset — upload de ZIP obrigatório, campo de texto `RESTAURAR` para habilitar o botão, bloqueio de Enter e CSRF por campo hidden.
- `package.json`: nova dependência `adm-zip` (extração do ZIP na restauração).
- Verificação:
  - Backup em banco real: ZIP com `artigos.db` + `BACKUP_META.json` + `uploads/`; `integrity_check` ok no banco extraído; contagens idênticas ao banco em uso; banco live inalterado (hash SHA-256 antes/depois).
  - Restauração em sandbox isolado (cópias de banco/serviços): sucesso substitui banco e uploads (arquivo-teste removido), cópia de segurança limpa; falhas tratadas com rollback e banco íntegro — ZIP corrompido ("file is not a database"), ZIP sem banco e arquivo que não é ZIP.
  - Status: **implementado e validado** (backup + restauração no nível de serviço; rotas HTTP com a mesma cadeia `requireAuth` + `requireSuperAdmin` do reset de banco).

### Correção: conexão obsoleta após restore/reset (proxy estável no db.js)

- Bug: as rotas capturam a conexão no carregamento do módulo (`const { db } = require('../db')`). O restore (e o reset) fechavam a conexão e trocavam `exports.db` por uma nova, mas as referências desestruturadas nas rotas continuavam apontando para a conexão fechada — qualquer requisição subsequente quebrava com `TypeError: The database connection is not open` (ex.: `requireOnboarding`).
- Correção: `db.js` agora exporta `db` como um Proxy estável que sempre encaminha métodos/propriedades para a conexão atual, além do setter `setDb(connection)`. `services/backup.js` (sucesso e rollback do restore) e `services/db-reset.js` (`resetDatabase`) passam a trocar a conexão via `setDb()`.
- Efeito: restore e reset deixam de exigir reinício do servidor — a conexão é trocada em runtime e o app continua servindo normalmente.
- Correção: `views/admin/backup-restore.ejs` — o input de confirmação não tinha `name="confirm"`, então o valor nunca chegava ao servidor e a restauração falhava com "Texto de confirmação inválido".
- Status: **corrigido e validado** (teste simulando a troca de conexão com a referência desestruturada do módulo: queries passam a atingir a nova conexão).

### Correção: lista de presença por etapa na página de atividades

- Bug: o botão "Imp. Lista Presença" de `/admin/events/:id/activities` apontava para `attendance-print` sem `session_id`; a rota usa `sessions[0]` como fallback, então atividades com etapas sempre imprimiam a lista da **primeira** etapa.
- `routes/events.js` (GET `/:id/activities`): atividades com etapas passam a receber `activity.sessions` (via `getActivitySessions`) no render.
- `views/admin/events/activities.ejs`: para atividades com etapas, um botão "Imp. Lista · <nome da etapa>" por etapa (link `attendance-print?session_id=<id>`); atividades sem etapas mantêm o botão único original. `.item-actions` ganhou `flex-wrap:wrap` para acomodar os botões.
- Verificação E2E em sandbox (cópia do projeto + banco real): minicurso com 5 etapas renderiza 5 links de impressão (um por etapa) e o PDF por etapa responde 200 com `filename="lista-presenca-Minicurso 1 — Aula 1.pdf"`.
- Status: **corrigido e validado**.

### Cor do certificado: paleta de 64 cores no lugar do picker nativo

- O campo "Cor" da configuração de certificados usava `<input type="color">`; o picker nativo varia por navegador e, no Chrome, é considerado complexo demais para a operação.
- `views/admin/events/certificates.ejs`: substituído por paleta embutida de **64 cores** (grade 8x8) que abre ao clicar no botão com a amostra da cor atual; cada form por papel tem sua própria paleta.
- O contrato do backend é inalterado: o campo enviado continua sendo o hidden `text_color` (classe `text-color`). Ao clicar num tom: define o valor do campo, atualiza a amostra do botão, marca o tom selecionado e dispara a prévia (`buildPreview`); clique fora fecha a paleta.
- Paleta com 64 hex: neutros (preto/cinza/branco), azuis, ciano, púrpuras/magenta, vermelhos/rosa, laranja/marrom/dourado, amarelos, verdes e teais; inclui o padrão `#0f172a`. Cores salvas fora da paleta continuam exibidas na amostra sem marcar nenhum tom.
- Status: **implementado e validado pelo usuário**.

### Certificados: presença mínima por percentual e qualificação por tipo de atividade

- Mudança de regra pedida pelo usuário: o campo "Presenças mínimas" (contagem absoluta) foi trocado por "Presença mínima (%)" (inteiro 0-100), e a elegibilidade passou a ser calculada **atividade a atividade** por tipo:
  - Apresentação pôster, apresentação oral e mesa-redonda: qualquer presença qualificada a atividade (e o certificado).
  - Palestra, seminário, minicurso e outra: a atividade qualifica somente se as etapas presentes forem >= `ceil(etapas totais x percentual / 100)`; atividade sem etapas qualifica com qualquer presença.
  - A pessoa é elegível no papel quando possui ao menos uma atividade qualificada (participante continua exigindo inscrição na atividade). Somente atividades qualificadas entram no certificado e na carga horária. Revisor inalterado (ao menos um parecer).
- `routes/events.js`:
  - `getCertificateRule`: default de `min_attendance` passou de `1` para `75`.
  - Novo `ANY_ATTENDANCE_CERTIFICATE_TYPES` (`oral_presentation`, `poster_presentation`, `roundtable`) e `certificateActivityQualifies(activity, minPercent)`.
  - Novo `qualifyCertificateAttendance(attendance, minPercent)`: filtra `attended_activities` pelas atividades qualificadas e recalcula `attendance_count`, `total_workload_hours`, `total_attended` e `eligible` (>= 1 atividade qualificada). `getCertificateCandidates` usa o resultado para participante e demais papéis (revisor mantém elegibilidade por parecer).
  - POST `/:id/certificates/rule`: `min_attendance` normalizado com clamp 0-100 (antes `Math.max(1, ...)`).
  - `apply-to-all`: inserção para papéis sem regra usa `75` (revisor `0`).
- `security/validation.js`: `min_attendance` validado como inteiro 0-100 ("Presença mínima deve ser um inteiro entre 0 e 100.").
- `views/admin/events/certificates.ejs`: label "Presença mínima (%)" com `min=0 max=100 step=1`; hint de elegibilidade descreve a regra por tipo; coluna "Atuação comprovada" passa a exibir "X de Y atividade(s)" (qualificadas de presentes).
- `services/db-reset.js`: `event_certificate_rules.min_attendance` com `DEFAULT 75 CHECK(min_attendance >= 0 AND min_attendance <= 100)`.
- Migração de dados em `artigos.db`: regras existentes do evento 1 (valor absoluto `1`) atualizadas para `75` (revisor `0`), já que o mesmo número agora é lido como percentual.
- Verificação E2E em sandbox (cópia do projeto + banco real, porta 3001): evento de teste com minicurso 3/4 etapas (75%), minicurso 2/4 (50%), mesa-redonda presente, pôster presente (como apresentador pôster) e palestra 1/2 (50%). Com 75%: participante "2 de 4 atividades" elegível; com 50%: "4 de 4"; com 100%: "1 de 4" (só a mesa-redonda) e ainda elegível; com 0%: "4 de 4"; pôster "1 de 1" elegível; `min_attendance=150` clampado para 100; emissão de certificado e download do PDF ok (14/14 verificações).
- Status: **implementado e validado**.

### Presença por QR Code (folha impressa + registro pelo celular)

- Requisito do usuário: para cada etapa (ou atividade sem etapas), imprimir uma folha letter com o evento, a atividade, a data, a etapa e um QR Code 2D com essas informações; o objetivo é o usuário ler o código e marcar a própria presença naquela etapa.
- Decisões alinhadas: (1) o QR codifica o **link direto** da página de presença (`<origem>/presenca/<eventId>/<activityId>/<sessionId>`); (2) a origem vem do campo **"URL do Evento"** (apenas a origem da URL; campo vazio → host de quem imprime); (3) só **inscritos, só no dia** — participante exige inscrição no evento + vínculo à atividade, e a marcação só é permitida na data da etapa (ou no período da atividade, sem etapas), em UTC-3; (4) **todos os papéis** podem se automarcar no papel que exercem (`participant`, `speaker`, `teacher`, `oral_presenter`, `poster_presenter`); revisor e admin não se automarcam.
- `package.json`: dependência `qrcode` (PNG via `toBuffer`).
- `routes/events.js`:
  - `GET /:id/activities/:activityId/checkin-print?session_id=` (admin do evento): PDF **LETTER** retrato "FOLHA DE PRESENÇA — QR CODE" com evento, atividade, data (data da etapa ou intervalo da atividade), etapa (quando houver) e QR Code centralizado (~220pt) com a instrução de uso. Atividade com etapas sem `session_id` → 400. A URL codificada é registrada em log apenas na cópia de teste (validação E2E); o código do projeto não contém debug.
- `views/admin/events/activities.ejs`: botão "QR Presença · <etapa>" por etapa e botão "QR Presença" para atividades sem etapas, ao lado dos botões de lista de presença.
- `routes/auth.js`: login com retorno pós-login — `safeAfterLoginPath` aceita somente caminhos iniciados por `/presenca/` (sem `//`, sem NUL, ≤ 200 chars); `GET /login?next=` guarda em `req.session.afterLoginPath` e `POST /login` redireciona para lá após login válido (sem `next` → destino padrão).
- `routes/public.js`:
  - Helpers `getCheckinContext`, `getCheckinMarkableRoles`, `canMarkCheckinRole`, `defaultCheckinRole`, `getCheckinWindow`, `isWithinCheckinWindow`, `getCheckinRecord`.
  - `GET /presenca/:eventId/:activityId` e `GET /presenca/:eventId/:activityId/:sessionId`: não autenticado → redirect `/login?next=...`; atividade com etapas sem etapa indicada → 400; evento/atividade/etapa inexistentes → 404; senão renderiza `views/public/checkin.ejs` com dados, papéis marcáveis do usuário e estados (dentro/fora do período, presença já registrada).
  - `POST` nas mesmas rotas (`strictLimiter`): valida o papel (`participant` exige inscrição + vínculo; papéis especiais exigem `event_user_roles`), o período (UTC-3) e grava/atualiza `activity_attendance_records` — idempotente por atividade + pessoa + etapa, `marked_by` = o próprio usuário, `registration_id` = inscrição do evento (nulo quando ausente), `attended_at` em UTC-3 → redirect `?marked=1` com mensagem de sucesso. O registro é o mesmo da chamada administrativa e alimenta carga horária e elegibilidade de certificados sem mudança de regra.
- `views/public/checkin.ejs` (nova): página mobile-first no padrão topbar/Inter do site, com evento/atividade/data/etapa, seletor do papel exercido, botão "Marcar presença" e estados de erro/sucesso (fora do período, sem vínculo, já registrado).
- Verificação E2E em sandbox (cópia do projeto + banco real, porta 3001): login admin; botões "QR Presença" por etapa e sem etapas na listagem; PDF 200 (`%PDF`, imagem embutida do QR, `filename="presenca-qr-*.pdf"`); URL codificada validada ponta a ponta = origem de "URL do Evento" + `/presenca/...` (com e sem etapa); etapa ausente → 400; etapa futura imprimível (restrição vale só para a marcação); anônimo → `/login?next=` e login retorna à página; marcação de participante (registro com `session_id`, `marked_by`, `registration_id`), remarcacao idempotente (1 registro); marcação de palestrante (atividade sem etapa, sem vínculo à atividade, com inscrição no evento); papel sem permissão e participante sem vínculo rejeitados; fora do período rejeitado; evento inexistente 404; `next=/admin` bloqueado pela guarda (34/34 verificações).
- Status: **implementado e validado**.

### Estabilidade em produção: trust proxy do nginx, shutdown limpo e proteção dos PDFs

- Problema em produção (`ham.eng.br`, nginx): o app entrava em ciclo de quedas (pm2 com ↺168 reinicializações), com 502 Bad Gateway intermitente para o usuário.
- Causa 1 (misconfiguração): o nginx adiciona o header `X-Forwarded-For`, mas o Express rodava sem `trust proxy` — o `express-rate-limit` lançava `ValidationError: ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` em **toda** requisição (e o rate limiting contava pelo IP do proxy, não do cliente real).
- Causa 2 (queda): ao término anormal do processo, o teardown do `better-sqlite3` disparava assertion nativa (`Assertion failed: (env) != nullptr` em `Statement::~Statement`), encerrando sem limpeza e mascarando o erro real.
- Correções:
  - `server.js`: `app.set('trust proxy', 1)` (o app roda atrás do nginx) — elimina a ValidationError e faz o rate limiting usar o IP real do cliente.
  - `server.js`: handlers `SIGINT`/`SIGTERM` fecham o banco (`db.close()`) antes de `process.exit(0)` — shutdown limpo, sem a assertion nativa (também na reinicialização pelo pm2).
  - `server.js`: handler `uncaughtException` loga o erro completo e, após fechar o banco, faz `process.exit(1)` — o pm2 reinicia o processo e o log registra o erro real que derrubou o app.
  - `routes/events.js` (`attendance-print` e `checkin-print`): `doc.on('error')` no stream do PDF (cliente desconectando no meio da geração não derruba mais o processo) + guarda de interrupção após `await QRCode.toBuffer` no checkin-print.
- Verificação (local): syntax check ok; servidor local com header `X-Forwarded-For` → respostas 200 com 0 ValidationErrors; padrão de fechar o banco antes de sair sem assertion nativa.
- Status: **corrigido e pendente de validação em produção** (`git pull` + `pm2 restart artigo`).

## 2026-08-14

### Fase 0 (ajuste): "Não possui curso de graduação" em todas as áreas e ocultação de Titulação/Status

- Ajuste pedido pelo usuário após a entrega da Fase 0: a opção especial deve existir em **todas** as áreas de formação (antes só apareceria em "Outros") e, quando selecionada, os campos Titulação e Status devem ficar ocultos (sem sentido sem graduação).
- `services/academic-formation.js`: `getCursosByArea` agora prepende `NO_DEGREE_COURSE` para qualquer área (removida a restrição à área `11`).
- `routes/auth.js` (`validateCompleteProfile` + `normalizeFormacaoForStorage`): quando `formacao_curso === NO_DEGREE_COURSE`, titulação/status deixam de ser obrigatórios e são limpos para `''` antes do bind (gravados como `null`).
- `routes/public.js` (`validateParticipantFormacao` + POST `/author/profile`): mesma regra — validação condicional e limpeza dos campos antes da persistência.
- Templates (wrapper `#formacao-titulacao-status` + `hidden`/`display:none` + JS `syncTitulacaoVisibility`):
  - `views/admin/users/form.ejs`
  - `views/complete-profile.ejs` (inclui remoção dinâmica de `required` no select de curso)
  - `views/public/participant-profile.ejs`
  - `views/admin/events/participant-form.ejs` (usa `style.display` por causa do `display:grid` inline)
- Handlers de persistência (`routes/users.js` create + `updateUser`, `routes/events.js` `updateParticipant`): bind condicional `formacao_curso === NO_DEGREE_COURSE ? null : (formacao_titulacao || null)` (idem para `formacao_status`). Todos os renders passaram a receber `noDegreeCourse: NO_DEGREE_COURSE`.
- `routes/users.js`: referência residual de `getCursosByArea` no branch de CPF inválido do `updateUser` substituída por `getCursosMap()`.
- Observação: o fluxo de **criação** de participante (`POST /:id/participants`) não grava formacao no user (a seção só existe no fluxo de edição com conta vinculada), portanto não havia risco de sobrescrita nesse caminho.
- Status: código completo e com sintaxe validada; validação funcional ponta a ponta ainda pendente.

### Correção: ReferenceError em error.ejs

- Bug pré-existente detectado durante a verificação da Fase 0: `views/error.ejs:23` usava `<%= message || '' %>`. Quando a rota de erro não passa `message` via `locals`, o EJS tenta resolver `message` como escopo global e lança `ReferenceError: message is not defined`, quebrando ~20+ rotas de erro (incluindo as 404).
- Correção: `<%= locals.message || '' %>`.
- Impacto: páginas de erro (404/500) passam a renderizar normalmente com mensagem vazia quando ausente.

### Fase 0.4: status `encerrado` para eventos

- Decisão do usuário: evento encerrado usa status **`encerrado`** explícito (não reutilizar `draft`/`published`). `events.status` é TEXT sem CHECK constraint, então não foi necessária migração.
- `routes/events.js`:
  - `EVENT_STATUSES = ['draft', 'published', 'encerrado']` e helper `normalizeEventStatus` (valor ausente/inválido → `draft`); aplicado em criação e edição.
  - `POST /:id/close` (com `strictLimiter`): muda `published` → `encerrado` com `updated_at` em UTC-3.
- `routes/public.js`:
  - Home (`/`) continua exibindo apenas `published`.
  - `/evento/:id` e `/evento/:id/certificates` aceitam `status IN ('published', 'encerrado')`; a página do evento passa `isClosed` ao template.
  - `/evento/:id/inscricao` e `/submeter/:eventId` continuam exigindo `published` → encerrados retornam 404.
  - `buildEventTimeline` remove as ações de inscrição/submissão quando o evento está encerrado.
- Templates:
  - `views/admin/events/form.ejs`: select de status com 3 opções.
  - `views/admin/events/list.ejs`: badge âmbar `badge-encerrado` + botão "Encerrar" (formulário POST com CSRF) para eventos `published`.
  - `views/public/event.ejs`: bloco `.closed-notice` quando `event.status === 'encerrado'`.
- Verificado via curl: publicar → evento visível na home → encerrar → sai da home; `inscricao`/`submeter` = 404; `certificates` = 200.

### Fase 0.3: opção "Não possui curso de graduação" (base)

- `services/academic-formation.js`:
  - Constante exportada `NO_DEGREE_COURSE = 'Não possui curso de graduação'`.
  - `getCursosByArea` insere a opção especial no início da lista de cursos da área (sem duplicar).
  - `getCursosMap` mantém o mapa área → cursos já enriquecidos.
- Deduplicação: `routes/users.js` e `routes/events.js` deixaram de ter funções locais `getAreas`/`getCursosByArea` duplicadas e agora importam do serviço (`getAreas`, `getCursosByArea`, `getCursosMap`).
- A opção passou a aparecer nos selects de curso de: criação/edição de usuário (`/admin/users`), completion de perfil (`/login/complete-profile`), perfil do participante (`/author/profile`) e edição de participante (`/admin/events/:id/participants`).

### Fase 0.2: perfil do participante em `/author/profile`

- `security/validation.js`: validador `participantProfile` (nome, e-mail, instituição, CPF, passaporte, país, telefone, formação acadêmica, senhas opcionais com regra de 8+ caracteres e maiúscula/minúscula/número).
- `routes/public.js`:
  - `GET /author/profile`: carrega usuário da sessão e renderiza `renderParticipantProfile` com dados atuais + mapa de cursos.
  - `POST /author/profile` (com `registrationLimiter`): valida via `validateAndHandle` + regras server-side (nome/e-mail obrigatórios, CPF válido, `validateParticipantFormacao`, unicidade de e-mail), troca de senha opcional (confere senha atual com `bcrypt.compareSync`, exige confirmação, grava `password_changed = 1`), atualiza `users` (inclui `phone`) e atualiza a sessão (`userName`, `userEmail`, `userInstitution`).
  - Helpers `normalizeParticipantProfileForm`, `renderParticipantProfile` e `validateParticipantFormacao` centralizados no arquivo.
- `views/public/participant-profile.ejs`: seção de dados cadastrais (com telefone), seção de formação acadêmica (área → curso em cascata via `cursosMap`) e seção "Trocar senha" opcional; mensagens de sucesso/erro.
- Verificado via curl: campos renderizam com os valores salvos, POST salva telefone/formação, troca de senha funciona (login posterior com a nova senha OK).

### Fase 0.1: novos contadores no dashboard

- `routes/auth.js` (GET `/admin/dashboard`):
  - `brToday`: data de hoje em UTC-3 (mesma base dos timestamps do sistema).
  - `totalUsers`: `COUNT(*)` de `users`.
  - `concludedEvents`: eventos com `date_end` não nulo e anterior a `brToday`.
  - `futureRegistrations`: registros em `event_registrations` de eventos com `date_start >= brToday`.
  - Valores incluídos no `res.render` do dashboard.
- `views/admin/dashboard.ejs`: cards "Total de Usuários", "Eventos Realizados" e "Inscritos em Eventos Futuros" com CSS próprio (classes dedicadas).
- Verificado via curl com dados de teste: contadores corretos (ex.: 5 usuários, 1 evento realizado, 1 inscrito em evento futuro).

### Plano de evolução aprovado em `plano.md`

- Criado o arquivo `plano.md` com o plano aprovado pelo usuário em 4 ciclos sequenciais:
  1. **Ciclo 1 — Fase 0 (Quick Wins)**: 0.1 contadores do dashboard, 0.2 `/author/profile`, 0.3 "Não possui curso de graduação", 0.4 status `encerrado`.
  2. **Ciclo 2 — Fase 1 (Aulas + QR Code)**: tabela `activity_sessions`, `min_sessions` em eventos, `session_id` nas presenças, CRUD de aulas, chamada por aula, PDF de lista por aula, QR impresso, `/presenca-qr` (câmera + jsQR local + digitação manual), auto-check-in + proxy por admin, integração com elegibilidade/carga horária.
  3. **Ciclo 3 — Fase 2 (Auditoria)**: trilha de auditoria das operações relevantes.
  4. **Ciclo 4 — Fase 3 (E-mails)**: módulo de e-mails (`nodemailer`), SMTP, templates e gatilhos.
- Decisões registradas no plano: presença por aula (sem flag presencial/remoto), QR exige HTTPS, status `encerrado` explícito, opção de formação sem graduação em todas as áreas com ocultação de titulação/status, módulos novos apenas e-mails.

### Correção: rate limiter de login

- O rate limiter em `security/rate-limits.js` usa `MemoryStore` em memória — os contadores são resetados ao reiniciar o servidor.
- Para desbloquear após muitas tentativas:
  ```bash
  kill $(lsof -t -i:3000) 2>/dev/null
  node server.js
  ```
- Configuração atual: 10 tentativas a cada 15 minutos na rota `/login`.
- Mensagem de erro: "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente."

### Correção: login após reinício do servidor

- Após reiniciar o servidor (após reset do banco ou outros eventos), o rate limiter é resetado automaticamente.
- O admin `admin@admin.com` é recriado com senha `123456` e `password_changed = 0`.
- Login exige troca de senha obrigatória no primeiro acesso (`/login/change-password`).
- Arquivo afetado: `services/db-reset.js` (resetDatabase), `security/rate-limits.js`.

### Reset de banco de dados

- Nova funcionalidade de reset total do banco de dados em `/admin/db/reset`, acessível **exclusivamente** para `admin@admin.com` (super administrador).
- Função `resetDatabase()` em `services/db-reset.js`:
  1. Apaga todos os arquivos de upload (`uploads/`): artigos, certificados emitidos, fundos personalizados, documentos de subsídio, importações.
  2. Remove o arquivo do banco SQLite (`artigos.db`, `.db-shm`, `.db-wal`).
  3. Cria novo banco do zero, reconstruindo schema, indexes, triggers e seed do administrador padrão (`admin@admin.com` com senha `123456`, `password_changed=0`).
  4. Atualiza a conexão do `db` no cache do `require` para que o servidor continue funcionando sem reinício.
- Middleware `requireSuperAdmin` em `security/super-admin.js`:
  - Verifica se `req.session.userEmail === 'admin@admin.com'`.
  - Retorna 403 com mensagem "Acesso negado" para outros usuários.
  - Aplicado às rotas `GET` e `POST` de `/admin/db/reset`.
- Template `views/admin/db-reset-confirm.ejs`: página de confirmação com campo de texto que exige a palavra "RESET" para habilitar o botão de submit. Botão começa desabilitado. Enter é bloqueado. Validação no submit.
- Botão "Resetar Banco de Dados" visível apenas para `admin@admin.com` no dashboard. Mensagem de sucesso/erro exibida após o reset.
- `views/admin/events/form.ejs`: adicionado `<%- include("../../partials/csrf-inject") %>` para injetar token CSRF automaticamente. Resolve erro "token de segurança inválido" ao criar eventos.

### Correção: fluxo de aprovação de usuários

- Rota `POST /admin/users/:id/approve` em `routes/users.js:842-850` agora redefine `password_changed = 0` e `profile_completed = 0`.
- Fluxo corrigido: usuário aprova → `password_changed = 0` → login redireciona para `/login/change-password` → troca senha → redireciona para `/login/complete-profile` → completa perfil → dashboard.
- Antes disso, após aprovação o usuário ia direto para o painel sem trocar a senha.

### Correção: method-override

- Em `server.js`, `methodOverride('_method')` foi movido para **antes** do `express.urlencoded` (linha 48).
- Antes, o body parser era carregado primeiro e o `_method` não era reconhecido, causando erro `NOT NULL constraint failed` ao excluir usuários via formulário POST com `_method=DELETE`.
- Removidos campos duplicados de `_method=DELETE` dos formulários de exclusão em `views/admin/users/list.ejs` (linhas 194-195 e 333-334).

### Correção: atualização de usuário sem campo name

- Em `routes/users.js:updateUser`, adicionada linha `const displayName = name || user.name;` (linha 624).
- Se o formulário de edição não enviar o campo `name`, o valor existente do banco é preservado.
- Evita erro `SqliteError: NOT NULL constraint failed: users.name`.
- Atualizado em todas as 3 ocorrências do `UPDATE` (senha + sem senha) e no render de erro de CPF.

### Correção: formulário de cadastro público

- Em `routes/public.js:1841`, `validateAndHandle` agora recebe `[...v.registration, ...]` (spread operator) em vez de `[v.registration, ...]`.
- `v.registration` é um array de validadores; passá-lo como elemento único causava `TypeError: v.run is not a function`.
- O spread operator expande cada validador individualmente para que `validateAndHandle` chame `.run()` corretamente em cada um.

### Correção: validateAndHandle com catch

- Em `security/validation.js:15-27`, `validateAndHandle` agora inclui `.catch()` após o `.then()`.
- Previne que Promise rejections não tratadas causem requisições penduradas.
- Em caso de erro, retorna 500 com mensagem "Erro interno de validação."

### Correção: handler unhandledRejection

- Adicionado handler global `process.on('unhandledRejection', ...)` em `server.js` (linha 134).
- Loga no console erros de Promise rejections não tratadas para debug.

### Correção: senha de admin

- Após reset, o admin `admin@admin.com` é criado com senha `123456` e `password_changed = 0`.
- Login exige troca de senha no primeiro acesso (fluxo obrigatório).

## 2026-08-13

### PDF da lista de presença por atividade

- Reestruturado o cabeçalho do PDF gerado pela rota `GET /:id/activities/:activityId/attendance-print`:
  - 1ª linha: nome do evento (fonte 18)
  - 2ª linha: nome da atividade (fonte 14)
  - 3ª linha: data no formato DD-MM-AAAA (fonte 11)
- Função `formatBRDate` converte strings de data para o padrão brasileiro.
- Arquivos afetados: `routes/events.js`.
- Status: **implementado e validado**.

### Botões de presença em lote na chamada de atividade

- Adicionado botão verde **"Marcar presença (todos)"** no cabeçalho do card "Vincular participantes e papéis" em `/admin/events/:id/activities/:activityId/attendance`.
- Adicionado botão vermelho **"Desmarcar presença (todos)"** ao lado do botão de marcar.
- Nova rota `POST /:id/activities/:activityId/attendance-bulk` processa `bulk_action` (`mark_all_present` ou `unmark_all_present`).
- Ao marcar, usa o papel mais prioritário configurado na atividade (Professor > Palestrante > Apresentador Oral > Apresentador Pôster > Revisor > Participante).
- Ao desmarcar, remove todos os registros de presença da atividade.
- Ignora automaticamente o usuário `admin@admin.com`.
- Registra auditoria com flag `bulk: true`.
- Mensagem de retorno informa quantidade marcada/removida e ignorada.
- Arquivos afetados: `views/admin/events/activity-attendance.ejs`, `routes/events.js`.
- Status: **implementado e validado**.

### Correção: labels legíveis dos perfis elegíveis na chamada

- O cabeçalho da página de presença por atividade agora exibe labels legíveis ("Participante, Palestrante") em vez dos códigos internos ("participant, speaker").
- Usa o mesmo mapeamento `roleLabels` já existente no template.
- Arquivo afetado: `views/admin/events/activity-attendance.ejs`.
- Status: **corrigido e validado**.

### Remoção da página de presença geral por evento

- Removido botão "Presença" da listagem de eventos (`/admin/events`).
- Removido link "Presença" da página de participantes por evento (`/admin/events/:id/participants`).
- Eliminada a rota `GET /:id/attendance` e a rota `POST /:id/attendance/:userId` de `routes/events.js`.
- Eliminado o template `views/admin/events/attendance.ejs`.
- A presença é gerenciada exclusivamente por atividade em `/admin/events/:id/activities/:activityId/attendance`.
- Arquivos afetados: `views/admin/events/list.ejs`, `views/admin/events/participants.ejs`, `routes/events.js`, `views/admin/events/attendance.ejs` (removido).
- Status: **implementado e validado**.

### Correções e melhorias na listagem de participantes (`/admin/events/:id/participants`)

#### Contador corrigido com filtros aplicados

- O contador "Exibindo X-Y de Z participante(s)" agora exibe "0-0 de 0" quando nenhum participante é retornado pela combinação de filtros, em vez de "1-1 de N".
- Arquivo afetado: `views/admin/events/participants.ejs`.
- Status: **corrigido e validado**.

#### Correção do filtro "Instrutor"

- O filtro de categoria "Instrutor" usava `LEFT JOIN` com placeholders `IN (?, ?)` antes do `WHERE er.event_id = ?`, causando ordem incorreta dos parâmetros.
- Substituído por `EXISTS` (mesma abordagem usada no count), mantendo a ordem correta: `eventId`, `teacher`, `speaker`.
- Arquivo afetado: `routes/events.js` (função `getEventParticipantSummary`).
- Status: **corrigido e validado**.

#### Filtro de subsídio na listagem

- A função `getEventParticipantSummary` não aplicava o filtro `subsidy_requested`, causando inconsistência entre o count (correto) e a listagem (sem filtro).
- Adicionada condição `er.subsidy_requested = 1` nas três funções de consulta.
- Arquivo afetado: `routes/events.js`.
- Status: **corrigido e validado**.

#### Coluna "TIPO" com múltiplos papéis

- A coluna "TIPO" agora exibe todos os atributos do participante: "Com artigo" (quando `registration_type === 'author'`), "Instrutor" (quando há papel `teacher` ou `speaker` em `event_user_roles`) e "Participante" (fallback).
- Cada papel recebe um badge com cor distinta: azul para "Com artigo", roxo para "Instrutor" e cinza para "Participante".
- Query ampliada com subquery para detectar papel de instrutor: `CASE WHEN EXISTS(...) THEN 1 ELSE 0 END AS is_instructor`.
- Arquivos afetados: `routes/events.js`, `views/admin/events/participants.ejs`.
- Status: **implementado e validado**.

#### Cores por status de subsídio

- A coluna "SUBSÍDIO" agora usa cores diferentes: verde (`#86efac`) para "Subsídio aprovado", vermelho (`#fca5a5`) para "Subsídio reprovado" e amarelo (`#fcd34d`) para "Subsídio pendente".
- Adicionada classe CSS `.badge-rejected` para status reprovado.
- Arquivo afetado: `views/admin/events/participants.ejs`.
- Status: **corrigido e validado**.

#### Filtro de titulação como dropdown

- A titulação foi removida da busca livre e adicionada como filtro dropdown separado: "Todas", "Graduado", "Mestre", "Doutor" e "Não especificado" (para usuários sem `formacao_titulacao` ou com valor vazio).
- Filtro de texto livre agora busca por nome, e-mail, instituição e CPF (sem formatação).
- Arquivos afetados: `routes/events.js`, `views/admin/events/participants.ejs`.
- Status: **implementado e validado**.

#### Propagação automática de dados: users → event_registrations

- Criada trigger `trg_sync_user_to_event_registration` no `db.js` que propaga automaticamente `name`, `phone` e `institution` da tabela `users` para todas as `event_registrations` vinculadas pelo `user_id` quando houver atualização.
- Trigger só dispara quando pelo menos uma das colunas é alterada.
- Arquivo afetado: `db.js`.
- Status: **implementado e validado**.

### Correção: trigger com colunas inexistentes

- A trigger inicial tentava atualizar `cpf`, `passport` e `country` em `event_registrations`, mas essas colunas não existem na tabela.
- Trigger reescrita para propagar apenas `name`, `phone` e `institution` — as únicas colunas de dados compartilhadas entre `users` e `event_registrations`.
- Arquivo afetado: `db.js`.
- Status: **corrigido e validado**.

### Listagem de participantes: coluna "TIPO" com todos os papéis

- Substituída a lógica binária ("Com artigo" / "Instrutor" / "Participante") por exibição de todos os papéis do `event_user_roles` em badges coloridos.
- Query alterada: `is_instructor` substituído por `GROUP_CONCAT(eur.role, ',') AS roles` para listar todos os papéis (participant, admin, reviewer, speaker, teacher, oral_presenter, poster_presenter).
- Template atualizado para renderizar cada papel como badge: Participante (azul), Administrador (azul), Revisor (azul), Professor (roxo), Palestrante (laranja), Apresentador Oral (ciano), Apresentador Pôster (roxo claro).
- Arquivos afetados: `routes/events.js`, `views/admin/events/participants.ejs`.
- Status: **implementado e validado**.

### Impressão de lista de presença por atividade

- Novo botão "Imp. Lista Presença" adicionado na listagem de atividades (`/admin/events/:id/activities`), ao lado de "Marcar Presença".
- Nova rota `GET /:id/activities/:activityId/attendance-print` gera PDF em A4 paisagem com:
  - Título com nome da atividade
  - Dados do evento (nome, data, carga horária)
  - Tabela com colunas: Nome, E-mail, Assinatura (linha para assinatura)
  - Paginação automática conforme quantidade de inscritos
- Query unificada com `UNION ALL` para incluir participantes inscritos, papéis do `event_user_roles` e revisores atribuídos.
- Usuário `admin@admin.com` é excluído automaticamente da lista.
- Layout corrigido: colunas de cabeçalho alinhadas na mesma linha Y, com espaçamento adequado entre texto, linha separadora e primeira linha de dados (PDFKit `doc.text()` com Y explícito não altera `doc.y`, exigindo cálculo manual de offsets).
- Arquivos afetados: `routes/events.js`, `views/admin/events/activities.ejs`.
- Status: **implementado e validado**.

### Card "Atividades do Evento" no relatório administrativo

- Adicionada a seção "Atividades do Evento" na página de relatórios (`/admin/reports?eventId=:id`), posicionada após "Estatísticas do Evento".
- Quatro cards de estatísticas: total de atividades, inscrições vinculadas, presenças registradas, atividades certificáveis.
- Listagem de todas as atividades agrupadas por tipo de atividade (Palestra, Seminário, Mesa-redonda, Minicurso, Apresentação oral, Apresentação pôster, Outra), com badges de cor distintos e ordenação alfabética dentro de cada grupo.
- Cada card de atividade exibe: nome, data, carga horária, número de inscritos na atividade, número de presentes.
- Dados carregados no controller `routes/reports.js` e passados ao template `views/admin/reports/list.ejs`.
- Arquivos afetados: `routes/reports.js`, `views/admin/reports/list.ejs`.
- Status: **implementado e validado**.

### Coluna "PARTICIPAÇÃO" com todos os papéis do evento

- A coluna "PARTICIPAÇÃO" na tabela "Participantes do Evento" do relatório passou a exibir badges coloridos para todos os papéis em `event_user_roles` (Participante, Administrador, Revisor, Palestrante, Professor, Apresentador Oral, Apresentador Pôster), substituindo a lógica anterior que mostrava apenas "Participante".
- Query alterada com CTE `user_roles` que junta `GROUP_CONCAT(DISTINCT role)` de papéis por usuário.
- Template atualizado para renderizar badges apenas quando há roles; caso contrário, exibe o badge original de `participation_label`.
- Arquivos afetados: `routes/reports.js`, `views/admin/reports/list.ejs`.
- Status: **implementado e validado**.

## 2026-08-12

### Correções na importação de participantes — relatório e listagem de usuários

#### Mensagens de relatório sem ID do usuário

- As mensagens do relatório de importação ("Usuário criado", "Usuário criado e inscrito no evento") passaram a excluir o número do ID do usuário, que antes aparecia como "Usuário criado (ID: N)".
- Arquivos afetados: `routes/users.js` (linha 952), `routes/events.js` (linha 905).
- Status: **corrigido e validado**.

#### Botão de ocultar/mostrar relatório detalhado na importação

- Adicionado botão "Ocultar relatório" / "Mostrar relatório" na página de resultado da importação (`/admin/users/import/result` e `/admin/events/:id/import-users-result`).
- O botão alterna a visibilidade da tabela com JavaScript inline (`display: none/block`), evitando páginas gigantes quando o CSV possui centenas de linhas.
- O botão aparece no cabeçalho do card "Relatório detalhado", ao lado do título e da contagem de registros.
- Arquivos afetados: `views/admin/users/import-users-result.ejs`, `views/admin/events/import-users-result.ejs`.
- Status: **implementado e validado**.

#### Linhas brancas do CSV ignoradas silenciosamente

- Linhas totalmente vazias (sem nome, e-mail, instituição, telefone, CPF ou passaporte) são agora puladas silenciosamente, sem gerar entradas "Sem nome / (não informado) / Ignorado" no relatório.
- Linhas com dados parciais continuam aparecendo no relatório com status "Ignorado" e justificativa.
- Arquivos afetados: `routes/users.js`, `routes/events.js` (lógica de validação dentro do loop de processamento).
- Status: **implementado e validado**.

#### Paginação na listagem de usuários (`/admin/users`)

- Adicionada paginação aos usuários aprovados: 50 por página (padrão), com opção de 25, 50, 100 ou 200 registros.
- Usuários pendentes de aprovação continuam sem paginação (tipicamente poucos registros).
- Controles de paginação no topo do card "Gerenciar Usuários": contador "Exibindo X-Y de Z usuário(s)", botão "← Anterior", indicador "Página X de Y", botão "Próxima →" e seletor de registros por página.
- A paginação só aparece quando o total de usuários aprovados excede o limite configurado por página.
- Backend: query SQL com `LIMIT ? OFFSET ?` e contagem separada de pendentes vs. aprovados.
- Arquivos afetados: `routes/users.js` (rota `GET /`), `views/admin/users/list.ejs`.
- Status: **implementado e validado**.

#### Correção: seletor de registros por página

- O seletor de "por página" usava `&` no `onchange` do `<select>`, que foi interpretado como caractere especial HTML em vez de parâmetro de query. Corrigido para `&amp;`, garantindo que a URL gerada inclua corretamente `?page=1&per_page=N`.
- Arquivo afetado: `views/admin/users/list.ejs`.
- Status: **corrigido e validado**.

### Refatoração completa da importação de participantes

- **Parser CSV com auto-detecção de delimitador:** função `detectDelimiter` conta `;` vs `,` na primeira linha e usa o mais frequente, resolvendo problema com exports que usam ponto-e-vírgula (padrão brasileiro).
- **Correção crítica:** mapeamento de colunas normalizadas para nomes originais. `findCol` retornava nome normalizado (ex: `email`), mas `row` é indexado pelo nome original (ex: `E-mail`). Adicionado dicionário `normalizedToRaw` para converter.
- **Detecção de colunas mais robusta:** `findCol` agora tenta correspondência exata antes de substring, evitando falsos positivos. Candidatos expandidos para cobrir variações: `nomeparticipante`, `nomedoparticipante`, `correoeletronico`, `instituicaodetrabalho`, `celular`, `whatsapp`, `mobilephone`, etc.
- **Duas rotas de importação distintas:**
  - `/admin/events/:id/import-users` — cria/atualiza usuários **E inscreve no evento** como participante (listener)
  - `/admin/users/import` — cria/atualiza **apenas usuários** (sem inscrição em evento)
- **Relatório pessoa por pessoa:** ambas as importações agora geram tabela detalhada com Nome, E-mail, Status (Sucesso/Falha/Ignorado) e Detalhe explicativo.
- **Download do relatório em CSV via backend:** rotas `GET /admin/users/import/download-csv` e `GET /admin/events/:id/import-download-csv` geram arquivo CSV com BOM UTF-8, separador ponto-e-vírgula e filename com data. Dados mantidos na sessão para acesso após visualização do resultado.
- **Páginas de resultado em URLs separadas:** POST de importação redireciona para GET de resultado, separando URL de upload (`/import`) de URL de resultado (`/import-result` ou `/import/result`).
- **Modelo CSV para download:** rotas `GET /:id/import-template` (evento) e `GET /import-template` (usuários) geram arquivo vazio com cabeçalho pré-preenchido: `Nome completo;E-mail;Instituição;Telefone;CPF;Passaporte`.
- **Removidas referências ao Even3:** textos, mensagens de erro e templates atualizados para serem genéricos. Senha padrão alterada de `even3-import-2027` para `import-2027`.
- **Inscrição automática no evento:** importação via evento registra automaticamente em `event_registrations` (INSERT OR IGNORE). Usuários existentes são verificados para inscrição, novos usuários são criados e inscritos na mesma transação.
- **Botão "Importar lista":** adicionado em `/admin/users` (ao lado de "+ Novo Usuário") e em `/admin/events/:id/participants`.
- **Removidos logs de debug:** `console.log` de depuração removidos das rotas de importação em `routes/events.js`, mantendo apenas `console.error` para erros reais.
- **Uniformização de estilos de botões:** classes `.btn-primary` e `.btn-secondary` unificadas nas páginas de resultado com mesmas propriedades base (padding, border-radius, font-size, cursor, font-family, line-height), garantindo aparência idêntica entre `<a>` e `<button>`.
- Arquivos afetados: `routes/events.js` (parser CSV, rotas de importação, download CSV, templates), `routes/users.js` (nova função `parseImportCsvContent`, rotas de importação, download CSV), `views/admin/events/import-users.ejs`, `views/admin/events/import-users-result.ejs`, `views/admin/users/import-users.ejs`, `views/admin/users/import-users-result.ejs`, `views/admin/users/list.ejs`, `views/admin/events/participants.ejs`.
- Status: **implementado e validado**.

## 2026-08-11

### Formação acadêmica no formulário de edição do participante

- Adicionada a seção "Formação acadêmica" ao formulário de edição de participante (`/admin/events/:id/participants/:registrationId/edit`).
- A seção exibe os campos Área de Formação, Curso, Titulação e Status, carregados da conta vinculada do usuário (tabela `users`).
- O select de Curso é populado dinamicamente via JavaScript conforme a Área de Formação selecionada, utilizando os mesmos CSVs de referência (`assets/tabela_area.csv` e `assets/tabela_curso_graduacao.csv`).
- Ao salvar, os dados acadêmicos são persistidos na tabela `users` quando há conta vinculada (`user_id` não nulo).
- O telefone do participante agora é buscado da tabela `users` (`u.phone as user_phone`) e exibido no formulário; ao salvar, o telefone é atualizado simultaneamente nas tabelas `event_registrations` e `users`.
- Importação das funções `getAreas` e `getCursosByArea` adicionada a `routes/events.js` via `services/academic-formation.js`.
- Arquivos afetados: `routes/events.js` (importação, query, rota de edição, função de atualização, função de erro), `views/admin/events/participant-form.ejs` (nova seção de formação + script de cursos dinâmicos).
- Status: **implementado e validado**.

### Correções críticas de segurança e bugs

#### Correção: variáveis não definidas nas consultas por código

- As rotas `POST /consultar` e `POST /consultar-certificado` usavam variáveis inexistentes (`access_code` e `certificate_code`) no `.bind()`, causando `ReferenceError` em tempo de execução.
- Correção: ambas as rotas agora extraem o valor de `req.body` com `String()` e `.trim()` antes do `.bind()`.
- Arquivos afetados: `routes/public.js` (linhas 1757 e 1790).
- Status: **corrigido e validado**.

#### Correção: bypass CSRF em uploads multipart/form-data

- O middleware CSRF em `security/csrf.js` saltava a validação para toda requisição com `content-type` incluindo `multipart/form-data`, deixando todos os endpoints de upload (PDFs de artigos, fundos de certificado, importação CSV, documentos de subsídio) vulneráveis a CSRF.
- Correção: removida a exceção para multipart. O token CSRF agora é aceito por três vias: header `X-CSRF-Token`, campo hidden `_csrf` no body (formulários normais) ou cookie `csrf_token` (enviado automaticamente pelo navegador em uploads multipart). O middleware define o cookie `httpOnly` + `sameSite: lax` em todas as respostas. Função `getCookieValue` parseia o header `Cookie` sem dependência externa.
- Arquivos afetados: `security/csrf.js` (reescrita completa).
- Status: **corrigido e validado**.

#### Correção: risco de SQL Injection em bulk-update-flags

- A rota `POST /admin/users/bulk-update-flags` interpolava IDs de `req.body.user_ids` diretamente no SQL via template literal, sem sanitização numérica. Embora o validador `isInt` existisse, `validateAndHandle` continua para `next()` mesmo com erros de validação, permitindo que valores não numéricos chegassem à query.
- Correção: IDs agora são sanitizados com `parseInt()` e filtrados para inteiros positivos (`sanitizedIds`) antes de serem passados ao `.bind()`. Se nenhum ID válido for fornecido, a rota retorna erro 400.
- Arquivos afetados: `routes/users.js` (linhas 647-659, 714).
- Status: **corrigido e validado**.

#### Correção: senha padrão exposta na URL de redirect

- A rota `POST /admin/users/:id/reset-password` redirecionava com a mensagem `?success=Senha resetada para 123456`, expondo a senha padrão em logs do servidor, history do navegador e headers Referer.
- Correção: mensagem alterada para `?success=Senha+resetada+para+padrão`.
- Arquivo afetado: `routes/users.js` (linha 635).
- Status: **corrigido e validado**.

## 2026-08-10

### Perfil obrigatório no primeiro acesso

- Adicionada a coluna `profile_completed` à tabela `users`. A migração usa valor padrão `1` para preservar contas existentes; novas contas com senha temporária ou novo cadastro são criadas com valor `0`.
- O primeiro acesso passou a ter duas etapas obrigatórias: troca de senha em `/login/change-password` e preenchimento cadastral em `/login/complete-profile`.
- A nova etapa exige nome, instituição, telefone, país, CPF ou passaporte e formação acadêmica completa (área, curso, titulação e status).
- Adicionado middleware global que impede acesso direto às áreas administrativa, de revisão e de participante enquanto a senha ou o perfil estiverem pendentes.
- A seleção de curso é validada no servidor contra a área de formação e os CSVs de referência, além da validação de CPF e dos limites de tamanho.
- A listagem administrativa de usuários passou a mostrar separadamente os estados `Senha alterada/Trocar senha` e `Perfil completo/Completar perfil`.
- Fluxo validado em banco sintético: login com senha temporária, troca obrigatória, bloqueio do dashboard, conclusão do perfil e liberação do painel.

### Importação de participantes do Even3

- Adicionadas rotas administrativas para importar participantes por evento a partir de arquivos CSV, XLS ou XLSX.
- A importação detecta colunas de nome, e-mail, instituição, telefone, CPF e passaporte, cria contas com senha temporária ou atualiza contas correspondentes e apresenta o resumo do processamento.
- Contas criadas pela importação entram no fluxo obrigatório de troca de senha e conclusão do perfil.

### Verificação pública de certificados

- Adicionada a rota `/consultar-certificado` para consulta pública pelo código de verificação da emissão.
- A página informa os dados do certificado válido sem exigir autenticação e apresenta mensagem neutra para códigos inexistentes ou inválidos.

### Correção: persistência do campo "Curso" na criação e edição de usuários

- No formulário de novo usuário (`/admin/users/new`) e de edição (`/admin/users/:id/edit`), ao selecionar uma Área de Formação e depois um Curso no combobox, ao salvar os dados do usuário, o campo `formacao_curso` **não é persistido no banco de dados**.
- Dados de referência verificados: os CSVs `assets/tabela_area.csv` (11 áreas) e `assets/tabela_curso_graduacao.csv` (354 cursos) são lidos corretamente pelo backend; `cursosMap` é serializado com sucesso via `JSON.stringify` e contém os 11 códigos de área com suas respectivas listas de cursos.
- A função JavaScript `updateCursosByArea` em `views/admin/users/form.ejs` está presente e lógica correta, populando o select via `document.getElementById('formacao_curso').innerHTML` e `document.createElement('option')`.
- O campo HTML `<select id="formacao_curso" name="formacao_curso">` está presente e com `name` correto em ambas as rotas (criação e edição).
- As colunas `formacao_area`, `formacao_curso`, `formacao_titulacao` e `formacao_status` existem na tabela `users` (verificadas em `db.js`).
- O backend extrai corretamente `formacao_curso` de `req.body` e passa para o `INSERT`/`UPDATE` via `?` placeholder.
- Arquivos afetados: `routes/users.js` (rotas `POST /` e `POST/PUT /:id`), `views/admin/users/form.ejs` (template e script), `security/validation.js` (validador `userForm` não valida `formacao_curso`), `db.js` (colunas da tabela).
- Causa identificada: na edição, o `<select>` de curso era renderizado somente com a opção inicial. O JavaScript tentava recuperar `cursoSelect.value` antes de inserir as opções da área, recebia uma string vazia e perdia o curso já persistido; ao salvar o formulário novamente, enviava o campo vazio.
- Correção aplicada: as opções de curso da área selecionada agora são renderizadas no servidor, incluindo o curso persistido com o atributo `selected`. O JavaScript ficou responsável apenas por reconstruir a lista quando a área é alterada.
- O validador `userForm` passou a normalizar e limitar também os quatro campos de formação.
- Validação funcional concluída em banco temporário: criação com `Engenharia elétrica`, carregamento da edição com a opção selecionada e atualização para `Engenharia química`, com persistência confirmada no SQLite.
- Status: **corrigido e validado**.

### Botão "Salvar configuração geral" nos certificados

- Adicionado botão "Salvar configuração geral" na página `/admin/events/:id/certificates` que replica a cor da fonte e o fundo selecionados em todos os tipos de certificado do evento (Participante, Revisor, Palestrante, Professor, Apresentador Oral, Apresentador Pôster), preservando título, texto e mínimo de presença individuais de cada papel.
- Nova rota `POST /admin/events/:id/certificates/rule/apply-to-all` que faz upsert de `background_id` e `text_color` em `event_certificate_rules` para todos os papéis via `ON CONFLICT DO UPDATE` restrito a esses dois campos mais `updated_by` e `updated_at`.
- A rota `POST /certificates/rule` agora detecta o campo `apply_to_all=1` e redireciona para a rota de apply-to-all, permitindo que o formulário de configuração individual envie a solicitação de replicação global.
- Botão de escolha de fundo (thumbnail) restaurado: formulário "Salvar configuração geral" movido para fora do formulário de configuração de certificado, corrigindo erro de formulário aninhado inválido que quebrava os event listeners de seleção.
- Botão "Salvar configuração geral" reposicionado na mesma linha dos demais botões ("Salvar configuração", "Visualizar prévia", "Visualizar original"), dentro do mesmo `<p>`, sem quebrar layout.

### Ordem alfabética nas thumbnails de fundos

- Thumbnails de fundos de certificado em `/admin/events/:id/certificates` agora são ordenadas alfabeticamente por nome (`name COLLATE NOCASE`) em vez de ordem decrescente de criação (`created_at DESC`).

## 2026-08-05

### Campo de telefone em usuários e participantes

- Adicionada a coluna `phone` à tabela `users` e à tabela `event_registrations`, com migração automática via `PRAGMA table_info`.
- O formulário de inclusão administrativa de participante (`views/admin/events/participant-form.ejs`) passou a exibir o campo "Telefone" com placeholder `+55 11 912345678` e help text de formato internacional.
- O formulário de inclusão administrativa passou a gravar `phone` no INSERT e UPDATE de `event_registrations`, normalizado com `String(body.phone || '').trim()`.
- O card "Dados Pessoais" do formulário de edição de usuário (`views/admin/users/form.ejs`) passou a exibir o campo "Telefone" com placeholder e help text de formato internacional.
- A rota `POST /admin/users/:id` passou a ler e persistir `phone` nos INSERT e UPDATE da tabela `users`.
- A listagem administrativa de participantes (`views/admin/events/participants.ejs`) passou a exibir o telefone abaixo da instituição, quando preenchido.

### Padronização da topbar em todas as views

- Todas as 31 views do sistema (públicas, de revisor e admin) foram atualizadas para exibir a mesma topbar com logo `◆ Artigos LIGEM`, navegação padronizada (`topbar-nav`), pill de email (`session-pill`) e botão Sair vermelho (`btn btn-logout`).
- Botões Sair unificados com classe `.btn btn-logout`, background transparente e texto vermelho.
- CSS de navegação unificado com `display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap` e hover com fundo sutil.
- Correção de highlight nas views admin: páginas de eventos com "Eventos" ativo e "Usuários" sem active; páginas de artigos com "Eventos" ativo; páginas de usuários com "Usuários" ativo; páginas de relatórios com "Eventos" ativo.

### Remoção de botões de navegação duplicados

- Removidos links redundantes `<- Eventos` das views admin de eventos (list, participants, attendance, activities, certificates, form, roles, subsidies) e da view de relatório de certificado.
- Removido link redundante `<- Voltar` da view `roles.ejs` e `attendance.ejs`.
- Removido botão "Voltar aos Eventos" de `views/admin/events/participants.ejs` e `views/admin/events/subsidies.ejs`.

### Ajuste de botão "Voltar" no formulário de participante

- Na página de edição do participante (`views/admin/events/participant-form.ejs`), o link `<- Voltar` foi removido e substituído pelo botão "Cancelar" estilizado como `.btn btn-secondary`, com texto dinâmico conforme o modo (incluindo ou editando).

### Ajuste de botão de inclusão na listagem de participantes

- Na listagem de participantes (`views/admin/events/participants.ejs`), o link "Incluir participante" foi substituído por botão com classe `.btn btn-secondary`, cor de fundo consistente com o sistema.

### Correções de layout em views admin

- Correção de layout na página de edição de participante (`views/admin/events/participant-form.ejs`): grid de 2 colunas com altura igual e texto ajustado com `align-items: flex-start`.
- Correção de alinhamento de cards no dashboard admin (`views/admin/dashboard.ejs`): grid com altura igual via `align-items: stretch`.
- Correção de exibição de contadores no dashboard admin: labels com cor mais clara (`#94a3b8`) e separação visual com `font-size` e `margin-bottom`.
- Correção de erro de renderização na página de participantes do admin: template atualizado para usar `participant.id` ao invés de `participant.registration_id`.

### Correção de erro de renderização EJS na listagem de certificados

- Removido bloco inválido de EJS em `views/admin/events/certificates.ejs` que causava erro "Unexpected token" e impedia a renderização da página.

### Correção de exibição de status de subsídio no autor-dashboard

- Adicionado suporte à exibição condicional do status de subsídio na página do participante (`views/public/author-dashboard.ejs`): coluna "Subsídio" com badge colorido aparece apenas quando o usuário possui solicitações de subsídio vinculadas.
- Correção de erro de renderização na visualização administrativa da área do participante (`/admin/users/:id/participant`): prop `showSubsidyStatus` agora é passada ao template, eliminando erro de renderização EJS.

### Correção de coluna ambígua na query de presença por atividade

- Corrigido erro `ambiguous column name: user_id` na query de presença por atividade (`routes/events.js`), aliasando coluna de `event_user_roles` para `person_user_id` na junção com `event_registrations` e `activity_attendance_records`.

### Reescrita da página de presença por atividade

- Reescrita completa da página de presença por atividade (`views/admin/events/activity-attendance.ejs`) com layout topbar/Inter, stats cards (presentes/ausentes/total), tabela com perfis no evento e role na atividade, e validação server-side dos papéis aceitos.

### Vinculação de atuação por atividade no controle de presença

- O dropdown de seleção de papel na chamada de atividade agora apresenta somente os papéis elegíveis que a pessoa já possui no evento.
- Botões separados marcam, atualizam ou removem a presença, sem alterar `event_user_roles`.

### Correção de botão Sair com CSRF

- Todos os formulários de logout passam a conter o campo oculto `_csrf` com o token CSRF da sessão, evitando falha de autenticação ao clicar "Sair".

### Corrigido botão "Baixar" nos certificados emitidos

- Botão "Baixar" na página de certificados administrativos (`views/admin/events/certificates.ejs`) alterado de `<button>` para `<a>` tag com classe `secondary`, resolvendo problema de navegação e download do PDF.
- CSS da classe `.secondary` expandido para incluir estilos completos (background, color, border, padding, border-radius, font-weight, cursor, text-decoration) e estado `:hover`, garantindo aparência padronizada com os botões "Reemitir" e "Emitir".



### Botão "Gerenciar atividades" na página de certificados

- Link "Gerenciar atividades →" na seção "Atividades do evento" da página de certificados (`views/admin/events/certificates.ejs`) convertido em botão com classe `btn-secondary`, sem seta no rótulo.

### Seção "Atividades do evento" na página de certificados

- Adicionada seção "Atividades do evento" na página de certificados administrativos com:
  - Três cards de estatísticas: total de atividades, inscrições vinculadas, presenças registradas.
  - Cards separados por tipo de atividade (Palestra, Seminário, Mesa-redonda, Minicurso, Apresentação oral, Apresentação pôster, Outra), com badges de cor distintos.
  - Cada atividade exibe nome, data, carga horária, badges dos papéis elegíveis, contadores de inscritos/presentes e status de certificação.
  - Ordenação alfabética por nome dentro de cada grupo.
  - Link "Gerenciar atividades" como botão ao final da seção.
- Dados de atividades carregados no controller (`routes/events.js`) e passados ao template.

### Atividade listadas em cards por tipo na página de atividades

- Reescrita da listagem de atividades em `views/admin/events/activities.ejs`: substituída a tabela por cards separados por tipo de atividade.
- Cada tipo possui card com título e badge de cor distinto.
- Atividades dentro de cada card ordenadas alfabeticamente por nome.
- Cada card de atividade inclui nome, data, carga horária, badges dos papéis elegíveis, botões "Editar" e "Presença", contadores de inscritos/presentes e botão de ativar certificação quando desativada.

### Corpo do certificado de Professor aceita nome da atividade

- Texto padrão do certificado de Professor alterado de `"atuou como professor(a) no evento {event}."` para `"ministrou {atividade} no {event}."`.
- Função `certificateText` em `routes/events.js` atualizada para aceitar e substituir `{atividade}` pelo nome da atividade ministrada.
- `issueCertificate` passa a extrair o nome da primeira atividade frequentada e repassá-lo à função de texto.
- Prévia do certificado mantém `null` para `{atividade}` quando não há atividade real associada.

## 2026-08-04

### Correção do vínculo Atividade–Pessoa–Presença–Certificado

- Separado o papel atribuído no evento (`event_user_roles`) da atuação efetiva registrada na presença (`activity_attendance_records.role`). Marcar ou remover presença não altera mais os papéis da pessoa no evento.
- A chamada de cada atividade passou a oferecer somente papéis simultaneamente elegíveis para a atividade e já pertencentes à pessoa no evento; o papel `participant` decorre da inscrição.
- Corrigida a remoção de presença ao selecionar “— selecionar —”, que antes era convertida indevidamente em presença como participante.
- Marcações, alterações de papel e remoções de presença por atividade passaram a gerar registros em `participant_audit_logs`.
- Removido o `UPSERT` que tentava atualizar a coluna inexistente `event_user_roles.updated_at`.
- A elegibilidade de participante, palestrante, professor e apresentadores passou a exigir o mínimo configurado de presenças no papel correspondente. Revisores continuam elegíveis por parecer enviado.
- A carga horária de cada certificado agora considera somente atividades habilitadas nas quais a pessoa esteve presente naquele mesmo papel.
- A administração pode ativar ou desativar uma atividade no cálculo de certificados e carga horária diretamente na listagem de atividades.
- A mesma pessoa pode receber certificados distintos por seus diferentes papéis no evento, com resumo e carga horária próprios das atividades de cada papel.
- Adicionada a coluna `activities_summary` às emissões para preservar e exibir no PDF e na área do participante as atividades consideradas na emissão.
- A antiga regra por atividade foi retirada do fluxo, pois comparava o total consolidado com apenas a primeira regra encontrada. Mínimo de presenças, fundo, cor e texto permanecem centralizados por papel de certificado.

### Correção do botão "Visualizar original" na página de certificados do admin

- Corrigida a função `resetToOriginal` em `views/admin/events/certificates.ejs`: ao clicar "Visualizar original", a prévia agora é renderizada diretamente com as configurações salvas (fundo, cor, título e texto) no banco, sem modificar os campos do formulário com valores antigos.
- Adicionado helper `showPreview(params)` para centralizar a exibição da prévia em `buildPreview` e `resetToOriginal`, eliminando duplicação de código e garantindo comportamento consistente.
- Adicionada a rota `GET /admin/events/:id/certificates/rule/current` em `routes/events.js` que retorna as configurações salvas de todas as regras de certificado por papel.
- Corrigido o endpoint de prévia (`certificates/preview`) para aceitar parâmetros `title` e `body_text` via query string, permitindo renderizar a prévia com os valores atuais do formulário.

### Exportação em lote dos certificados emitidos em ZIP

- Adicionada a rota `GET /admin/events/:id/certificates/export-all` em `routes/events.js` que gera um arquivo ZIP com todos os certificados emitidos (`status = 'issued'`) do evento.
- Cada certificado é renderizado em PDF via PDFKit e adicionado ao ZIP com nome formatado `certificado-VV-nome-participante-tipopapel-vN.pdf`. O arquivo ZIP usa o nome `{nome_evento}-certificados.zip`.
- Função `generateCertificateBuffer` reutiliza a lógica de `renderCertificatePdf` para gerar buffers de PDF em memória, usando `getBackgroundPath` para resolução de caminhos de fundos.
- Corrigido erro `Class constructor PDFDocument cannot be invoked without 'new'`: `require('pdfkit')` retorna a classe `PDFDocument`, que exige `new` para instânciação.
- Botão "Exportar todos os certificados emitidos" adicionado em `views/admin/events/certificates.ejs` com cor laranja (`#ea580c`), linkando para a rota de exportação.
- `services/certificates.js` passou a exportar `getBackgroundPath` para ser reutilizada pelo gerador de buffer.

### Botão "Baixar" nos certificados emitidos

- Alterado o link "Baixar" de `<a>` para `<button class="secondary">` em `views/admin/events/certificates.ejs`, eliminando o sublinhado e padronizando visualmente com os botões "Emitir" e "Reemitir".

### Cores personalizadas para status de elegibilidade e emissão

- Na coluna "Elegibilidade" da página de certificados (`views/admin/events/certificates.ejs`), o status "Elegível" agora usa a cor `#8AAD34` e o status "Emitido" usa a cor `#329542` (verde escuro), substituindo as cores padrão `.ok`/`.no` do CSS.

### Contador de certificados emitidos por papel nos cards de certificados

- Cada card de certificado ("Participante", "Revisor", "Palestrante", "Professor", "Apresentador Oral", "Apresentador Pôster") agora exibe a quantidade de certificados emitidos ao lado do rótulo, formatada como `(<N> emitido<em>s</em>)`. A contagem vem de query SQL agrupada por `certificate_role` com filtro `status = 'issued'`.

### Estatística de certificados emitidos no relatório do evento

- Adicionada a query de contagem de certificados emitidos (`status = 'issued'`) em `routes/reports.js` e a variável `certificatesIssued` passada ao template `views/admin/reports/list.ejs`. Novo card verde na seção "Estatísticas do Evento" exibe o total de certificados emitidos pelo evento.

### Padronização da topbar nas views públicas

- Views `views/public/event.ejs` e `views/public/event-certificates.ejs` atualizadas para usar as mesmas classes CSS e estrutura de navegação da view `submit.ejs`: `btn-secondary` (antes `btn-ghost`) para links de Dashboard/Área do Participante e `btn-logout` (antes `logout-btn`) para o botão "Sair". CSS `.topbar-nav` unificado com `display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap` e hover com fundo sutil.

### Botões "Editar" e "Presença" na listagem de atividades

- Na página `/admin/events/:id/activities`, as células de ação da tabela de atividades cadastradas foram atualizadas: o link "Fazer chamada" foi renomeado para "Presença" e ambos os elementos agora são `<a>` estilizados como botões (fundo `#334155`, `border-radius:6px`, `display:block`, `text-align:center`), eliminando o sublinhado e padronizando visualmente com os demais botões do sistema.

### Inscrição explícita de participantes nas atividades

- Criada a tabela `participant_activity_enrollments` para separar inscrição na atividade de presença efetiva.
- O formulário de inclusão administrativa de participante passou a exigir ao menos uma atividade quando o evento possui programação cadastrada.
- O mesmo formulário, em modo de edição, permite adicionar ou remover atividades da inscrição posteriormente.
- A listagem de participantes passou a mostrar quantidade e nomes das atividades vinculadas, com acesso direto à edição.
- A listagem de atividades passou a mostrar separadamente inscritos e presentes e contém orientação para a página onde os vínculos são administrados.
- As atividades cadastradas podem ser reabertas para edição de nome, tipo, data, carga horária, papéis elegíveis e participação no cálculo de certificados.
- A chamada passou a listar participantes inscritos naquela atividade, preservando também pessoas elegíveis por papéis como revisor, palestrante, professor ou apresentador.
- Na primeira migração, inscrições existentes são vinculadas às atividades atuais elegíveis para participante para preservar o histórico; novas inscrições exigem seleção explícita das atividades.
- A inscrição pública passou a criar o vínculo participante–atividade e a área do participante ganhou `/evento/:id/atividades` para edição posterior. Atividades com presença registrada são preservadas.
- A elegibilidade do certificado de participante exige simultaneamente inscrição e presença em cada atividade certificável.
- A chamada por atividade passou a exibir botões explícitos para marcar, atualizar e remover presença; o papel selecionado permanece independente da ação, evitando que a coluna de presença mostre apenas “—” sem controle operacional.
- `README.md` e `submissao.md` foram consolidados com o fluxo operacional Evento → Atividades → Inscrição → Presença → Certificados e com as rotas utilizadas por participante e administrador.

### Endurecimento de segurança, CSRF, rate limiting e validação server-side

- Instalado `express-validator` e criados módulos em `security/`: `csrf.js`, `rate-limits.js` e `validation.js`.
- Proteção CSRF implementada com token gerado por sessão, validação `timingSafeEqual` e rejeição 403 para requisições POST/PUT/DELETE sem token ou com token inválido. Campo `_csrf` injetado automaticamente em todos os formulários via partial `views/partials/csrf-inject.ejs`.
- Rate limiting configurado: 10 tentativas/15 min no login, 5/hora no cadastro público e inscrições, 30/min em ações administrativas sensíveis, 200/15 min como teto global.
- express-validator aplicado nas rotas de login, troca de senha, cadastro público, revisão e decisão final, com mensagens de erro localizadas.
- `server.js` atualizado: secret de sessão via `SESSION_SECRET` ou `crypto.randomBytes(32)`, cookie `secure` ativado em produção, CSP com `objectSrc: none`, `baseUri` e `formAction` restritos, `referrerPolicy` configurado, payload limit de 1 MB.
- Todos os endpoints POST administrativos recebem `strictLimiter` para prevenir abuso de operações sensíveis.
- `package.json` atualizado com a nova dependência `express-validator`.

## 2026-08-03

### Papéis por evento, certificados por papel e presença unificada

- O gerenciamento de usuários foi consolidado no modelo de conta única: papéis são atribuídos por evento em `event_user_roles`, incluindo Administrador, Participante, Revisor, Palestrante, Professor, Apresentador Oral e Apresentador Pôster.
- Administração migrada para o escopo do evento: cada administrador vê e administra apenas os eventos atribuídos; administradores legados foram associados aos eventos existentes; o criador de um novo evento passa a ser administrador dele automaticamente.
- Página de papéis do evento ampliada para atribuir e remover administradores do evento.
- Certificados evoluídos para emissão por papel, permitindo vários certificados independentes para a mesma pessoa em um evento; configuração individual de fundo, cor, título e texto; emissão em lote de certificados elegíveis pendentes.
- Seleção de fundos de certificado passou a usar miniaturas. A prévia dinâmica usa as escolhas atuais de fundo e cor do formulário antes de salvar a configuração.
- Presença simples passou a ser registrada por pessoa e evento, incluindo todas as pessoas vinculadas (participantes, revisores, palestrantes, professores e apresentadores) sem duplicidade por acúmulo de papéis.
- Edição administrativa de participante ficou restrita aos dados da inscrição; a atribuição de papéis e a vinculação de artigos aprovados para apresentações são feitas na edição do usuário, após escolher o evento.

### Carga horária no certificado e preparação de testes

- O PDF e a área autenticada de certificados passaram a apresentar a carga horária consolidada em `hora-aula` ou `horas-aula` apenas quando o total das atividades do certificado for maior que zero.
- Os registros de `certificate_emissions` foram limpos no ambiente de testes, preservando eventos, regras, fundos, atividades, inscrições e presenças para permitir novas emissões.
- A emissão passou a consolidar a carga horária pelas presenças da pessoa em atividades habilitadas para certificado, independentemente do papel do certificado.
- O painel `/admin/events/:id/attendance` foi reorganizado como entrada para as chamadas por atividade; a presença geral deixou de ser apresentada como ação de certificação.

### Consolidação de perfis e atividades por evento

- Atribuição de perfis foi centralizada na edição do usuário com evento selecionado; a edição de participante voltou a tratar exclusivamente da inscrição e aponta para o fluxo de perfis por evento.
- Cadastro de atividades reformulado para representar partes do evento, com seleção de perfis elegíveis e do perfil de certificado que cada atividade habilita.
- Controle de presença por atividade ajustado para marcar pessoas elegíveis, independentemente de possuírem apenas inscrição ou outro papel no evento.

### Vinculação de papéis por atividade no controle de presença

- Adição da coluna `role` (TEXT DEFAULT 'participant') em `activity_attendance_records` para registrar o papel específico que cada pessoa exerce em cada atividade.
- Rota `POST /admin/events/:id/activities/:activityId/attendance/:userId` atualizada para aceitar `role` do formulário; ao selecionar um papel, o registro de presença é atualizado e o papel é propagado automaticamente para `event_user_roles` via `INSERT OR REPLACE`.
- Selecionar papel vazio ("— selecionar —") remove o registro de presença e o papel vinculado àquela atividade.
- Rota `GET /admin/events/:id/activities/:activityId/attendance` ajustada para retornar `activity_role` de cada pessoa, com query corrigida para eliminar erro "ambiguous column name: user_id" causado pela junção de `event_registrations`, `event_user_roles` e `activity_attendance_records` (alias `person_user_id`).
- View `views/admin/events/activity-attendance.ejs` reescrita com layout topbar/Inter, stats cards (presentes/ausentes/total), tabela com colunas de pessoa, perfis no evento (badges), role na atividade (dropdown com seleção automática via `onchange`) e status de presença.
- Papéis aceitos no dropdown: participante, professor, palestrante, apresentador oral e apresentador pôster.

---

### Certificados por papel no evento

- Separadas permissões globais (`Administrador` e `Revisor`) dos papéis certificados por evento: Participante, Revisor, Palestrante, Professor, Apresentador Oral e Apresentador Pôster.
- Criadas as tabelas `event_user_roles` e `event_certificate_rules` para atribuição de papéis e configuração individual de fundo, cor, título e texto de cada certificado.
- Emissões migradas para identificar pessoa e papel, permitindo múltiplos certificados e reemissões independentes para a mesma pessoa no mesmo evento.
- Administração ganhou a página de papéis do evento e a emissão agrupada por tipo de certificado; PDFs e área autenticada identificam o papel certificado.

---

### Participante: exibição do status do subsídio e topbar unificada em certificados

#### Implementações

- **Status do subsídio no painel do participante:** adição da coluna condicional "Subsídio" na tabela "Minhas Participações" da página `/author`. O badge exibe `Pendente` (amarelo), `Aprovado` (verde) ou `Rejeitado` (vermelho) conforme o valor de `subsidy_status` em `event_registrations`. A coluna só aparece quando pelo menos um dos registros de participação do usuário possui `subsidy_requested = 1`.
- **Topbar unificada em certificados de participante:** a página `/evento/:id/certificates` passou a exibir, quando autenticado, o e-mail da conta em badge e o botão "Sair" em vermelho, seguindo o padrão já adotado por `event.ejs`, `submit.ejs` e demais páginas públicas autenticadas.

#### Correções

- **Erro de renderização EJS em `/admin/users/:id/participant`:** o prop `showSubsidyStatus` não estava sendo passado ao template quando o admin acessa a área de participante de um usuário via botão "Área do Participante". A rota em `routes/users.js` agora calcula e repassa a flag, eliminando o erro de template.

#### Arquivos alterados

- `routes/public.js` — variável `showSubsidyStatus` calculada a partir de `participations` e passada ao template em `/author`.
- `routes/users.js` — prop `showSubsidyStatus` adicionada ao `res.render` na rota `/:id/participant`.
- `views/public/author-dashboard.ejs` — coluna condicional "Subsídio" na tabela "Minhas Participações" com badge colorido por status.
- `views/public/event-certificates.ejs` — topbar ampliada com `session-pill` (e-mail) e botão "Sair" vermelho, condicionais a `userEmail`, `isAdmin` e `isReviewer`.

#### Documentação

- `submissao.md` atualizado: novos itens em "Implementado" referenciando status do subsídio e topbar unificada em certificados.
- `submissao_log.md` atualizado com registro destas mudanças.

---

### Certificados: prévia inline, cor da fonte e seleção de fundos em miniatura

#### Implementações

- **Cor da fonte configurável:** adição da coluna `text_color` (TEXT DEFAULT `#0f172a`) nas tabelas `certificate_rules` e `certificate_emissions` via migration. Seletor de cor (`input type="color"`) no formulário de regra de elegibilidade. Toda a fonte do certificado em PDF agora utiliza a cor selecionada (título, corpo, nome do participante, datas e código de verificação).
- **Prévia inline do certificado:** nova rota `GET /admin/events/:id/certificates/preview` que gera um PDF de prévia com fundo e cor da fonte selecionados via parâmetros `?background_id=X&text_color=Y`. A prévia reflete as configurações atuais do formulário antes de salvar, não os valores persistidos no banco. Exibida em iframe inline na própria página com botão alternável "Visualizar prévia do certificado" / "Ocultar prévia".
- **Seleção de fundos em miniatura:** remoção do combobox de fundos e substituição por grade de miniaturas clicáveis organizadas em dois grupos (Fundos padrão de `assets/Fundos/` e Fundos enviados de `uploads/certificate-backgrounds/`). Clique na miniatura atualiza o campo oculto `background_id` e a prévia em tempo real.
- **Rota para servir fundos enviados:** `GET /admin/events/:id/certificates/backgrounds/:backgroundId/view` serve a imagem do fundo com o MIME type correto, lendo o caminho relativo da tabela `certificate_backgrounds` e resolvendo o caminho absoluto.
- **Reorganização do layout:** campos de regra (presenças mínimas + cor da fonte) em linha no topo do card; grade de fundos abaixo; botão "Salvar regra" posicionado após a seleção de fundos.

#### Correções

- Corrigido erro de caminho de arquivos para fundos enviados: o `file_path` armazenado em `certificate_backgrounds` agora é salvo com prefixo `uploads/certificate-backgrounds/` (antes `certificate-backgrounds/`), garantindo que os arquivos sejam encontrados corretamente.
- Corrigido erro "18 values for 17 columns" na emissão de certificados: `INSERT INTO certificate_emissions` estava com número incorreto de placeholders no `VALUES`.
- Corrigido erro "16 values for 17 columns" na emissão de certificados: `INSERT INTO certificate_emissions` com `datetime('now','-3 hours')` literal no `VALUES` contava como valor adicional. Data/hora agora é calculada em JavaScript com o mesmo fuso horário UTC-3 usado em todo o código.
- Corrigido erro "6 values for 7 columns" na atualização de regra de certificado: `INSERT INTO certificate_rules` tinha número incorreto de placeholders para a coluna `updated_by`.

#### Documentação

- `submissao.md` atualizado: descrição de certificados de participação ampliada com cor da fonte configurável, prévia inline e seleção de fundos em miniatura.
- `submissao_log.md` atualizado com registro destas mudanças.

---

### Épico 3: presença por atividade, dia ou minicurso — implementado

#### Implementações

- **Consolidação de carga horária por participante:** helper `getWorkloadSummaryByEvent` no `db.js` calcula total de atividades frequentadas e carga horária consolidada por participante com base em `activity_attendance_records` e `event_activities` (somente atividades com `certificate_enabled = 1`).
- **Conexão de regras de atividade à elegibilidade de certificados:** `getCertificateParticipants` reescrita para consultar presenças por atividade e calcular elegibilidade com base em `activity_certificate_rules` (quando disponíveis) ou `attendance_records` (fallback por presença simples).
- **Emissão de certificado com informações de atividades:** `issueCertificate` atualizada para popular colunas `activity_id`, `activities_attended` e `total_workload_hours` no registro de `certificate_emissions`.
- **PDF do certificado atualizado:** `services/certificates.js` exibe a carga horária consolidada em horas-aula apenas quando houver total maior que zero.
- **Nova rota de regra de certificado por atividade:** `POST /admin/events/:id/activities/:activityId/certificate-rule` permite salvar mínimo de presenças e fundo específico por atividade.
- **Colunas adicionais em `certificate_emissions`:** migration adiciona `activities_attended` (INTEGER DEFAULT 0) e `total_workload_hours` (REAL DEFAULT 0).

#### Views

- `views/admin/events/activities.ejs` reescrito com topbar, grid de cards, badges por tipo de atividade (Palestra/Seminário/Mesa redonda/Minicurso/Outra), contagem de presenças por atividade e link para gerenciar presença.
- `views/admin/events/activity-attendance.ejs` reescrito com topbar, stats cards (presentes/ausentes/total), formulário de regra de certificado (mínimo de presenças + seletor de fundo com grupos "Fundos padrão" e "Fundos enviados"), lista de participantes com botão presente/ausente.
- `views/admin/events/certificates.ejs` reescrito com topbar, colunas de atividades frequentadas e carga horária por participante, tags das atividades, badges de elegibilidade.

#### Correções

- Corrigido erro "18 values for 16 columns" na emissão de certificados: `INSERT INTO certificate_emissions` estava com número incorreto de placeholders no `VALUES`.

#### Documentação

- `submissao.md` atualizado: Épico 3 marcado como implementado; riscos e gaps relacionados a carga horária e regras por atividade removidos; ordem recomendada ajustada; backlog técnico atualizado.
- `submissao_log.md` atualizado com registro desta entrega.

---

## 2026-07-31

### Implementações

- Gestão administrativa de participantes por evento concluída com criação ou seleção de conta, inscrição, edição, remoção condicionada e auditoria.
- Tabela `participant_audit_logs` adicionada para registrar alterações manuais na participação e a reconciliação provocada pela exclusão de artigos.
- Índices únicos adicionados para impedir duplicidade de inscrição por evento/e-mail normalizado e por evento/conta vinculada.
- Exclusão administrativa de artigo ajustada: ao remover o último artigo submetido, a inscrição do autor é preservada e reclassificada para `listener`; se houver outro artigo, permanece como `author`.
- Presença simples por evento implementada com a tabela `attendance_records`, lançamento manual, remoção, observação opcional e identificação do administrador responsável.
- Painel administrativo de presença adicionado à gestão do evento, com filtros e totais de inscritos, presentes e participantes sem presença.
- Formulário administrativo de inclusão de participante ampliado com seletor de contas já cadastradas, preenchimento automático e vínculo explícito ao evento.
- Inclusão administrativa passou a exigir conta vinculada: o admin cria uma conta com senha temporária ou inscreve conta ativa já existente, preservando o acesso do participante a autosserviço e certificados.
- Download administrativo em lote dos artigos de um evento implementado em arquivo ZIP, incluindo apenas submissões com PDF disponível.
- Relatório do evento ampliado com checkbox por seção e controles para selecionar ou limpar todas as seções antes da impressão em PDF.
- Layout da listagem administrativa de eventos ajustado para quebrar os botões de ação e permitir rolagem horizontal da tabela em telas estreitas.

### Correções

- Correção do download ZIP em lote para usar a API `ZipArchive` compatível com a versão instalada da dependência `archiver`.

### Certificados

- Módulo de certificados implementado com regra de elegibilidade por presença, emissão versionada, reemissão auditável e download autenticado em PDF.
- Biblioteca de fundos de certificado adicionada com seleção de imagens existentes e upload administrativo de PNG/JPEG.

### Atividades e presença detalhada

- Cadastro administrativo de atividades internas por evento adicionado, com tipos como palestra, seminário, mesa-redonda, minicurso e outras atividades.
- Atividades passaram a armazenar data, carga horária e indicação de emissão de certificado.
- Presença por atividade implementada em `activity_attendance_records`, permitindo registrar a participação da mesma pessoa em várias atividades do evento.
- Base `activity_certificate_rules` adicionada para suportar regras e fundos específicos por atividade; a conexão da emissão de certificados a essa seleção permanece como próxima etapa.

### Enxugamento técnico

- Removidos os endpoints individuais legados de atualização de perfis de usuários; a atualização em lote permanece como fluxo único.
- Removidos os redirecionamentos legados de login do revisor e o fallback duplicado de atualização de eventos.
- A revisão passou a usar exclusivamente `assignments` e `reports`; colunas antigas e sem consumidores foram removidas de `articles` por migração compatível.
- Dependência direta não utilizada `body-parser` e o arquivo vazio `database.sqlite` removidos.

## 2026-07-30

### Documentação

- `submissao.md` atualizado para refletir o fluxo atual de deliberação final administrativa, a leitura dos pareceres na página do artigo, os novos agrupamentos do dashboard e a persistência de timestamps em horário local do Brasil.
- `submissao_log.md` atualizado com o histórico das mudanças implementadas em 30 de julho de 2026.
- Documentação reposicionada para tratar o produto como sistema de gestão de eventos, artigos, presença e certificados de participação, e não apenas como fluxo de submissão.
- Documentação ampliada com diagnóstico por objetivo e planejamento por fases para cobrir integralmente gestão de eventos, avaliação de artigos, presença e certificados de participação.
- Planejamento documental detalhado em épicos, entregas incrementais e tarefas técnicas agrupadas por arquivo.

### Implementações

- Página administrativa do artigo ampliada com seção de deliberação final, permitindo aprovar, reprovar e alterar a modalidade `oral`/`poster` sem sair do detalhe do artigo.
- Card `Revisores Atribuídos` ampliado com leitura expansível dos pareceres já enviados.
- Dashboard administrativo reorganizado em grupos temáticos (`Eventos`, `Revisores`, `Usuários`, `Artigos`).
- Dashboard administrativo ampliado com métricas e listas para artigos sem revisor, em análise e prontos para deliberação final.
- Fluxo de exclusão de artigos na listagem administrativa ajustado para usar modal customizado em vez da caixa nativa do navegador.
- Consulta pública por código ampliada com andamento agregado da avaliação, usando contagem de pareceres e recomendações.

### Correções

- Correção do fluxo de parecer do revisor para registrar recomendação individual sem deliberação final automática do artigo.
- Correção do painel do revisor para diferenciar `Meu Parecer` de `Aguardando deliberação final administrativa`.
- Correção do link `Corpo de Revisores` no painel do revisor, ajustando a navegação para `/revisores`.
- Correção da página pública do evento para permitir que contas administrativas autenticadas também sigam o fluxo de participante em inscrições, submissões e certificados de participação, quando aplicável.
- Correção da listagem administrativa de artigos para usar rótulos de status em português no combobox de ação.
- Correção da persistência de timestamps nas rotas ativas para gravar em horário local do Brasil (`UTC-3`) em vez de UTC puro.

### Observações Técnicas

- O fluxo oficial de múltiplos revisores agora trata `assignments` e `reports` como fonte de verdade para recomendações individuais, enquanto a deliberação final administrativa permanece como etapa própria.
- O status `accepted` em atribuições antigas pode continuar aparecendo em registros históricos já persistidos antes da atualização do fluxo.
- A exclusão física de artigos pela administração ainda pode exigir ajustes adicionais para sincronizar a participação em `event_registrations`.

## 2026-07-29

### Documentação

- `submissao.md` atualizado para refletir o cronograma público por evento, as novas janelas (`registration`, `review`, `certificates`) e as regras reais de bloqueio por período.
- `submissao_log.md` atualizado com o histórico das mudanças implementadas em 29 de julho de 2026.

### Implementações

- Página pública do evento reorganizada em formato de cronograma com coluna de ação por etapa.
- Cadastro e edição de eventos ampliados para suportar datas de inscrições, análise de submissão e certificados de participação.
- Painel `/author` ajustado para mostrar apenas eventos futuros em cards clicáveis, levando diretamente à página pública do evento.
- Fluxo público de submissão ajustado para exigir inscrição prévia no evento antes do envio do artigo.
- Eventos passaram a suportar a flag `has_article_submission`, com exibição condicional das etapas de submissão e análise nas telas públicas.
- Cadastro administrativo de usuários ampliado com `reviewer_areas`, permitindo sugerir revisores compatíveis com a trilha do artigo.
- Tela administrativa do artigo ampliada com lista de revisores atribuídos, sugestão por trilha e ações de atribuição e remoção.
- Dashboard administrativo ampliado com cards para artigos sem designação, solicitações de subsídio e solicitações de cadastro pendentes.
- Painel do revisor ampliado com atalhos para área do participante, dashboard admin, eventos, consulta de artigo e corpo de revisores.
- Área do participante ampliada com navegação para múltiplos perfis, bloco exclusivo de rascunhos e retomada de preenchimento.
- Fluxo de exclusão de rascunhos implementado diretamente na área do participante, com atualização imediata dos contadores.
- Modal customizado implementado para confirmar a exclusão de rascunhos sem usar a caixa nativa do navegador.

### Correções

- Correção do comportamento dos botões da página pública do evento para trocar a ação conforme autenticação e inscrição do participante.
- Correção da etapa `Submissão Artigos`, que agora só habilita envio para usuário autenticado e inscrito.
- Correção do backend para bloquear inscrições fora da janela de `registration_start` e `registration_end`.
- Correção do backend para bloquear submissões finais fora da janela de `submission_start` e `submission_end`.
- Correção da lógica pública para ocultar botões de ação quando a etapa do cronograma não possui período configurado.
- Correção da ação de certificados de participação para só aparecer quando houver inscrição válida, autenticação e janela de certificados de participação aberta.
- Correção da consistência de navegação para exibir o botão `Sair` em vermelho nas páginas públicas acessadas por usuários autenticados.
- Correção do fluxo de login para evitar erro de renderização ao abrir a área do participante.
- Correção da inscrição pública para reutilizar corretamente a instituição do usuário autenticado.
- Correção do texto de sucesso e de inscrição já existente no fluxo de inscrição de participantes.
- Correção do salvamento de rascunhos para não exigir validação completa antes da submissão final.
- Correção da listagem de rascunhos na área do participante, incluindo contagem, retomada e atualização dos indicadores após exclusão.
- Correção da rota de atribuição de revisores, ajustando literais SQL para o SQLite.
- Correção da recomendação de revisores para usar a trilha do próprio artigo, e não a área geral do evento.
- Correção da navegação entre perfis para permitir que contas com múltiplos papéis acessem `/author`, `/reviewer` e `/admin/dashboard` a partir das interfaces correspondentes.

### Observações Técnicas

- O controle de período deixou de ser apenas visual. As rotas públicas de inscrição e submissão passaram a validar a janela diretamente no backend.
- A janela de certificados de participação já está modelada e controlada na interface pública, mas ainda não existe fluxo dedicado para emissão ou download.
- Rotas legadas sem uso, como `routes/assignments.js`, `routes/config.js` e `routes/reviewers.js`, podem ser removidas da base ativa juntamente com seus templates associados.
- A área administrativa do evento não possui mais a página `stats`; a visão consolidada permanece em `Relatórios`.

## 2026-07-28

### Documentação

- `submissao.md` consolidado como especificação técnica do estado atual do produto.
- `submissao_log.md` mantido como histórico técnico incremental do projeto.
- Documentação atualizada para refletir inscrições, áreas múltiplas por evento, subsídio e métricas de participação.

### Implementações

- Página administrativa por evento implementada para listagem e análise dos pedidos de subsídio.
- Leitura administrativa dos documentos de subsídio implementada com acesso aos PDFs anexados no cadastro do participante.
- Fluxo administrativo de aprovação e reprovação de pedidos de subsídio implementado com persistência de status, observações e autor da análise.
- Fluxo de revisão ajustado para usar `assignments` e `reports` como fonte de verdade no painel do revisor.
- Regra real de período de submissão aplicada com base em `submission_start` e `submission_end`.
- Exibição do e-mail do usuário autenticado adicionada nas áreas principais do painel administrativo e do painel do revisor.
- Controle de visibilidade de senha adicionado aos principais formulários com campo de senha.
- Página `/admin/users` alterada para trabalhar com salvamento único em lote de perfis e status.
- Interface de gestão de usuários refinada para separar claramente `Revisor` de `Conta ativa`.
- Badge visual adicionado para identificar revisor inativo na tela de usuários.
- Área do evento alterada para suportar múltiplas áreas/trilhas por evento e reutilização dessas áreas na submissão de artigo.
- Campo de subsídio a participantes adicionado ao cadastro de eventos.
- Fluxo público de inscrição de participantes por evento implementado com persistência em `event_registrations`.
- Sincronização automática de inscrição quando participante submete artigo no evento, promovendo `listener` para `author` quando aplicável.
- Dashboard administrativo ampliado com métricas de inscritos totais, autores e participantes.
- Lista de eventos e estatísticas por evento ampliadas com contadores de participantes.
- Relatório do evento ampliado com estatísticas de participantes, inscritos com artigo e listagem de participantes.
- Relatório do evento passou a listar nome, e-mail, órgão e situação da participação.
- Página do participante consolidada para usuários autenticados sem perfil administrativo, incluindo revisores que também submetem artigos, com listagem de eventos publicados, participações, rascunhos e submissões.
- Página `/author/profile` criada para edição dos dados cadastrais do participante.
- Navegação do fluxo `/author` mantida também para contas administrativas com múltiplos perfis, preservando o autoacompanhamento de participações e submissões no mesmo cadastro.
- Botão de impressão do relatório implementado com layout otimizado para exportação em PDF via navegador.
- Lista padronizada de países adicionada aos formulários com campo de país.
- Fluxo de cancelamento de inscrição de participante sem artigo implementado na área do participante até o dia anterior ao início do evento.
- Fluxo de subsídio na inscrição do evento implementado com dados acadêmicos, ID Lattes e upload de histórico escolar, carta de motivação e carta de recomendação.

### Correções

- Correção do cadastro e da edição de revisores para preservar perfis múltiplos no mesmo usuário, sem remover papel administrativo existente.
- Correção da atribuição administrativa para permitir múltiplos revisores no mesmo artigo quando necessário.
- Correção das estatísticas e do relatório do evento para não contar rascunhos como submissões efetivas.
- Correção da separação entre artigos pendentes e artigos revisados no dashboard do revisor.
- Correção da lógica pública de abertura e fechamento da janela de submissão.
- Correção da interface pública para não exibir status de submissão quando o evento não possui janela de submissão configurada.
- Correção do parsing de flags de usuários para persistir corretamente valores ativados e desativados.
- Correção da contagem de `Revisores Ativos` no dashboard administrativo.
- Correção da contagem de `Revisores Inativos` no dashboard administrativo.
- Correção do ícone de mostrar ou ocultar senha para alternar visualmente com o estado do campo.
- Correção do erro público em `/evento/:id` causado por uso incorreto de aspas nas queries SQLite.
- Correção do erro em `/submeter/:eventId` causado por comparação SQL inválida com string vazia.
- Correção do fluxo de exclusão de evento em `Editar Evento`, removendo formulário aninhado.
- Correção da origem das opções de `Eixo Temático / Trilha`, agora limitadas às áreas do próprio evento.
- Correção da lógica pública de status de submissão para diferenciar `submissão fechada` de `evento sem submissão configurada`.
- Correção da página do participante para listar todos os eventos publicados, e não apenas eventos com submissão aberta.
- Correção da exibição do período do evento na home pública para mostrar início e fim quando disponíveis.
- Correção do botão de impressão do relatório, substituindo `onclick` inline por listener explícito.
- Correção do erro ao salvar edição de evento, com migração das colunas `institution` e `language` na tabela `events`.
- Validação adicionada para impedir `date_end < date_start` e `submission_end < submission_start` no cadastro e na edição de eventos.
- Validação de CPF aplicada também no perfil do participante em `/author/profile`.

### Observações Técnicas

- A rota `POST /admin/users/bulk-update-flags` passou a ser o fluxo principal de persistência de perfis na listagem de usuários.
- Endpoints legados de toggle individual continuam presentes no backend, mas a interface principal não depende mais deles.
- O sistema continua exigindo reinício do servidor para refletir alterações em rotas e templates.
- A métrica de inscritos por evento agora diferencia participantes sem artigo de participantes com submissão.
- A tabela `event_registrations` passou a ser a fonte de verdade para participação explícita em evento.
- A tabela `event_registrations` passou a armazenar também os dados da candidatura a subsídio, quando aplicável.

### Pendências Conhecidas

- Auditoria de deliberação final com histórico persistente.

### Minhas observações do a fazer


- Deve haver distinção entre Participantes Presenciais / Remotos?
- Internacionalização
- Mandar emails
- Quando implementar envio de email, colocar "Master switch" para ligar/desligar envio de email na fase de desenvolvimento
- http://127.0.0.1:3000/admin/dashboard -> Não tem um contador do número total de usuários do sistema
- A lógica de que um usuário admin e admin de todo o sistema não é boa. o usuário deve ser admin apenas dos eventos que ele cria ou que outro admin designe a ele
- Chat durante o evento (mostrando o vídeo do Youtube na interface)
- Na página de relatório de Evento, deve haver a opção de exportação de arquivo .md, a fim de ser avaliado por uma IA
- Implementar uma forma de a partir do PDF com as informações do Evento, puplicar como se fosse o site do Evento. Últil para eventos pequenos ou que não tem a capacidade de fazer um site especifico
- Deve tar alguma lógica para um evento que não terá incrições pelos usuários, apenas pela administração do evento
