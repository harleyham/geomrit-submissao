# Sistema de Participação e Submissão em Eventos

## Visão Geral

Aplicação web para gestão de eventos científicos com publicação de eventos, inscrição de participantes, submissão pública de artigos, atribuição de revisores, emissão de pareceres e acompanhamento administrativo.

Versão atual do projeto: **V0.1**.

Data de referência desta especificação: **29/07/2026**.

## Objetivo do Produto

O sistema deve permitir:

1. Publicar eventos com janela de submissão configurável.
2. Receber submissões públicas de artigos e gerar código de consulta.
3. Registrar participantes por evento, incluindo ouvintes e autores/apresentadores.
4. Gerenciar usuários com múltiplos perfis no mesmo cadastro.
5. Atribuir artigos a revisores.
6. Registrar pareceres com recomendação.
7. Consolidar apoio à decisão administrativa por evento.

## Stack Atual

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js + Express |
| Banco de dados | SQLite (`better-sqlite3`) |
| Renderização | EJS |
| Sessão | `express-session` |
| Segurança | `helmet`, `bcryptjs` |
| Upload | `multer` |
| Infra complementar | `compression`, `method-override` |

## Escopo Funcional Implementado

### Administração

- Login unificado por e-mail e senha.
- Dashboard com estatísticas gerais.
- Dashboard com cards de pendências para artigos sem revisor, pedidos de subsídio e solicitações de cadastro.
- CRUD de eventos.
- Configuração de múltiplas áreas/trilhas por evento.
- Configuração explícita de evento com ou sem submissão de artigos.
- Configuração de subsídio a participantes por evento.
- Gestão de usuários em `/admin/users`.
- Atualização em lote de perfis e status de usuários.
- Visualização administrativa da área de participante de um usuário.
- Visualização de artigos por evento.
- Atribuição de revisores com sugestão por trilha/área do artigo.
- Relatórios por evento com consolidação de pareceres.
- Página administrativa por evento para análise de pedidos de subsídio, com leitura dos documentos anexados e decisão de aprovação ou reprovação.
- Impressão do relatório do evento em PDF pelo navegador.

### Revisão

- Login pelo fluxo unificado.
- Dashboard do revisor.
- Lista de artigos pendentes baseada em `assignments` sem `reports`.
- Lista de artigos revisados baseada em `reports`.
- Envio de parecer com recomendação.
- Navegação cruzada para área do participante e dashboard admin quando o usuário acumula perfis.

### Público

- Listagem de eventos publicados.
- Página pública do evento com URL destacada e tabela de cronograma por etapa.
- Inscrição pública de participante como ouvinte, vinculada a conta autenticada.
- Submissão de artigo com geração de código de acesso.
- Página do participante em `/author` para acompanhar inscrições, participações, rascunhos e submissões, inclusive para contas com perfil de revisor.
- Área do participante acessível também a contas com múltiplos perfis, com atalhos para revisão e administração quando aplicável.
- Consulta de submissão por código.
- Exibição pública de revisores ativos.

## Perfis, Acesso e Sessão

### Usuário unificado

Todos os usuários estão na tabela `users`. Um mesmo registro pode acumular mais de um perfil.

Flags de permissão:

- `is_admin`
- `is_reviewer`
- `is_public`
- `approval_status`
- `approved_at`
- `approved_by`

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
- `reviewer_id`
- `reviewer_name`
- `reviewer_area`
- `review_notes`
- `rejection_reason`
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
- A área de certificados depende da janela configurada em `certificates_start` e `certificates_end`.
- Um evento sem `submission_start` e `submission_end` não é tratado como evento com submissão fechada; ele é tratado como evento sem submissão de artigos configurada.
- Quando uma etapa do cronograma não possui janela configurada, a página pública do evento não exibe botão de ação para essa etapa.
- Antes de `submission_start`, a submissão fica bloqueada.
- Depois de `submission_end`, a submissão fica bloqueada.
- Antes de `registration_start`, a inscrição fica bloqueada.
- Depois de `registration_end`, a inscrição fica bloqueada.
- Antes de `certificates_start`, o acesso a certificados fica bloqueado.
- Depois de `certificates_end`, o acesso a certificados fica bloqueado.
- O campo `area` do evento suporta múltiplas áreas/trilhas, persistidas em `TEXT` normalizado e reutilizadas no formulário de submissão.
- O formulário de submissão só apresenta áreas definidas no evento selecionado.
- O participante só pode submeter artigo se estiver autenticado e já inscrito no evento.
- Rascunhos podem ser salvos na área do participante, mas não contam como submissão efetiva nas métricas e relatórios.
- Rascunhos podem ser salvos sem preenchimento completo dos campos obrigatórios; a validação integral ocorre apenas na submissão final.
- O participante pode continuar a edição ou apagar rascunhos diretamente na área `/author`.
- O evento pode registrar se oferece subsídio a participantes por meio de `offers_subsidy`.
- Quando `offers_subsidy = 1`, a inscrição do participante pode incluir candidatura a subsídio financeiro.
- Ao solicitar subsídio, o participante deve informar nível acadêmico, curso, instituição de vínculo, UF da instituição e ID Lattes com 16 dígitos.
- Ao solicitar subsídio, o participante deve anexar histórico escolar, carta de motivação e carta de recomendação em PDF, com limite de 10 MB por arquivo.
- Pedidos de subsídio ficam disponíveis apenas para administradores em uma página do evento, com status de análise (`pending`, `approved`, `rejected`), leitura dos documentos anexados e registro de observações da decisão.
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
- `Inscritos` considera participantes registrados por evento.
- `Inscritos Autores` considera participantes distintos com submissão não rascunho.
- `Inscritos Ouvintes` considera registros `listener` em `event_registrations`.

