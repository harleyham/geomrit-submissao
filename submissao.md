# Sistema de Gestão de Eventos, Artigos, Presença e Certificados

## Visão Geral

Aplicação web para gestão de eventos acadêmicos e científicos, com inscrição de participantes, submissão de artigos, revisão, controle de presença e emissão de certificados de participação.

Versão atual do projeto: **V0.1**.

Data de referência desta especificação: **14/08/2026**.

## Objetivo do Produto

O sistema deve permitir:

1. Gerenciar eventos, como cursos, seminários, escolas de verão e atividades correlatas.
2. Receber, organizar e analisar submissões de artigos científicos.
3. Registrar participantes por evento, incluindo participantes sem artigo, autores e apresentadores.
4. Gerenciar listas de presença vinculadas aos eventos.
5. Gerenciar e emitir certificados de participação.
6. Gerenciar usuários com múltiplos perfis no mesmo cadastro.
7. Atribuir artigos a revisores e registrar pareceres com recomendação.
8. Consolidar apoio à deliberação final administrativa por evento.

## Stack Atual

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js + Express |
| Banco de dados | SQLite (`better-sqlite3`) |
| Renderização | EJS |
| Sessão | `express-session` |
| Segurança | `helmet`, `bcryptjs` |
| Upload | `multer` |
| Certificados em PDF | `pdfkit` |
| Infra complementar | `compression`, `method-override`, `archiver` |

## Escopo Funcional Implementado

### Administração

- Login unificado por e-mail e senha.
- Dashboard com estatísticas gerais.
- Dashboard com cards e listas de pendências para artigos sem revisor, em análise, prontos para deliberação final, pedidos de subsídio e solicitações de cadastro.
- Dashboard com contadores `Total de Usuários`, `Eventos Realizados` e `Inscritos em Eventos Futuros`.
- CRUD de eventos.
- Encerramento de evento publicado por ação explícita (status `encerrado`), com badge âmbar e botão "Encerrar" na listagem administrativa.
- Configuração de múltiplas áreas/trilhas por evento.
- Configuração explícita de evento com ou sem submissão de artigos.
- Configuração de subsídio a participantes por evento.
- Acompanhamento de inscrições, participação e elegibilidade para certificados de participação por evento.
- Gestão de usuários em `/admin/users`.
- Atualização em lote de perfis e status de usuários.
- Visualização administrativa da área de participante de um usuário.
- Visualização de artigos por evento.
- Página administrativa do artigo com leitura dos pareceres já enviados.
- Atribuição de revisores com sugestão por trilha/área do artigo.
- Deliberação final administrativa na própria página do artigo, com definição de status e modalidade `oral` ou `poster`.
- Relatórios por evento com consolidação de pareceres.
- Página administrativa por evento para analisar pedidos de subsídio, ler documentos anexados e registrar aprovação ou reprovação.
- Impressão do relatório do evento em PDF pelo navegador.
- Seleção de seções do relatório antes da impressão em PDF.
- Gestão administrativa de participantes por evento, com criação de conta, inscrição, edição e remoção condicionada.
- Importação de participantes via CSV, XLS ou XLSX, com auto-detecção de delimitador (vírgula ou ponto-e-vírgula), compatibilidade com quebras de linha Windows (CRLF) e Unix (LF), detecção flexível de colunas (nome, e-mail, instituição, telefone, CPF, passaporte), criação ou atualização de contas, senha temporária e resumo do processamento.
- Duas rotas de importação distintas: por evento (`/admin/events/:id/import-users`) cria usuários e inscreve no evento; por usuários (`/admin/users/import`) cria apenas usuários sem inscrição.
- Relatório detalhado pessoa por pessoa na importação, com status individual (Sucesso, Falha, Ignorado), descrição detalhada e download em CSV.
- Modelo CSV vazio com cabeçalho pré-preenchido disponível para download nas páginas de importação.
- Seleção explícita das atividades na inscrição pública ou administrativa, com edição posterior pelo participante em `/evento/:id/atividades` ou pelo administrador no cadastro da participação.
- Controle de presença simples por evento e chamada por atividade, com ações explícitas para marcar, atualizar ou remover presença.
- Download em lote dos PDFs submetidos em arquivo ZIP por evento.
- Configuração de certificados por evento e por papel, com elegibilidade por presença no papel correspondente ou, para revisores, por parecer enviado; emissão, reemissão versionada e download autenticado em PDF.
- Biblioteca administrativa de fundos PNG/JPEG para certificados, com seleção de fundo existente ou upload de novo arquivo.
- Reset total do banco de dados (`/admin/db/reset`) via painel admin, acessível **exclusivamente** para `admin@admin.com`. Apaga todas as tabelas, arquivos de upload (artigos, certificados, fundos) e recria o banco limpo com schema, indexes, triggers e seed do administrador padrão. Necessário reinício do servidor para recarregar a conexão.
- Middleware `requireSuperAdmin` em `security/super-admin.js` que restringe funcionalidades sensíveis ao `admin@admin.com`. Usuários com perfil de administrador em eventos são bloqueados com 403.
- Fluxo de aprovação de usuários corrigido: ao aprovar um cadastro (`/admin/users/:id/approve`), o sistema agora redefine `password_changed = 0` e `profile_completed = 0`, obrigando o usuário a trocar a senha e completar o perfil no primeiro login.
- Correção crítica: `method-override('_method')` movido para antes do `express.urlencoded` no `server.js`, permitindo que formulários com `_method=DELETE` funcionem corretamente para exclusão de usuários.
- Correção na função `updateUser`: se o campo `name` não for enviado pelo formulário de edição, o valor existente do banco é preservado, evitando erro `NOT NULL constraint failed`.
- Correção do formulário de cadastro público: `validateAndHandle` agora recebe `...v.registration` (spread operator) em vez de `v.registration` como array, resolvendo `TypeError: v.run is not a function`.
- Middleware `validateAndHandle` agora inclui `.catch()` para evitar requisições penduradas quando Promise rejections ocorrem.
- Partial `csrf-inject` adicionado ao formulário de criação/edição de eventos (`views/admin/events/form.ejs`), resolvendo erro de token CSRF ao criar eventos.
- Handler global de `unhandledRejection` adicionado ao `server.js` para capturar e logar Promise rejections não tratadas.
- Removidos campos duplicados de `_method=DELETE` nos formulários de exclusão de usuários.

### Revisão

- Login pelo fluxo unificado.
- Dashboard do revisor.
- Lista de artigos pendentes baseada em `assignments` sem `reports`.
- Lista de artigos revisados baseada em `reports`.
- Envio de parecer com recomendação individual, sem deliberação final automática do artigo.
- Navegação cruzada para a área do participante e o dashboard admin quando o usuário acumula perfis.

### Público

- Listagem de eventos publicados.
- Página pública do evento com URL destacada e tabela de cronograma por etapa.
- Inscrição pública de participante sem artigo, vinculada a conta autenticada.
- Seleção das atividades durante a inscrição e manutenção posterior em `/evento/:id/atividades`; atividades com presença registrada não podem ser removidas. Para atividades com etapas, o card de cada atividade mostra quantas presenças o participante já tem e quais etapas foram frequentadas (ex.: "3 de 5 presenças — Aula 1 · Aula 2 · Aula 3").
- Submissão de artigo com geração de código de acesso.
- Página do participante em `/author` para acompanhar inscrições, participações, rascunhos e submissões, inclusive em contas com perfil de revisor.
- Perfil do participante em `/author/profile` com atualização de dados cadastrais (nome, e-mail, instituição, CPF, passaporte, país, telefone), formação acadêmica e troca opcional de senha.
- Área do participante acessível também a contas com múltiplos perfis, com atalhos para revisão e administração quando aplicável.
- Página pública de evento encerrado permanece acessível (detalhes e certificados), com aviso de encerramento; inscrição e submissão ficam bloqueadas.
- Consulta de submissão por código.
- Consulta por código com andamento agregado da avaliação, sem expor um único revisor como responsável oficial.
- Verificação pública de certificados emitidos pelo respectivo código.
- Exibição pública de revisores ativos.
- Fluxo de participação conectado às atividades, chamadas e certificados: para participante, somente atividades com inscrição e presença são contabilizadas.
- Registro de presença por QR Code: a folha impressa por etapa (ou atividade sem etapas) contém um QR Code que abre a página `/presenca/:eventId/:activityId(/:sessionId)`; o usuário autenticado escolhe o papel exercido e marca a própria presença, no dia da etapa (ou no período da atividade, quando não houver etapas).

## Perfis, Acesso e Sessão

### Usuário unificado

Todos os usuários estão na tabela `users`. Um mesmo registro pode acumular mais de um perfil.

Flags legadas de permissão no cadastro global:

- `is_admin`
- `is_reviewer`
- `is_public`
- `approval_status`
- `approved_at`
- `approved_by`

