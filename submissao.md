# Sistema de Gestão de Eventos, Artigos, Presença e Certificados

## Visão Geral

Aplicação web para gestão de eventos acadêmicos e científicos, com inscrição de participantes, submissão de artigos, revisão, controle de presença e emissão de certificados de participação.

Versão atual do projeto: **V0.1**.

Data de referência desta especificação: **31/07/2026**.

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
- CRUD de eventos.
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
- Seleção explícita das atividades na inscrição pública ou administrativa, com edição posterior pelo participante em `/evento/:id/atividades` ou pelo administrador no cadastro da participação.
- Controle de presença simples por evento e chamada por atividade, com ações explícitas para marcar, atualizar ou remover presença.
- Download em lote dos PDFs submetidos em arquivo ZIP por evento.
- Configuração de certificados por evento e por papel, com elegibilidade por presença no papel correspondente ou, para revisores, por parecer enviado; emissão, reemissão versionada e download autenticado em PDF.
- Biblioteca administrativa de fundos PNG/JPEG para certificados, com seleção de fundo existente ou upload de novo arquivo.

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
- Seleção das atividades durante a inscrição e manutenção posterior em `/evento/:id/atividades`; atividades com presença registrada não podem ser removidas.
- Submissão de artigo com geração de código de acesso.
- Página do participante em `/author` para acompanhar inscrições, participações, rascunhos e submissões, inclusive em contas com perfil de revisor.
- Área do participante acessível também a contas com múltiplos perfis, com atalhos para revisão e administração quando aplicável.
- Consulta de submissão por código.
- Consulta por código com andamento agregado da avaliação, sem expor um único revisor como responsável oficial.
- Exibição pública de revisores ativos.
- Fluxo de participação conectado às atividades, chamadas e certificados: para participante, somente atividades com inscrição e presença são contabilizadas.

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
- `reviewer_areas`
- `is_admin`
- `is_reviewer`
- `is_public`
- `password_changed`
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
- `activity_date`
- `workload_hours`
- `certificate_enabled`

### `activity_attendance_records`

- `id`
- `activity_id`
- `registration_id`
- `user_id`
- `role`
- `marked_by`
- `attended_at`

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

- Apenas eventos com `status = 'published'` aparecem no site público.
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
- Atividades habilitadas para certificação são consolidadas por pessoa e por papel. Para o papel de participante, somente contam atividades em que coexistam inscrição e presença. Uma mesma pessoa pode receber certificados distintos de participante, palestrante, professor ou apresentador, cada um contendo apenas suas atividades e sua carga horária correspondentes.
- O certificado de revisor é a exceção: sua elegibilidade decorre de ao menos um parecer enviado no evento.
- A rota administrativa `/admin/events/:id/attendance` é o painel de chamadas: ela lista as atividades e direciona para a marcação de presença de cada uma. A presença geral não é usada para calcular carga horária nem elegibilidade de certificados.

### Autenticação e senha

- Usuários inativos (`is_public = 0`) não conseguem autenticar.
- Os formulários com senha possuem controle visual para mostrar ou ocultar caracteres.
- Contas com perfil de revisor podem acessar `/author` e `/submeter/:eventId`, mantendo também o fluxo de revisão.
- Contas com múltiplos perfis mantêm redirecionamento prioritário para `/admin/dashboard`, mas a interface expõe links para `/reviewer` e `/author`.
- O botão `Sair`, em destaque vermelho, deve estar disponível nas páginas do usuário autenticado para encerramento imediato da sessão.

## Fluxos Principais

### Fluxo de atividades, presença e certificados