### Relatórios de evento

- O relatório do evento consolida estatísticas de artigos e participantes.
- O relatório exibe `Inscritos com Artigo` como participantes distintos, mesmo quando uma pessoa possui múltiplos artigos.
- O relatório exibe `Inscritos Ouvintes`.
- O relatório lista participantes com nome, e-mail, órgão/instituição e situação de participação.
- O relatório pode ser impresso/exportado para PDF por meio da impressão do navegador.

### Revisão

- O dashboard do revisor usa `assignments` e `reports` como fonte de verdade.
- Uma atribuição sem relatório associado é considerada pendente.
- Um artigo revisado é identificado pela existência de `report`, não apenas pelo `status` de `articles`.
- Ao registrar parecer, o sistema atualiza artigo, atribuição e relatório.
- A interface administrativa de designação destaca revisores compatíveis com a trilha do artigo com base em `reviewer_areas`.

### Participação em evento

- Todo participante do evento deve estar associado a uma conta cadastrada no sistema.
- Participantes ouvintes são registrados em `event_registrations` com `registration_type = 'listener'`.
- Participantes que submetem artigo são registrados em `event_registrations` com `registration_type = 'author'`.
- Usuários com perfil de revisor e/ou administrador também podem acessar a própria área de participante e submeter artigos.
- Se um ouvinte posteriormente submete artigo no mesmo evento, sua inscrição é promovida automaticamente para `author`.
- Um participante com múltiplos artigos conta uma única vez nas métricas de inscritos com artigo.
- O participante pode cancelar a inscrição de ouvinte até o dia anterior ao início do evento.
- Inscrições já promovidas para `author` não podem ser canceladas pela área do participante.
- Quando o evento oferece subsídio, os dados e anexos da candidatura ficam vinculados à própria inscrição do evento.

### Autenticação e senha

- Usuários inativos (`is_public = 0`) não conseguem autenticar.
- Os formulários com senha possuem controle visual para mostrar ou ocultar caracteres.
- Contas com perfil de revisor podem acessar `/author` e `/submeter/:eventId`, mantendo também o fluxo de revisão.
- Contas com múltiplos perfis mantêm redirecionamento prioritário para `/admin/dashboard`, mas a interface expõe links explícitos para `/reviewer` e `/author`.
- O botão `Sair`, em destaque vermelho, deve estar disponível nas páginas do usuário autenticado para encerramento imediato da sessão.

## Fluxos Principais

### Fluxo operacional

1. Admin cria evento.
2. Admin publica evento.
3. Participante autenticado pode se inscrever no evento como ouvinte dentro da janela de inscrições.
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
| `/evento/:id/inscricao` | Inscrição do participante como ouvinte |
| `/submeter/:eventId` | Formulário de submissão |
| `/author` | Página do participante |
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
| `/admin/articles` | Gestão de artigos |
| `/admin/users` | Gestão de usuários |
| `/admin/reports` | Relatórios e decisão final |

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

- A área do participante continua servida pela rota `/author`, embora o fluxo hoje cubra inscrições e submissões.
- O participante possui tela própria de atualização cadastral em `/author/profile`.
- A criação e a edição de eventos já contemplam todas as datas do cronograma público.
- Rotas e templates legados de configuração, distribuição, stats e reviewers foram removidos da aplicação ativa.

## Segurança e Operação