O usuário possui um único cadastro e login. Os papéis de atuação são contextuais ao evento e ficam em `event_user_roles`: `admin`, `participant`, `reviewer`, `speaker`, `teacher`, `oral_presenter` e `poster_presenter`. O administrador só visualiza e administra os eventos em que recebeu o papel `admin`; ao criar um evento, recebe esse papel automaticamente. As flags históricas `is_admin` e `is_reviewer` são preservadas apenas para compatibilidade e migração da base existente.

### Regras de acesso

- `is_admin = 1`: acesso ao painel administrativo.
- `is_reviewer = 1`: acesso ao painel do revisor.
- `is_public = 1`: conta habilitada para autenticação.
- `is_admin = 1` e `is_reviewer = 1`: após login, o redirecionamento prioriza `/admin/dashboard`.
- `is_reviewer = 1` e `is_public = 0`: usuário continua marcado como revisor, mas fica inativo para login.

### Sessão

A sessão persiste:

- `userId`
- `userName`
- `userEmail`
- `userRoles`
- `isAdmin`
- `isReviewer`

Quando o usuário está autenticado, a interface deve exibir ação explícita de logout (`Sair`) nas páginas navegáveis do fluxo correspondente.

## Modelo de Dados Principal

### `users`

- `id`
- `name`
- `email`
- `password`
- `cpf`
- `passport`
- `country`
- `institution`
- `phone`
- `reviewer_areas`
- `is_admin`
- `is_reviewer`
- `is_public`
- `password_changed`
- `profile_completed`
- `created_at`
- `updated_at`

### `events`

- `id`
- `name`
- `short_name`
- `description`
- `date_start`
- `date_end`
- `location`
- `url`
- `area`
- `has_article_submission`
- `offers_subsidy`
- `registration_start`
- `registration_end`
- `status`
- `institution`
- `language`
- `submission_start`
- `submission_end`
- `review_start`
- `review_end`
- `certificates_start`
- `certificates_end`
- `created_at`
- `updated_at`

### `articles`

- `id`
- `event_id`
- `title`
- `title_en`
- `area`
- `authors`
- `authors_json`
- `abstract`
- `keywords`
- `pdf_path`
- `file_original_name`
- `contributor`
- `affiliation`
- `city`
- `email_submission`
- `submitter_user_id`
- `access_code`
- `type`
- `status`
- `funding`
- `blind_review_confirmed`
- `ethics_confirmed`
- `publication_authorized`
- `presentation_needs`
- `date_submitted`
- `created_at`
- `updated_at`

### `event_registrations`

- `id`
- `event_id`
- `user_id`
- `name`
- `email`
- `institution`
- `phone`
- `registration_type`
- `subsidy_requested`
- `student_level`
- `student_course`
- `student_institution_name`
- `student_institution_state`
- `student_lattes_id`
- `subsidy_status`
- `subsidy_review_notes`
- `subsidy_reviewed_at`
- `subsidy_reviewed_by`
- `academic_history_pdf_path`
- `academic_history_original_name`
- `motivation_letter_pdf_path`
- `motivation_letter_original_name`
- `recommendation_letter_pdf_path`
- `recommendation_letter_original_name`
- `created_at`
- `updated_at`

### `participant_audit_logs`

- `id`
- `event_id`
- `registration_id`
- `actor_user_id`
- `action`
- `details`
- `created_at`

### `attendance_records`

- `id`
- `event_id`
- `registration_id`
- `marked_by`
- `attended_at`
- `notes`
- `created_at`
- `updated_at`

### `event_activities`

- `id`
- `event_id`
- `name`
- `activity_type`
- `date_start` / `date_end` — intervalo da atividade (a coluna `activity_date` é legada, mantida apenas por compatibilidade; os dados foram migrados para `date_start`)
- `workload_hours` — carga horária total (usada quando a atividade não tem etapas)
- `certificate_enabled`

### `activity_sessions`

Etapas de uma atividade (ex.: aulas de um minicurso, períodos de um seminário). A presença é registrada por etapa.

- `id`
- `activity_id`
- `name` — ex.: "Aula 1", "Período da manhã"
- `sequence_no` — ordem de exibição/chamada
- `session_date` — data da etapa (validada contra o intervalo da atividade)
- `workload_hours` — carga horária da etapa
- `created_at`

### `activity_attendance_records`

- `id`
- `activity_id`
- `registration_id`
- `user_id`
- `role`
- `session_id` — etapa presente (`NULL` quando a atividade não tem etapas, equivalendo a uma única etapa geral)
- `marked_by`
- `attended_at`

Único por pessoa por etapa: um índice parcial garante no máximo um registro por `(activity_id, user_id)` com `session_id` nulo e por `(activity_id, session_id, user_id)` com etapa definida.

### `participant_activity_enrollments`

Registra em quais atividades cada participante está inscrito. Este vínculo é diferente da presença: inscrição define quem deve constar na chamada; presença comprova o comparecimento e o papel efetivamente exercido.

- `id`
- `activity_id`
- `registration_id`
- `user_id`
- `enrolled_by`
- `created_at`
- `updated_at`

### `activity_certificate_rules`

Estrutura legada preservada para compatibilidade com bases existentes. O fluxo atual centraliza mínimo de presenças, fundo, cor e texto em `event_certificate_rules`, por papel de certificado.

- `activity_id`
- `min_attendance`
- `background_id`

### `certificate_backgrounds`

- `id`
- `name`
- `file_path`
- `original_name`
- `mime_type`
- `created_by`
- `created_at`

Os fundos padrão distribuídos pelo sistema ficam em `assets/Fundos` e são registrados automaticamente na biblioteca quando a aplicação inicia. Fundos enviados pela administração ficam separadamente em `uploads/certificate-backgrounds`. No seletor da regra de certificado, ambas as origens ficam disponíveis e são exibidas em grupos distintos.

### `certificate_rules`

- `event_id`
- `min_attendance`
- `background_id`
- `updated_by`
- `created_at`
- `updated_at`

### `certificate_emissions`

- `id`
- `event_id`
- `registration_id`
- `background_id`
- `certificate_code`
- `version`
- `attendance_count`
- `participant_name`
- `event_name`
- `event_date_start`
- `event_date_end`
- `status`
- `issued_at`
- `issued_by`
- `reissued_from_id`
- `activity_id`
- `user_id`
- `certificate_role`
- `certificate_title`
- `certificate_body`
- `activities_attended`
- `total_workload_hours`
- `activities_summary`

### `event_user_roles`

Registra os papéis de administrador, participante, revisor, palestrante, professor e apresentador (oral ou pôster) de uma pessoa em um evento, com artigo opcionalmente vinculado. É a fonte de verdade para autorização administrativa por evento e para papéis manuais de certificado.

### `event_certificate_rules`

Configura fundo, cor, título, texto e regra de elegibilidade para cada tipo de certificado em cada evento.

- `event_id`
- `certificate_role`
- `min_attendance` (percentual 0-100 de presença mínima; default 75; revisor usa 0 e a elegibilidade segue o critério de parecer)
- `background_id`
- `text_color`
- `title`
- `body_text`
- `updated_by`
- `created_at`
- `updated_at`

### `assignments`

- `id`
- `article_id`
- `reviewer_id`
- `status`
- `reviewed_at`
- `created_at`
- `updated_at`

### `reports`

- `id`
- `assignment_id`
- `score`
- `report`
- `recommendation`
- `created_at`
- `updated_at`

## Regras de Negócio

### Eventos e submissão