1. Admin cria o evento.
2. Admin cadastra e configura suas atividades em `/admin/events/:id/activities`.
3. Participante seleciona as atividades durante a inscrição ou posteriormente em `/evento/:id/atividades`; o administrador pode editar os mesmos vínculos no cadastro do participante.
4. Admin acessa `/admin/events/:id/attendance`, abre a chamada da atividade, seleciona o papel exercido e marca, atualiza ou remove a presença.
5. Admin acessa `/admin/events/:id/certificates` e emite os certificados elegíveis. Para o papel de participante, cada atividade contabilizada precisa estar certificável e possuir inscrição e presença.

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
| `/author/certificates` | Consulta e download autenticado de certificados emitidos |
| `/evento/:id/atividades` | Seleção e edição, pelo participante, das atividades em que está inscrito |
| `/cadastro` | Solicitação de cadastro público |
| `/consultar` | Consulta por código |
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
| `/admin/events/:id/subsidies` | Análise administrativa dos pedidos de subsídio do evento |
| `/admin/events/:id/participants` | Gestão administrativa dos participantes do evento |
| `/admin/events/:id/attendance` | Painel de chamadas por atividade do evento |
| `/admin/events/:id/activities` | Cadastro de atividades internas do evento |
| `/admin/events/:id/activities/:activityId/attendance` | Controle de presença da atividade |
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
- Painel administrativo de presença organizado por atividade, com acesso direto à chamada de cada parte do evento.
- Cadastro de atividades internas e lançamento manual por atividade, com botões para marcar, atualizar e remover presença; para participante, inscrição e presença compõem conjuntamente a elegibilidade e a carga horária do certificado.
- Certificados de participação com regra de elegibilidade por presença, fundo PNG/JPEG selecionável em miniatura, cor da fonte configurável por evento, prévia inline do certificado antes de salvar a regra, emissão e reemissão versionadas, geração de PDF com toda a fonte na cor selecionada e download autenticado pelo participante dentro da janela do evento.
- Certificados distintos por papel no evento: Participante, Revisor, Palestrante, Professor, Apresentador Oral e Apresentador Pôster, cada um com fundo, cor, título, texto, elegibilidade, emissão e reemissão próprios. A prévia dinâmica usa o fundo e a cor atualmente selecionados no formulário, sem exigir salvamento prévio.
- O PDF informa a carga horária consolidada em `hora-aula` ou `horas-aula` somente quando as atividades vinculadas ao certificado totalizam valor maior que zero.
- Emissão em lote dos certificados elegíveis ainda não emitidos.
- Seleção individual das seções incluídas na impressão do relatório em PDF.
- Download em lote dos PDFs submetidos por evento em arquivo ZIP.
- Enxugamento técnico: remoção de rotas individuais legadas de perfis, redirecionamentos de login do revisor, fallback duplicado de eventos, dependência direta não utilizada e colunas antigas de revisão em `articles`.
- Exibição do status do subsídio na página do participante (`/author`): coluna condicional "Subsídio" com badge colorido indicando `Pendente`, `Aprovado` ou `Rejeitado` na tabela de participações, aparecendo apenas quando o usuário possui solicitações de subsídio vinculadas.
- Topbar unificada na página de certificados de participante (`/evento/:id/certificates`): exibe o e-mail da conta logada e o botão "Sair" em vermelho, seguindo o mesmo padrão das demais páginas públicas autenticadas.
- Correção de renderização na visualização administrativa da área do participante (`/admin/users/:id/participant`): prop `showSubsidyStatus` agora é passada ao template, eliminando erro de renderização EJS.
- Vinculação de atuação por atividade no controle de presença: o dropdown apresenta apenas papéis elegíveis que a pessoa já possui no evento, enquanto botões separados marcam, atualizam ou removem a presença; a operação não altera `event_user_roles`.
- Reescrita da página de presença por atividade com layout topbar/Inter, stats cards (presentes/ausentes/total), tabela com perfis no evento e role na atividade, e validação server-side dos papéis aceitos.
- Correção de coluna ambígua na query de presença por atividade: alias `person_user_id` eliminou erro "ambiguous column name: user_id" causado pela junção de `event_registrations`, `event_user_roles` e `activity_attendance_records`.

### Segurança reforçada (V0.1)

- Proteção CSRF em todos os formulários POST: token gerado por sessão, validação `timingSafeEqual`, rejeição 403 para requisições sem token ou inválido. Injeção automática via partial `views/partials/csrf-inject.ejs`.
- Rate limiting por rota: login (10/15min), cadastro/inscrição (5/hora), admin sensível (30/min), global (200/15min).
- `express-validator` integrado nas rotas de login, troca de senha, cadastro público, revisão e decisão final, com mensagens de erro localizadas.
- Hardened security: secret de sessão via `SESSION_SECRET` ou `crypto.randomBytes(32)`, cookie `secure` ativado em produção, CSP com `objectSrc: none`, `baseUri` e `formAction` restritos, `referrerPolicy` configurado, payload limit de 1 MB, `noCache` headers.

### Parcial ou pendente de validação

- Decisão final administrativa precisa de validação funcional ponta a ponta.

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
   Principais lacunas: verificação pública e refinamentos de auditoria operacional.

### Leitura executiva

- `Eventos`: pronto para uso, com algumas lacunas administrativas.
- `Artigos`: pronto para uso, com filtros e download ZIP por evento.
- `Presença`: implementada por evento e por atividade, com consolidação de carga horária.
- `Certificados`: emissão real em PDF com atividades e carga horária separadas por papel, regras por papel, reemissão e download autenticado já disponíveis; falta verificação pública.

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
2. Evoluir certificados com verificação pública, se necessário.
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
2. Auditoria operacional e verificação pública de certificados.

#### Baixa prioridade

1. QR code para presença.
2. Módulo financeiro.
3. Notificações e automações.


### Observações editoriais e backlog

1. Ampliar o dashboard com contadores para total de eventos realizados, eventos publicados, inscritos totais e inscritos em eventos futuros. Também vale decidir se eventos encerrados continuam visíveis na área pública.
2. Implementar controle de pagamento. Em uma primeira versão, basta informar cobranças, tabela de valores, pedido de isenção, cupom de desconto e upload de comprovante.
3. Criar uma página única com a listagem dos relatórios possíveis.
Programada