- Senhas armazenadas com hash `bcrypt`.
- Sessão com cookie `httpOnly` e `sameSite=lax`.
- `helmet` com CSP configurada.
- `compression` habilitado.
- `method-override` habilitado para formulários com `_method`.

Variáveis de ambiente em uso:

| Variável | Finalidade | Padrão atual |
|----------|------------|--------------|
| `PORT` | Porta HTTP | `3000` |
| `SESSION_SECRET` | Chave de sessão | `edigemia-ligem-secret-2027` |

Observações operacionais:

- O sistema não possui hot reload nativo.
- Mudanças em rotas e templates exigem reinício do servidor.
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
- Restrição de submissão por janela real de datas.
- Restrição de inscrição por janela real de datas.
- Restrição de acesso à área de certificados conforme janela do evento.
- Eventos sem período configurado em uma etapa do cronograma não exibem botão de ação correspondente na página pública do evento.
- Cancelamento de inscrição de ouvinte antes do início do evento.
- Inscrição em evento com fluxo condicional de subsídio, incluindo dados acadêmicos e upload de documentos obrigatórios.
- Página pública do evento reorganizada em formato de cronograma com ações por etapa.
- Painel `/author` com cards clicáveis apenas para eventos futuros ainda disponíveis para participação.
- Painel `/author` com separação visual entre `Meus Rascunhos` e `Submissões Enviadas`, incluindo continuação e exclusão de rascunhos.
- Botão `Sair` padronizado nas páginas públicas autenticadas do participante e nas telas públicas acessadas com sessão ativa.
- Relatórios por evento com recomendações consolidadas.
- Controle visual de mostrar ou ocultar senha nos formulários principais.
- Navegação cruzada entre área do participante, painel do revisor e dashboard administrativo para usuários com múltiplos perfis.

### Parcial ou pendente de validação

- Decisão final administrativa precisa de validação funcional ponta a ponta.
- Fluxo real de certificados ainda não possui área dedicada própria; hoje a janela já é controlada, mas a emissão/consulta específica ainda precisa ser implementada.

### Fora do escopo atual

- Notificações por e-mail.
- Exportação de relatórios.
- API externa.
- Internacionalização.

## Riscos e Gaps Conhecidos

1. Ainda não existe uma área dedicada de emissão ou download de certificados, embora a janela de certificados já esteja modelada.
2. Existem rotas legadas ainda montadas no projeto, especialmente `/admin/config`.
3. Ainda há endpoints legados de toggle individual de perfis no backend, embora a interface principal já utilize salvamento em lote.
4. O fluxo completo de decisão final administrativa ainda requer validação integrada.

## Próximos Passos Recomendados

### Alta prioridade

1. Implementar a área dedicada de certificados para participantes dentro da janela válida.
2. Validar o fluxo completo de evento, submissão, atribuição, parecer e decisão final.
3. Reforçar validações server-side e client-side nos formulários principais.
4. Revisar proteção contra CSRF e endurecimento geral de segurança.

### Média prioridade

1. Remover ou aposentar rotas legadas.
2. Melhorar busca e filtros de artigos.
3. Implementar notificações para atribuição e mudança de status.
4. Adicionar histórico de revisão e trilha de auditoria.

### Baixa prioridade

1. Exportação CSV, Excel ou PDF.
2. API REST.
3. Internacionalização.
4. Melhorias adicionais de responsividade.


### Meus comentários

1. Implementar alterações no Dashboard, com contador para "Total de eventos realizados", "Eventos publicados" (que são aqueles que estão atualmente válidos - Vale aqui a pergunta: Depois do evento finalizado, vale a pena tirar da página de publicos, ou coloca-los em abaixo da página ?), "Inscritos total" (todos os eventos), "Inscritos atuais" (Inscritos em eventos que ainda estão para ocorrer)
2. Implementar o controle de pagamento. Tem Eventos que há cobrança para inscrição (com possibilidade de isenção, desconto estudantil ou Cupom de desconto). Pode também haver cobrança para Submissão de artigos e cobrança para participação em palestras e minicursos. Na primeira versão apenas informar se tem cobranças, tabela de valores, solicitação de isenção, informe de cupom de desconto, upload de comprovante de pagamento.
3. Não ví na tela do Revisor a trilha onde o Artigo foi proposto. O Revisor deve poder alterar Oral/Poster e alterar qual Trilha.
4. Na listagem dos Artigos, em qualquer página deve haver a separação por Trilha e sé é Oral ou Poster
5. Em algum local deve ser implementado a opção de fazer o download de todos os artigos do Evento