- Apenas eventos com `status = 'published'` aparecem na listagem pública inicial.
- O status `encerrado` é um terceiro estado explícito (além de `draft` e `published`), atribuído por ação administrativa (`POST /admin/events/:id/close`), somente a partir do estado `published`.
- O cronograma público do evento é organizado por `Inscrições`, `Submissão Artigos`, `Análise Submissão`, `Evento` e `Certificados`.
- Cada etapa do cronograma pode ter período próprio configurado na administração do evento.
- A submissão pública depende da janela configurada em `submission_start` e `submission_end`.
- Eventos com `has_article_submission = 0` não exibem linhas de submissão e análise no cronograma público.
- A inscrição pública depende da janela configurada em `registration_start` e `registration_end`.
- A área de certificados de participação depende da janela configurada em `certificates_start` e `certificates_end`.
- Um evento sem `submission_start` e `submission_end` não é tratado como submissão fechada, mas como evento sem submissão de artigos configurada.
- Quando uma etapa do cronograma não possui janela configurada, a página pública do evento não exibe botão de ação para essa etapa.
- Antes de `submission_start`, a submissão fica bloqueada.
- Depois de `submission_end`, a submissão fica bloqueada.
- Antes de `registration_start`, a inscrição fica bloqueada.
- Depois de `registration_end`, a inscrição fica bloqueada.
- Antes de `certificates_start`, o acesso aos certificados de participação fica bloqueado.
- Depois de `certificates_end`, o acesso aos certificados de participação fica bloqueado.
- O campo `area` do evento suporta múltiplas áreas ou trilhas, persistidas em `TEXT` normalizado e reutilizadas no formulário de submissão.
- O formulário de submissão só apresenta áreas definidas no evento selecionado.
- O participante só pode submeter artigo se estiver autenticado e já inscrito no evento.
- Rascunhos podem ser salvos na área do participante, mas não contam como submissão efetiva nas métricas e relatórios.
- Rascunhos podem ser salvos sem preenchimento completo dos campos obrigatórios; a validação integral ocorre apenas na submissão final.
- O participante pode continuar a edição ou apagar rascunhos diretamente na área `/author`.
- O evento pode registrar se oferece subsídio a participantes por meio de `offers_subsidy`.
- Quando `offers_subsidy = 1`, a inscrição do participante pode incluir candidatura a subsídio financeiro.
- Ao solicitar subsídio, o participante deve informar nível acadêmico, curso, instituição de vínculo, UF da instituição e ID Lattes com 16 dígitos.
- Ao solicitar subsídio, o participante deve anexar histórico escolar, carta de motivação e carta de recomendação em PDF, com limite de 10 MB por arquivo.
- Pedidos de subsídio ficam disponíveis apenas para administradores, com status de análise (`pending`, `approved`, `rejected`), leitura dos anexos e registro de observações.
- Na criação e edição do evento, `date_end` não pode ser anterior a `date_start`.
- Na criação e edição do evento, `registration_end` não pode ser anterior a `registration_start`.
- Na criação e edição do evento, `submission_end` não pode ser anterior a `submission_start`.
- Na criação e edição do evento, `review_start` só pode ocorrer após o fim de `submission_end`.
- Na criação e edição do evento, `review_end` não pode ser anterior a `review_start`.
- Na criação e edição do evento, `certificates_end` não pode ser anterior a `certificates_start`.

### Usuários

- O cadastro administrativo permite criar usuários com perfil de admin e/ou revisor.
- O cadastro administrativo de revisor permite informar áreas de atuação em `reviewer_areas`.
- O cadastro público gera usuário pendente de aprovação administrativa.
- A troca de senha é obrigatória no primeiro acesso quando `password_changed = 0`.
- Contas novas possuem `profile_completed = 0` e, depois de trocar a senha, devem completar identificação, país, instituição, telefone e formação acadêmica antes de acessar qualquer painel.
- A formação acadêmica possui a opção especial `Não possui curso de graduação`, disponível em todas as áreas de formação; quando selecionada, os campos Titulação e Status ficam ocultos e são gravados como nulos.
- A migração preserva contas anteriores como perfil completo; o bloqueio é aplicado às novas contas administrativas, importadas, criadas na inscrição administrativa e solicitadas pelo cadastro público.
- Administrador pode resetar a senha de outro usuário.
- A tela `/admin/users` separa papel no sistema e status de conta.
- O conceito de `Revisor` é independente do conceito de `Conta ativa`.
- Deve existir pelo menos uma conta ativa com perfil de administrador.
- A conta administrativa padrão não deve ser excluída.

### Dashboard administrativo

- `Revisores Ativos` conta usuários com `is_reviewer = 1` e `is_public = 1`.
- `Revisores Inativos` conta usuários com `is_reviewer = 1` e `is_public = 0`.
- `Usuários Pendentes` conta registros com `approval_status = 'pending'`.
- `Sem Revisor` conta artigos sem designação em `assignments`.
- `Em Análise` conta artigos com revisor atribuído e ao menos um parecer ainda pendente.
- `Prontos para Deliberação` conta artigos com todos os pareceres atribuídos já concluídos e sem deliberação final administrativa.
- `Inscritos` considera participantes registrados por evento.
- `Inscritos Autores` considera participantes distintos com submissão não rascunho.
- `Inscritos Participantes` considera registros `listener` em `event_registrations`.
- `Total de Usuários` conta todos os registros da tabela `users`.
- `Eventos Realizados` conta eventos com `date_end` anterior à data de hoje (horário do Brasil, UTC-3).
- `Inscritos em Eventos Futuros` conta registros de inscrição em eventos com `date_start` igual ou posterior à data de hoje (horário do Brasil, UTC-3).

### Relatórios de evento

- O relatório do evento consolida estatísticas de artigos e participantes.
- O relatório exibe `Inscritos com Artigo` como participantes distintos, mesmo quando uma mesma pessoa possui múltiplos artigos.
- O relatório exibe `Inscritos Participantes`.
- O relatório lista participantes com nome, e-mail, órgão/instituição e situação de participação.
- O relatório pode ser impresso/exportado para PDF por meio da impressão do navegador.
- Antes da impressão, a administração pode marcar quais seções do relatório serão incluídas no PDF.
- A listagem administrativa de artigos permite baixar, em um único arquivo ZIP, os PDFs submetidos de um evento.

### Revisão

- O dashboard do revisor usa `assignments` e `reports` como fonte de verdade.
- Uma atribuição sem relatório associado é considerada pendente.
- Um artigo revisado é identificado pela existência de `report`, não apenas pelo `status` de `articles`.
- Ao registrar parecer, o sistema atualiza a atribuição e o relatório e mantém o artigo em análise até a deliberação final administrativa, salvo se ele já possuir status final anterior.
- Um mesmo artigo pode possuir múltiplos revisores oficialmente, por meio de múltiplos registros em `assignments`.
- A recomendação do revisor (`approved`, `rejected`, `revision_requested`) representa parecer individual e não deliberação final do artigo.
- A interface administrativa de designação destaca revisores compatíveis com a trilha do artigo com base em `reviewer_areas`.

### Deliberação final

- A aprovação ou reprovação oficial do artigo é resultado da deliberação final administrativa.
- A deliberação final administrativa pode ser registrada em `/admin/reports` e também diretamente na página do artigo.
- A deliberação final permite alterar o `status` do artigo e ajustar a modalidade de apresentação entre `oral` e `poster`.
- Um artigo só deve ser considerado oficialmente `approved` ou `rejected` após ação administrativa explícita.

### Participação em evento

- Todo participante do evento deve estar associado a uma conta cadastrada no sistema.
- Participantes sem artigo são registrados em `event_registrations` com `registration_type = 'listener'`.
- Participantes que submetem artigo são registrados em `event_registrations` com `registration_type = 'author'`.
- Usuários com perfil de revisor e/ou administrador também podem acessar a própria área de participante e submeter artigos.
- Se um participante sem artigo posteriormente submete artigo no mesmo evento, sua inscrição é promovida automaticamente para `author`.
- Um participante com múltiplos artigos conta uma única vez nas métricas de inscritos com artigo.
- O participante pode cancelar a inscrição sem artigo até o dia anterior ao início do evento.
- Inscrições já promovidas para `author` não podem ser canceladas pela área do participante.
- Quando o evento oferece subsídio, os dados e anexos da candidatura ficam vinculados à própria inscrição do evento.
- A administração pode criar, editar e remover inscrições manualmente. Toda inscrição manual possui conta vinculada: o admin seleciona uma conta ativa existente ou cria uma conta com senha temporária, obrigando a troca no primeiro acesso; uma inscrição com artigo submetido não pode ser removida diretamente.
- Na inclusão administrativa, quando o evento possui atividades, deve ser selecionada ao menos uma atividade. Os vínculos ficam em `participant_activity_enrollments` e podem ser alterados posteriormente no formulário de edição do participante.
- Na inscrição pública, o próprio participante seleciona as atividades e pode alterá-las depois em `/evento/:id/atividades`; uma atividade com presença já registrada não pode ser removida. O administrador mantém a mesma possibilidade de edição no cadastro do participante.
- Há unicidade por evento para e-mail normalizado e, quando informado, para a conta de usuário vinculada.
- Ao excluir administrativamente o último artigo submetido de uma pessoa no evento, a inscrição é preservada e reclassificada de `author` para `listener`; se ainda houver outro artigo submetido, ela permanece como `author`.
- Criações, edições, remoções manuais e a reconciliação decorrente da exclusão de artigo são gravadas em `participant_audit_logs`.
- A edição da participação administra somente dados da inscrição. Papéis são atribuídos exclusivamente na edição do usuário, após a seleção do evento.

### Presença

- A primeira versão registra uma presença por participante em cada evento.
- Apenas inscrições existentes em `event_registrations` podem receber presença.
- O lançamento é administrativo e registra usuário responsável, data/hora e observação opcional.
- Remover o registro de `attendance_records` devolve o participante à situação sem presença.
- O painel administrativo consolida inscritos, presentes, sem presença e o total individual de presenças no evento.
- O evento também pode conter atividades internas, como palestras, seminários, mesas-redondas e minicursos, com carga horária e presença próprias.
- A presença por atividade é registrada separadamente e permite que o mesmo participante esteja presente em várias atividades do mesmo evento.
- Na chamada da atividade, o administrador escolhe o papel exercido e utiliza ações explícitas para marcar, atualizar ou remover a presença. Alterar o seletor sozinho não grava presença.
- A chamada de uma atividade lista como participantes apenas as pessoas inscritas nela por `participant_activity_enrollments`; palestrantes, professores, revisores e apresentadores também podem aparecer por seus papéis próprios no evento.
- A presença simples por evento é identificada por pessoa (`user_id`) e não somente por inscrição: inclui participantes, revisores atribuídos, palestrantes, professores e apresentadores vinculados ao evento, sem duplicar a pessoa que acumula papéis.
- Cada atividade representa uma parte do evento e informa os papéis elegíveis. A presença é lançada por pessoa com o papel efetivamente exercido naquela atividade.
- `event_user_roles` declara os papéis atribuídos à pessoa no evento; `activity_attendance_records.role` registra a atuação efetiva. Marcar ou remover presença não cria nem remove papéis do evento.
- Uma pessoa só pode receber presença em papel que já possua no evento; `participant` decorre de sua inscrição em `event_registrations`.
- Uma atividade pode ser dividida em **etapas** (`activity_sessions`) — ex.: aulas de um minicurso ou períodos de um seminário. Quando existem etapas, a chamada, a lista de presença impressa e a carga horária do certificado passam a ser por etapa; a atividade sem etapas funciona como uma única etapa geral (registro com `session_id` nulo).
- Cada etapa tem data e carga horária próprias; a data da etapa é validada contra o intervalo de início/fim da atividade. A carga horária do certificado soma as cargas das etapas em que a pessoa esteve presente.
- Na página pública de atividades (`/evento/:id/atividades`), cada atividade com etapas exibe a contagem de presenças do usuário e a relação das etapas já frequentadas (em ordem de sequência); a inscrição de atividades frequentadas permanece preservada e não removível.
- O intervalo da atividade (`date_start`/`date_end`) substitui a data única anterior; a presença e a ordenação usam `date_start`.
- Atividades habilitadas para certificação são consolidadas por pessoa e por papel. Para o papel de participante, somente contam atividades em que coexistam inscrição e presença. Uma mesma pessoa pode receber certificados distintos de participante, palestrante, professor ou apresentador, cada um contendo apenas suas atividades e sua carga horária correspondentes.
- O certificado de revisor é a exceção: sua elegibilidade decorre de ao menos um parecer enviado no evento.
- A rota administrativa `/admin/events/:id/attendance` é o painel de chamadas: ela lista as atividades e direciona para a marcação de presença de cada uma. A presença geral não é usada para calcular carga horária nem elegibilidade de certificados.
- Presença por QR Code: o administrador imprime, por etapa (ou atividade sem etapas), uma folha letter com o QR Code do link de presença (`/presenca/:eventId/:activityId(/:sessionId)`). A origem do link vem do campo "URL do Evento" (apenas a origem da URL); sem URL configurada, usa o host de quem imprime. O registro é feito pelo próprio usuário na página pública: exige login (com retorno automático à página via `?next=`), e só é permitido no dia da etapa (ou no período da atividade, sem etapas), em UTC-3. Papéis aceitos: `participant` (exige inscrição no evento e vinculação à atividade), `speaker`, `teacher`, `oral_presenter` e `poster_presenter` (exigem o papel em `event_user_roles`). O registro grava em `activity_attendance_records` com `marked_by` = o próprio usuário e é idempotente por atividade + pessoa + etapa, integrando-se à chamada, à carga horária e à elegibilidade de certificados sem mudança de regra.

### Autenticação e senha

- Usuários inativos (`is_public = 0`) não conseguem autenticar.
- Os formulários com senha possuem controle visual para mostrar ou ocultar caracteres.
- Contas com perfil de revisor podem acessar `/author` e `/submeter/:eventId`, mantendo também o fluxo de revisão.
- Contas com múltiplos perfis mantêm redirecionamento prioritário para `/admin/dashboard`, mas a interface expõe links para `/reviewer` e `/author`.
- O botão `Sair`, em destaque vermelho, deve estar disponível nas páginas do usuário autenticado para encerramento imediato da sessão.

## Fluxos Principais

### Fluxo de atividades, presença e certificados

1. Admin cria o evento.
2. Admin cadastra e configura suas atividades em `/admin/events/:id/activities` (intervalo de datas, carga horária, papéis elegíveis). Para atividades divididas (minicurso, seminário), o admin adiciona as etapas em `/admin/events/:id/activities/:activityId/sessions`.
3. Participante seleciona as atividades durante a inscrição ou posteriormente em `/evento/:id/atividades`; o administrador pode editar os mesmos vínculos no cadastro do participante.
4. Admin acessa a chamada da atividade, seleciona a etapa (quando houver), o papel exercido e marca, atualiza ou remove a presença daquela etapa. Alternativamente, o admin imprime a folha de presença com QR Code da etapa; no dia, o usuário escaneia o código, autentica-se (se necessário) e marca a própria presença na página pública, no papel que exerce.
5. Admin acessa `/admin/events/:id/certificates` e emite os certificados elegíveis. A elegibilidade é calculada atividade a atividade, por papel: apresentações oral/pôster e mesas-redondas qualificam a pessoa com qualquer presença registrada; palestras, seminários, minicursos e outras atividades com etapas exigem presença em pelo menos o percentual configurado em "Presença mínima (%)" das etapas da atividade (atividade sem etapas qualifica com qualquer presença). Para o papel de participante, cada atividade contabilizada precisa estar certificável e possuir inscrição e presença. Somente atividades qualificadas entram no certificado e na carga horária, que é a soma das etapas presentes (ou a carga da atividade, quando sem etapas). A pessoa é elegível quando possui ao menos uma atividade qualificada no papel (revisor: ao menos um parecer).

### Fluxo operacional de artigos

1. Admin cria evento.
2. Admin publica evento.
3. Participante autenticado pode se inscrever no evento como participante dentro da janela de inscrições.
4. Público autenticado e já inscrito submete artigo dentro da janela permitida.
5. Sistema cria artigo com `status = 'pending'`.
6. Sistema registra ou promove a participação do inscrito para `author`.
7. Admin atribui revisor.
8. Sistema cria `assignment` e move o artigo para `in_review`.
9. Revisor envia parecer.
10. Sistema grava ou atualiza `report`.
11. Admin acompanha os relatórios e define o status final do artigo.

### Fluxo de autenticação

1. Usuário acessa `/login`.
2. Sistema valida e-mail e senha na tabela `users`.
3. Sistema bloqueia login para `is_public = 0`.
4. Sistema monta a sessão conforme as flags do usuário.
5. Se `password_changed = 0`, redireciona para `/login/change-password`.
6. Se `is_admin = 1`, redireciona para `/admin/dashboard`.
7. Caso contrário, se `is_reviewer = 1`, redireciona para `/reviewer`.
8. Caso não seja admin nem revisor, redireciona para `/author`.

## Rotas Principais

### Públicas

| Rota | Finalidade |
|------|------------|
| `/` | Página inicial com eventos publicados |
| `/evento/:id` | Detalhes do evento |
| `/evento/:id/inscricao` | Inscrição do participante no evento |
| `/submeter/:eventId` | Formulário de submissão |
| `/author` | Página do participante |
| `/author/profile` | Perfil do participante: dados cadastrais, formação acadêmica e troca de senha |
| `/author/certificates` | Consulta e download autenticado de certificados emitidos |
| `/evento/:id/atividades` | Seleção e edição, pelo participante, das atividades em que está inscrito; exibe contagem de presenças e etapas frequentadas por atividade |
| `/presenca/:eventId/:activityId` | Registro de presença por QR Code em atividade sem etapas (exige login) |
| `/presenca/:eventId/:activityId/:sessionId` | Registro de presença por QR Code em etapa específica (exige login) |
| `/cadastro` | Solicitação de cadastro público |
| `/consultar` | Consulta por código |
| `/consultar-certificado` | Verificação pública de certificado por código |
| `/revisores` | Corpo de revisores |

### Autenticação

| Rota | Finalidade |
|------|------------|
| `/login` | Login unificado |
| `/login/change-password` | Troca obrigatória de senha |
| `/admin/logout` | Logout admin |
| `/reviewer/logout` | Logout revisor |

### Administração

| Rota | Finalidade |
|------|------------|
| `/admin/dashboard` | Dashboard administrativo |
| `/admin/events` | Gestão de eventos |
| `POST /admin/events/:id/close` | Encerra o evento (published → encerrado) |
| `/admin/events/:id/subsidies` | Análise administrativa dos pedidos de subsídio do evento |
| `/admin/events/:id/participants` | Gestão administrativa dos participantes do evento |
| `/admin/events/:id/import-users` | Importação de participantes via CSV, XLS ou XLSX (cria usuário + inscreve no evento) |
| `/admin/events/:id/import-template` | Download do modelo CSV vazio para importação de participantes |
| `/admin/events/:id/import-download-csv` | Download do relatório da importação em CSV (pessoa por pessoa) |
| `/admin/events/:id/import-result` | Resultado da importação com relatório detalhado |
| `/admin/users/import` | Importação de usuários via CSV, XLS ou XLSX (cria apenas usuário, sem inscrição) |
| `/admin/users/import-template` | Download do modelo CSV vazio para importação de usuários |
| `/admin/users/import/download-csv` | Download do relatório da importação em CSV (pessoa por pessoa) |
| `/admin/users/import/result` | Resultado da importação com relatório detalhado |
| `/admin/backup/download` | Download do backup completo em ZIP (banco + uploads), restrito ao `admin@admin.com` |
| `/admin/backup/restore` | Página de confirmação e upload para restauração de backup, restrita ao `admin@admin.com` |
| `/admin/events/:id/attendance` | Painel de chamadas por atividade do evento |
| `/admin/events/:id/activities` | Cadastro de atividades internas do evento |
| `/admin/events/:id/activities/:activityId/attendance` | Controle de presença da atividade |
| `GET /admin/events/:id/activities/:activityId/checkin-print?session_id=` | Folha letter de presença com QR Code por etapa (ou da atividade, sem etapas) |
| `/admin/events/:id/certificates` | Regras, fundos, emissão e reemissão de certificados |
| `/admin/articles` | Gestão de artigos |
| `/admin/articles/download-all?eventId=:id` | Download ZIP dos PDFs submetidos do evento |
| `/admin/articles/:id` | Detalhe do artigo com pareceres, atribuição de revisores e deliberação final |
| `/admin/users` | Gestão de usuários |
| `/admin/reports` | Relatórios e deliberação final |

### Revisão

| Rota | Finalidade |
|------|------------|
| `/reviewer` | Dashboard do revisor |
| `/reviewer/articles/:id` | Visualização do artigo |
| `/reviewer/articles/:id/review` | Submissão de parecer |

## Estrutura Técnica

```text
artigos/
├── server.js
├── db.js
├── uploads/
├── routes/
│   ├── auth.js
│   ├── events.js
│   ├── articles.js
│   ├── users.js
│   ├── reports.js
│   ├── reviewer.js
│   └── public.js
└── views/
```

Observações estruturais:

- A área do participante continua servida pela rota `/author`, embora hoje cubra participação no evento e submissões.
- O participante possui tela própria de atualização cadastral em `/author/profile`.
- A criação e a edição de eventos já contemplam todas as datas do cronograma público.
- Rotas e templates legados de configuração, distribuição, stats e reviewers foram removidos da aplicação ativa.

## Segurança e Operação

- Senhas armazenadas com hash `bcrypt`.
- Sessão com cookie `httpOnly` e `sameSite=lax`.
- `helmet` com CSP configurada.
- `compression` habilitado.
- `method-override` habilitado para formulários com `_method`.
- `archiver` utilizado para geração de ZIP em streaming no download em lote de artigos.

Variáveis de ambiente em uso:

| Variável | Finalidade | Padrão atual |
|----------|------------|--------------|
| `PORT` | Porta HTTP | `3000` |
| `SESSION_SECRET` | Chave de sessão | `edigemia-ligem-secret-2027` |

Observações operacionais:

- O sistema não possui hot reload nativo.
- Mudanças em rotas e templates exigem reinício do servidor.
- Os novos timestamps do sistema passaram a ser gravados em horário local do Brasil (`UTC-3`) nas rotas ativas.
- A seed padrão de administrador continua documentada no código atual com e-mail `admin@admin.com` e senha inicial `123456`.

## Status Atual

### Implementado

- Modelo unificado de usuários.
- Login unificado.
- Troca obrigatória de senha no primeiro acesso.
- Preenchimento obrigatório do perfil no primeiro acesso, após a troca de senha, com bloqueio de acesso aos painéis até a conclusão.
- Gestão administrativa de usuários.
- Atualização em lote de perfis e status em `/admin/users`.
- Distinção visual entre papel de revisor e conta ativa.
- Exibição do e-mail do usuário autenticado nas áreas principais do sistema.
- Autoatendimento de dados cadastrais do participante em `/author/profile`.
- Validação de CPF nos formulários administrativos e no perfil do participante.
- Combobox padronizado de países nos formulários públicos e administrativos.
- Fluxo de atribuição de revisores.
- Dashboard do revisor baseado em atribuições e pareceres.
- Dashboard administrativo com separação entre artigos sem revisor, em análise e prontos para deliberação final.
- Restrição de submissão por janela real de datas.
- Restrição de inscrição por janela real de datas.
- Restrição de acesso à área de certificados de participação conforme janela do evento.
- Eventos sem período configurado em uma etapa do cronograma não exibem botão de ação correspondente na página pública do evento.
- Cancelamento de inscrição de participante sem artigo antes do início do evento.
- Inscrição em evento com fluxo condicional de subsídio, incluindo dados acadêmicos e upload de documentos obrigatórios.
- Página pública do evento reorganizada em formato de cronograma com ações por etapa.
- Painel `/author` com cards clicáveis apenas para eventos futuros ainda disponíveis para participação.
- Painel `/author` com separação visual entre `Meus Rascunhos` e `Submissões Enviadas`, incluindo continuação e exclusão de rascunhos.
- Página administrativa do artigo com leitura expansível do texto dos pareceres enviados pelos revisores.
- Deliberação final administrativa na própria página do artigo, incluindo mudança de modalidade `Oral/Pôster`.
- Painel do revisor com separação visual entre `Meu Parecer` e `Aguardando deliberação final administrativa`.
- Modal customizado para confirmação de exclusão de artigos na listagem administrativa.
- Botão `Sair` padronizado nas páginas públicas autenticadas do participante e nas telas públicas acessadas com sessão ativa.
- Relatórios por evento com recomendações consolidadas.
- Controle visual de mostrar ou ocultar senha nos formulários principais.
- Navegação cruzada entre área do participante, painel do revisor e dashboard administrativo para usuários com múltiplos perfis.
- Gestão manual de participantes por evento, com criação de conta ou seleção de conta ativa existente, edição, remoção condicionada e auditoria.
- Importação administrativa de participantes via CSV, XLS ou XLSX, com auto-detecção de delimitador, detecção flexível de colunas, reconciliação de contas e relatório pessoa por pessoa com status e download em CSV.
- Painel administrativo de presença organizado por atividade, com acesso direto à chamada de cada parte do evento.
- Cadastro de atividades internas e lançamento manual por atividade, com botões para marcar, atualizar e remover presença; para participante, inscrição e presença compõem conjuntamente a elegibilidade e a carga horária do certificado.
- Certificados de participação com regra de elegibilidade por presença, fundo PNG/JPEG selecionável em miniatura (thumbnails ordenadas alfabeticamente), cor da fonte configurável por evento, prévia inline do certificado antes de salvar a regra, emissão e reemissão versionadas, geração de PDF com toda a fonte na cor selecionada e download autenticado pelo participante dentro da janela do evento.
- Certificados distintos por papel no evento: Participante, Revisor, Palestrante, Professor, Apresentador Oral e Apresentador Pôster, cada um com fundo, cor, título, texto, elegibilidade, emissão e reemissão próprios. A prévia dinâmica usa o fundo e a cor atualmente selecionados no formulário, sem exigir salvamento prévio.
- Botão "Salvar configuração geral" na página de certificados que replica a cor e o fundo selecionados em todos os tipos de certificado do evento, preservando título, texto e mínimo de presença individuais de cada papel.
- Botão "Visualizar original" na página de certificados do admin renderiza a prévia com as configurações salvas no banco sem modificar os campos do formulário, permitindo comparar o estado persistente com as edições não-salvas.
- Exportação em lote dos certificados emitidos em arquivo ZIP via botão laranja "Exportar todos os certificados emitidos" na página de certificados, com cada certificado como PDF individual nomeado por versão, participante e papel.
- Botão "Baixar" padronizado como `<button>` (classe `secondary`) na coluna de ações da tabela de certificados, sem sublinhado.
- Cores personalizadas para status de elegibilidade e emissão: "Elegível" em `#8AAD34` e "Emitido" em `#329542` (verde escuro) na coluna de elegibilidade dos certificados.
- Contador de certificados emitidos exibido ao lado do rótulo de cada papel de certificado (Participante, Revisor, Palestrante, Professor, Apresentador Oral, Apresentador Pôster).
- Estatística de certificados emitidos incluída no card "Estatísticas do Evento" da página de relatórios do administrador (`/admin/reports?eventId=:id`).
- Padronização da topbar nas views públicas (`event.ejs`, `event-certificates.ejs`): classes `btn-secondary` e `btn-logout` unificadas com `submit.ejs`, CSS `.topbar-nav` com `gap:0.4rem; align-items:center; flex-wrap:wrap` e hover com fundo sutil.
- Botões "Editar" e "Presença" (antes "Fazer chamada") na listagem de atividades (`/admin/events/:id/activities`), estilizados como botões sem sublinhado.
- Atividades cadastradas listadas em cards separados por tipo de atividade (Palestra, Seminário, Mesa-redonda, Minicurso, Apresentação oral, Apresentação pôster, Outra), com badges de cor distintos para cada tipo e ordenação alfabética por nome.
- O PDF informa a carga horária consolidada em `hora-aula` ou `horas-aula` somente quando as atividades vinculadas ao certificado totalizam valor maior que zero.
- Texto do corpo do certificado de Professor configurado para aceitar `{atividade}` como substituição pelo nome da atividade ministrada, além do `{event}` pelo nome do evento.
- Seção "Atividades do evento" na página de certificados administrativos com cards separados por tipo de atividade, cards de estatísticas (total de atividades, inscrições vinculadas, presenças registradas) e link de acesso à gestão completa de atividades.
- Emissão em lote dos certificados elegíveis ainda não emitidos.
- Seleção individual das seções incluídas na impressão do relatório em PDF.
- Download em lote dos PDFs submetidos por evento em arquivo ZIP.
- Enxugamento técnico: remoção de rotas individuais legadas de perfis, redirecionamentos de login do revisor, fallback duplicado de eventos, dependência direta não utilizada e colunas antigas de revisão em `articles`.
- Exibição do status do subsídio na página do participante (`/author`): coluna condicional "Subsídio" com badge colorido indicando `Pendente`, `Aprovado` ou `Rejeitado` na tabela de participações, aparecendo apenas quando o usuário possui solicitações de subsídio vinculadas.
- Topbar unificada na página de certificados de participante (`/evento/:id/certificates`): exibe o e-mail da conta logada e o botão "Sair" em vermelho, seguindo o mesmo padrão das demais páginas públicas autenticadas.
- Verificação pública de certificados em `/consultar-certificado`, apresentando dados da emissão somente quando o código informado corresponde a uma emissão válida.
- Correção de renderização na visualização administrativa da área do participante (`/admin/users/:id/participant`): prop `showSubsidyStatus` agora é passada ao template, eliminando erro de renderização EJS.
- Vinculação de atuação por atividade no controle de presença: o dropdown apresenta apenas papéis elegíveis que a pessoa já possui no evento, enquanto botões separados marcam, atualizam ou removem a presença; a operação não altera `event_user_roles`.
- Reescrita da página de presença por atividade com layout topbar/Inter, stats cards (presentes/ausentes/total), tabela com perfis no evento e role na atividade, e validação server-side dos papéis aceitos.
- Correção de coluna ambígua na query de presença por atividade: alias `person_user_id` eliminou erro "ambiguous column name: user_id" causado pela junção de `event_registrations`, `event_user_roles` e `activity_attendance_records`.
- Cadastro de formação acadêmica no formulário de usuário (`/admin/users/new` e `/admin/users/:id/edit`): campos Área de Formação, Curso, Titulação e Status populados a partir dos CSVs `assets/tabela_area.csv` e `assets/tabela_curso_graduacao.csv`, com persistência nas colunas `formacao_area`, `formacao_curso`, `formacao_titulacao` e `formacao_status` da tabela `users`.
- Correção crítica: rotas `POST /consultar` e `POST /consultar-certificado` agora extraem corretamente `access_code` e `certificate_code` de `req.body`, eliminando `ReferenceError` que impedia o funcionamento das consultas.
- Correção crítica: proteção CSRF agora cobre uploads multipart, aceitando o token por cookie `csrf_token` (enviado automaticamente pelo navegador) além do campo hidden `_csrf` e header `X-CSRF-Token`.
- Correção crítica: IDs em `POST /admin/users/bulk-update-flags` são sanitizados com `parseInt()` e filtrados para inteiros positivos antes do `.bind() SQL, eliminando risco de injeção.
- Correção crítica: mensagem de redirect em `POST /admin/users/:id/reset-password` não expõe mais a senha padrão na URL.
- Campos de formação acadêmica (Área, Curso, Titulação e Status) adicionados ao formulário de edição de participante, sincronizados com a conta vinculada do usuário.
- Telefone do participante agora é buscado e salvo tanto na tabela `users` quanto em `event_registrations`, quando há conta vinculada.
- Paginação na listagem de usuários (`/admin/users`): 50 por página (padrão), com opção de 25, 50, 100 ou 200 registros; controles no topo do card com contador, botões Anterior/Próxima, indicador de página e seletor de registros; a paginação só aparece quando o total excede o limite.
- Relatório de importação com botão de ocultar/mostrar: na página de resultado (`/admin/users/import/result` e `/admin/events/:id/import-users-result`), botão "Ocultar relatório" / "Mostrar relatório" alterna a visibilidade da tabela detalhada, evitando páginas gigantes.
- Mensagens de relatório de importação sem ID do usuário: "Usuário criado" e "Usuário criado e inscrito no evento" não expõem mais o número do ID.
- PDF da lista de presença por atividade reformulado: 1ª linha com nome do evento (fonte 18), 2ª linha com nome da atividade (fonte 14), 3ª linha com data no formato DD-MM-AAAA (fonte 11).
- Botões de presença em lote na chamada de atividade (`/admin/events/:id/activities/:activityId/attendance`): botão verde "Marcar presença (todos)" e botão vermelho "Desmarcar presença (todos)" no cabeçalho do card "Vincular participantes e papéis". Rota `POST /:id/activities/:activityId/attendance-bulk` processa os dois casos, usa papel prioritário configurado na atividade e ignora `admin@admin.com`.
- Labels legíveis dos perfis elegíveis na chamada: cabeçalho exibe "Participante, Palestrante" em vez de "participant, speaker".
- Remoção da página de presença geral por evento (`/admin/events/:id/attendance`): removido botão "Presença" da listagem de eventos e da página de participantes; eliminadas as rotas `GET /:id/attendance` e `POST /:id/attendance/:userId` e o template `views/admin/events/attendance.ejs`. Presença gerenciada exclusivamente por atividade.
- Coluna "PARTICIPAÇÃO" na tabela de "Participantes do Evento" do relatório (`/admin/reports?eventId=:id`) exibe badges coloridos para todos os papéis em `event_user_roles` (Participante, Administrador, Revisor, Palestrante, Professor, Apresentador Oral, Apresentador Pôster).
- Card "Atividades do Evento" no relatório administrativo: quatro cards de estatísticas (total de atividades, inscrições vinculadas, presenças registradas, atividades certificáveis), listagem agrupada por tipo de atividade com badges de cor, ordenação alfabética, e para cada atividade: nome, data, carga horária, número de inscritos, número de presentes.
- Linhas brancas do CSV/XLSX ignoradas silenciosamente: linhas totalmente vazias (sem dados em nenhuma coluna) são puladas sem gerar entradas no relatório.
- Refatoração completa da importação de participantes: parser CSV com auto-detecção de delimitador (vírgula ou ponto-e-vírgula), detecção flexível de colunas (exact match first), mapeamento correto de colunas normalizadas para nomes originais.
- Duas rotas de importação: `/admin/events/:id/import-users` cria usuários e inscreve no evento; `/admin/users/import` cria apenas usuários sem inscrição.
- Páginas de resultado em URLs separadas das páginas de upload: POST redireciona para GET de resultado.
- Relatório pessoa por pessoa na importação com status individual (Sucesso, Falha, Ignorado), descrição detalhada e download em CSV via rotas backend.
- Modelo CSV vazio com cabeçalho pré-preenchido disponível para download nas páginas de importação.
- Removidas referências ao Even3: textos, mensagens de erro e templates atualizados para serem genéricos.
- Uniformização de estilos de botões nas páginas de resultado de importação.
- Remoção de logs de debug das rotas de importação.
- Busca de usuários por nome, e-mail, instituição ou CPF em `/admin/users`: campo de busca com filtro case-insensitive, paginação que preserva o termo de busca entre páginas e estado vazio com mensagem contextual.
- Correção da paginação de usuários: o seletor "por página" agora usa `addEventListener` em `<script>` dedicado, resolvendo falha de parsing de JavaScript inline que impedia a mudança de registros por página.
- Correção da paginação de usuários: o seletor "por página" permanece visível mesmo quando o total de registros cabe em uma única página, permitindo alterar o limite.
- Correção do contador de participantes quando filtros retornam zero registros: exibe "0-0 de 0" em vez de "1-1 de N".
- Correção do filtro "Instrutor" na listagem de participantes: substituído `LEFT JOIN` por `EXISTS` para manter ordem correta dos parâmetros SQL.
- Coluna "SUBSÍDIO" usa cores por status: verde para aprovado, vermelho para reprovado e amarelo para pendente.
- Filtro de titulação como dropdown separado: opções "Todas", "Graduado", "Mestre", "Doutor" e "Não especificado" (NULL ou vazio).
- Busca de participantes ampliada para CPF: campo de texto busca por nome, e-mail, instituição e CPF (sem formatação).
- Trigger `trg_sync_user_to_event_registration` propaga `name`, `phone` e `institution` de `users` → `event_registrations` automaticamente.
- Coluna "TIPO" na listagem de participantes (`/admin/events/:id/participants`) agora exibe todos os papéis do `event_user_roles` (Participante, Administrador, Revisor, Palestrante, Professor, Apresentador Oral, Apresentador Pôster) em badges coloridos, substituindo a lógica anterior de "Com artigo" / "Instrutor" / "Participante".
- Novo botão "Imp. Lista Presença" na listagem de atividades (`/admin/events/:id/activities`), gerando PDF com lista dos inscritos para cada atividade (Nome, E-mail, Assinatura).
- Usuário `admin@admin.com` é excluído automaticamente das listas de presença por atividade.
- Correção da geração de PDF de lista de presença: colunas de cabeçalho alinhadas na mesma linha Y, com espaçamento adequado entre texto, linha separadora e primeira linha de dados.
- Fase 0 do plano de evolução (`plano.md`): novos contadores do dashboard (`Total de Usuários`, `Eventos Realizados`, `Inscritos em Eventos Futuros`) em `routes/auth.js` e `views/admin/dashboard.ejs`.
- Fase 0: perfil do participante em `/author/profile` (`routes/public.js`, `views/public/participant-profile.ejs`, `security/validation.js`) com telefone, formação acadêmica e troca opcional de senha (validação da senha atual com bcrypt, `password_changed = 1`).
- Fase 0: opção `Não possui curso de graduação` centralizada em `services/academic-formation.js` (`NO_DEGREE_COURSE`, `getCursosByArea`, `getCursosMap`), presente em todas as áreas de formação; `routes/users.js` e `routes/events.js` reutilizam o serviço em vez de funções locais duplicadas.
- Fase 0: ao selecionar a opção `Não possui curso de graduação`, os campos Titulação e Status ficam ocultos nos formulários (`views/admin/users/form.ejs`, `views/complete-profile.ejs`, `views/public/participant-profile.ejs`, `views/admin/events/participant-form.ejs`) e são gravados como nulos nas rotas de criação/edição.
- Fase 0: status `encerrado` para eventos (`routes/events.js`, `routes/public.js`): normalização em criação/edição, rota `POST /:id/close`, badge e botão na listagem administrativa, select com três estados no formulário; a página pública e a área de certificados permanecem acessíveis com aviso de encerramento, enquanto inscrição e submissão retornam 404.
- Correção: `views/error.ejs` usava `<%= message || '' %>` e levantava `ReferenceError` quando a mensagem não era passada via `locals`; alterado para `<%= locals.message || '' %>`.
- Esquema de backup e restauração (super-admin): `services/backup.js` gera backup em ZIP contendo snapshot consistente do banco (`VACUUM INTO`), a pasta `uploads/` completa e `BACKUP_META.json`; a restauração substitui banco e arquivos a partir do ZIP com validações (`integrity_check`, tabelas principais, proteção contra path traversal) e cópia de segurança do banco atual com rollback automático em caso de falha. Botões "Baixar Backup" e "Restaurar Backup" no dashboard, visíveis apenas para `admin@admin.com`, ao lado do botão de reset.
- Dependência `adm-zip` adicionada para extração do ZIP na restauração.
- Impressão da lista de presença por etapa na página de atividades: para atividades com etapas, a listagem (`/admin/events/:id/activities`) exibe um botão "Imp. Lista · <etapa>" por etapa (link `attendance-print?session_id=`), substituindo o botão único que sempre imprimia a lista da primeira etapa; atividades sem etapas mantêm o botão único original.
- Cor do texto do certificado selecionada por paleta embutida de 64 cores (grade 8x8) no lugar do picker nativo do navegador: o botão exibe a amostra da cor atual e abre a grade por papel de certificado; a escolha atualiza o campo oculto `text_color`, a amostra e a prévia do certificado.
- Elegibilidade de certificados por percentual de presença: o campo "Presenças mínimas" foi substituído por "Presença mínima (%)" (inteiro 0-100, default 75, revisor fixo em 0). Cada atividade certificável é qualificada individualmente por papel: apresentações oral/pôster e mesas-redondas qualificam com qualquer presença; palestras, seminários, minicursos e outras exigem presença em pelo menos o percentual configurado das etapas da atividade (atividade sem etapas qualifica com qualquer presença). A pessoa é elegível quando possui ao menos uma atividade qualificada no papel (participante continua exigindo inscrição); somente atividades qualificadas entram no certificado e na carga horária.
- Presença por QR Code: botão "QR Presença" na listagem de atividades (por etapa, ou único para atividade sem etapas) imprime folha letter com evento, atividade, data, etapa e QR Code centralizado apontando para a página pública de presença; origem do link extraída do campo "URL do Evento" (ou host de quem imprime). Na página, o usuário autenticado (login com retorno automático via `?next=`) escolhe o papel exercido e marca presença — só no dia da etapa ou no período da atividade, UTC-3 — gravando em `activity_attendance_records` (idempotente, `marked_by` = o próprio usuário), integrando-se à chamada e aos certificados.
- Página pública de atividades com contador e etapas de presença: em `/evento/:id/atividades`, o card de cada atividade com etapas passa a exibir quantas presenças o usuário possui e quais etapas frequentou (ex.: "3 de 5 presenças — Aula 1 · Aula 2 · Aula 3"), em `routes/public.js` e `views/public/event-activities.ejs`.

### Segurança reforçada (V0.1)

- Proteção CSRF em todos os formulários POST e uploads multipart: token gerado por sessão, validação `timingSafeEqual`, rejeição 403 para requisições sem token ou inválido. O middleware aceita o token por header `X-CSRF-Token`, campo hidden `_csrf` no body ou cookie `csrf_token` (enviado automaticamente pelo navegador em uploads multipart, onde `req.body` ainda não existe). Injeção automática via partial `views/partials/csrf-inject.ejs`.
- Rate limiting por rota: login (10/15min), cadastro/inscrição (5/hora), admin sensível (30/min), global (200/15min).
- `express-validator` integrado nas rotas de login, troca de senha, cadastro público, revisão e decisão final, com mensagens de erro localizadas.
- Hardened security: secret de sessão via `SESSION_SECRET` ou `crypto.randomBytes(32)`, cookie `secure` ativado em produção, CSP com `objectSrc: none`, `baseUri` e `formAction` restritos, `referrerPolicy` configurado, payload limit de 1 MB, `noCache` headers.
- Sanitização de IDs numéricos: parâmetros de array em rotas de atualização em lote (ex: `bulk-update-flags`) passam por `parseInt()` e filtro para inteiros positivos antes do `.bind()` SQL, eliminando risco de injeção via valores não numéricos.
- Mensagens de redirect seguras: senhas padrão não são expostas em parâmetros de URL (ex: reset de senha redireciona com mensagem genérica).
- Consultas por código funcionais: rotas de consulta de artigo e certificado por código extraem corretamente os parâmetros de `req.body` antes do `.bind()` SQL.
- Acesso super-administrador: middleware `requireSuperAdmin` restringe funcionalidades sensíveis (reset de banco, backup e restauração) ao `admin@admin.com`. Outros administradores recebem 403.
- Tratamento de erros assíncronos: `validateAndHandle` inclui `.catch()` para evitar requisições penduradas. Handler global de `unhandledRejection` loga erros não tratados.
- `method-override` configurado corretamente antes do body parser, permitindo formulários POST com `_method=DELETE` para exclusão de recursos.

### Parcial ou pendente de validação

- Decisão final administrativa precisa de validação funcional ponta a ponta.
- A opção `Não possui curso de graduação` em todas as áreas e a ocultação de Titulação/Status (Fase 0) estão implementadas, mas ainda pendem validação funcional ponta a ponta.

### Fora do escopo atual

- Notificações por e-mail.
- Exportação estruturada de relatórios em CSV ou Excel.
- API externa.
- Internacionalização.

## Riscos e Gaps Conhecidos

1. O fluxo completo de deliberação final administrativa ainda requer validação integrada.

## Próximos Passos Recomendados

### Alta prioridade

1. Validar o fluxo completo de evento, submissão, atribuição, parecer e deliberação final administrativa.
2. Auditoria de deliberação final com histórico persistente.
3. Filtros avançados de artigos por trilha e modalidade.

### Média prioridade

1. Melhorar busca e filtros de artigos.
2. Implementar notificações para atribuição e mudança de status.
3. Adicionar histórico de deliberação final e trilha de auditoria de artigos.

### Baixa prioridade

1. Exportação CSV, Excel ou PDF.
2. API REST.
3. Internacionalização.
4. Melhorias adicionais de responsividade.

## Planejamento Proposto

> Plano aprovado para a próxima evolução (4 ciclos: Fase 0 Quick Wins, Fase 1 Aulas + QR Code, Fase 2 Auditoria, Fase 3 E-mails) registrado em `plano.md`. Esta seção preserva o diagnóstico e os épicos incrementais anteriores.

### Diagnóstico por objetivo

1. `Gerenciar eventos`
   Status atual: implementado, com lacunas administrativas pontuais.
   Base existente: CRUD de eventos, cronograma público, janelas de inscrição, submissão, revisão e certificados de participação.
   Principais lacunas: política para eventos encerrados na área pública e eventual módulo financeiro, caso entre no escopo.

2. `Gerenciar e analisar submissão de artigos científicos`
   Status atual: implementado em nível operacional.
   Base existente: submissão pública, rascunhos, vínculo com participante, múltiplos revisores, parecer individual, deliberação final administrativa e relatórios por evento.
   Principais lacunas: trilha de auditoria da deliberação final e filtros operacionais mais fortes por trilha e modalidade.

3. `Gerenciar lista de presença nos eventos`
   Status atual: implementado em nível operacional.
   Base existente: `event_registrations`, `attendance_records`, `event_activities` e `activity_attendance_records` permitem lançamentos manuais por evento e por atividade.
   Principais lacunas: filtros operacionais mais fortes e indicadores de frequência detalhados.

4. `Gerenciar e emitir certificados de participação`
   Status atual: implementado em nível operacional.
   Base existente: regras por papel de certificado, consolidação por papel das atividades e da carga horária, emissão e reemissão versionadas, geração em PDF com resumo das atividades, download administrativo e área autenticada do participante.
   Principais lacunas: refinamentos de auditoria operacional.

### Leitura executiva

- `Eventos`: pronto para uso, com algumas lacunas administrativas.
- `Artigos`: pronto para uso, com filtros e download ZIP por evento.
- `Presença`: implementada por evento e por atividade, com consolidação de carga horária.
- `Certificados`: emissão real em PDF com atividades e carga horária separadas por papel, regras por papel, reemissão, download autenticado e verificação pública já disponíveis.

### Épicos e execução incremental

#### Épico 1: gestão administrativa de participantes por evento

Objetivo: consolidar o núcleo administrativo de participação, hoje apoiado em `event_registrations`, para servir de base a presença e certificados.

Entrega incremental 1:

- listar participantes por evento;
- buscar por nome, e-mail e tipo de participação;
- exibir situação consolidada do participante;
- permitir ajuste manual de `registration_type`.

Estado: implementado. A entrega inclui também criação e remoção manual condicionada, índices únicos e auditoria de operações.

Tarefas técnicas por arquivo:

- `db.js`
  Índices de consulta e índices únicos para `event_registrations`, além da tabela `participant_audit_logs`.
- `routes/events.js`
  Adicionar consultas consolidadas de participantes e métricas administrativas por evento.
- `routes/users.js`
  Reaproveitar a lógica já existente de status do participante e extrair helper comum, se necessário.
- `routes/events.js`
  Listagem, criação, edição e remoção administrativa de participantes por evento.
- `views/admin/events/participants.ejs`
  Criar tela de listagem, filtros e ações rápidas.
- `views/admin/events/participant-form.ejs`
  Criar formulário de edição manual da participação.

Critério de pronto:

- admin consegue abrir um evento e gerir os participantes sem depender do fluxo público.

#### Épico 2: modelagem e lançamento de presença

Objetivo: sair de `inscrito` para `presente`.

Entrega incremental 2:

- criar presença por evento como primeira versão;
- permitir lançamento manual de presença;
- consolidar total de presenças por participante.

Estado: implementado para presença simples por evento.

Sugestão inicial de entidades:

- `event_activities`
- `attendance_records`
- `certificate_rules`

Tarefas técnicas por arquivo:

- `db.js`
  Criadas as tabelas `attendance_records`, `event_activities` e `activity_attendance_records`; `activity_certificate_rules` permanece apenas por compatibilidade histórica.
- `routes/events.js`
  Expor resumo de presença por evento no painel administrativo.
- `routes/events.js`
  Rotas para registrar, remover e listar presenças simples por evento.
- `views/admin/events/attendance.ejs`
  Painel de presença por evento com lançamento manual em linha.
- `views/admin/dashboard.ejs`
  Exibir indicadores resumidos de presença quando o módulo estiver ativo.

Critério de pronto:

- admin consegue registrar presença e consultar quem esteve presente em cada evento.

#### Épico 3: presença por atividade, dia ou minicurso

Objetivo: evoluir da presença simples por evento para um controle mais preciso.

Estado: implementado. O sistema calcula presença e carga horária com base nas atividades reais do evento.

Entrega incremental 3:

- cadastrar atividades internas do evento;
- vincular presença por atividade com papel específico (participante, revisor, professor, palestrante, apresentador oral/pôster), mantendo `event_user_roles` como fonte independente dos papéis atribuídos no evento;
- consolidar carga horária por participante;
- conectar presença por atividade à elegibilidade de certificados;
- configurar mínimo de presenças, fundo e texto por papel de certificado no evento;
- incluir listagem de atividades e carga horária no PDF do certificado.

Tarefas técnicas por arquivo:

- `db.js`
  Adicionar colunas `activities_attended` e `total_workload_hours` em `certificate_emissions` via migration; adicionar helper `getWorkloadSummaryByEvent` para consultas de carga horária.
- `routes/events.js`
  Consultar presenças por pessoa e papel, calcular elegibilidade com `event_certificate_rules`, atualizar `issueCertificate` para persistir atividades e carga horária do papel emitido e manter a chamada de cada atividade restrita aos papéis previamente atribuídos.
- `services/certificates.js`
  A geração de PDF inclui a carga horária consolidada em horas-aula somente quando o total das atividades frequentadas for maior que zero.
- `views/admin/events/activities.ejs`
  Reescrever com topbar, grid de cards, badges por tipo de atividade, contagem de presenças e link para gerenciar presença.
- `views/admin/events/activity-attendance.ejs`
  Reescrever com topbar, stats cards (presentes/ausentes/total), formulário de regra de certificado (mínimo + fundo), lista de participantes com botão presente/ausente.
- `views/admin/events/certificates.ejs`
  Reescrever com topbar, colunas de atividades e carga horária, tags das atividades frequentadas pelo participante, badges de elegibilidade.

Critério de pronto:

- admin cadastra atividades, define regras por papel de certificado, marca a atuação/presença, verifica elegibilidade consolidada por papel e emite certificados distintos com atividades e carga horária correspondentes.

#### Épico 4: refinamentos do módulo de artigos

Objetivo: completar o fluxo de artigos com recursos operacionais ainda pendentes.

Entrega incremental 4:

- download em lote de artigos;
- filtros por trilha e modalidade;
- histórico de deliberação final administrativa.

Estado: parcialmente implementado. Filtros por trilha/modalidade/status e download ZIP dos PDFs por evento já estão disponíveis; permanece o histórico de deliberação.

Tarefas técnicas por arquivo:

- `db.js`
  Criar estrutura de auditoria para deliberação final, se a decisão precisar de histórico persistente.
- `routes/articles.js`
  Filtros por trilha, modalidade e status, além do download ZIP dos PDFs por evento.
- `routes/reports.js`
  Registrar justificativa e histórico de deliberação final administrativa.
- `views/admin/articles/list.ejs`
  Filtros, destaques de trilha/modalidade e ação de download em lote.
- `views/admin/articles/detail.ejs`
  Exibir histórico administrativo do artigo.
- `views/admin/reports/list.ejs`
  Exibir justificativas e trilha de decisão.

Critério de pronto:

- administração consegue deliberar, filtrar e exportar artigos com rastreabilidade.

### Ordem recomendada

1. Concluir o histórico de deliberação final administrativa.
2. Evoluir a auditoria operacional dos certificados, se necessário.
3. Reforçar validações server-side e client-side nos formulários principais.
4. Financeiro, se entrar no escopo do produto.

### Backlog técnico priorizado

#### Alta prioridade

1. Histórico de deliberação final administrativa.
2. Validação integrada do fluxo de submissão e deliberação.
3. Reforçar validações server-side e client-side nos formulários principais.
4. Proteções CSRF e endurecimento geral de segurança.

#### Média prioridade

1. Filtros avançados de artigos.
2. Auditoria operacional de certificados.

#### Baixa prioridade

1. QR code para presença.
2. Módulo financeiro.
3. Notificações e automações.


### Observações editoriais e backlog

1. ~~Ampliar o dashboard com contadores para total de eventos realizados, eventos publicados, inscritos totais e inscritos em eventos futuros. Também vale decidir se eventos encerrados continuam visíveis na área pública.~~ Implementado em 2026-08-14 (Fase 0): contadores `Total de Usuários`, `Eventos Realizados` e `Inscritos em Eventos Futuros`; decisão adotada — eventos encerrados ficam fora da listagem inicial, mas permanecem acessíveis por URL (detalhes e certificados) com aviso de encerramento.
2. Implementar controle de pagamento. Em uma primeira versão, basta informar cobranças, tabela de valores, pedido de isenção, cupom de desconto e upload de comprovante.
3. Criar uma página única com a listagem dos relatórios possíveis.
Programada
