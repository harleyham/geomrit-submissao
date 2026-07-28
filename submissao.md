# Sistema de Submissão e Revisão de Artigos

## Visão Geral

Aplicação web para gestão de eventos científicos com publicação de eventos, submissão pública de artigos, atribuição de revisores, emissão de pareceres e acompanhamento administrativo.

Data de referência desta especificação: **28/07/2026**.

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
- CRUD de eventos.
- Configuração de múltiplas áreas/trilhas por evento.
- Configuração de subsídio a participantes por evento.
- Gestão de usuários em `/admin/users`.
- Atualização em lote de perfis e status de usuários.
- Visualização de artigos por evento.
- Atribuição de revisores.
- Relatórios por evento com consolidação de pareceres.
- Impressão do relatório do evento em PDF pelo navegador.

### Revisão

- Login pelo fluxo unificado.
- Dashboard do revisor.
- Lista de artigos pendentes baseada em `assignments` sem `reports`.
- Lista de artigos revisados baseada em `reports`.
- Envio de parecer com recomendação.

### Público

- Listagem de eventos publicados.
- Página pública do evento.
- Inscrição pública de participante como ouvinte, vinculada a conta autenticada.
- Submissão de artigo com geração de código de acesso.
- Página do participante em `/author` para acompanhar inscrições, participações, rascunhos e submissões.
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
- `offers_subsidy`
- `status`
- `submission_start`
- `submission_end`
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
- A submissão pública depende da janela configurada em `submission_start` e `submission_end`.
- Um evento sem `submission_start` e `submission_end` não é tratado como evento com submissão fechada; ele é tratado como evento sem submissão de artigos configurada.
- Antes de `submission_start`, a submissão fica bloqueada.
- Depois de `submission_end`, a submissão fica bloqueada.
- O campo `area` do evento suporta múltiplas áreas/trilhas, persistidas em `TEXT` normalizado e reutilizadas no formulário de submissão.
- O formulário de submissão só apresenta áreas definidas no evento selecionado.
- O evento pode registrar se oferece subsídio a participantes por meio de `offers_subsidy`.
- Na criação e edição do evento, `date_end` não pode ser anterior a `date_start`.
- Na criação e edição do evento, `submission_end` não pode ser anterior a `submission_start`.

### Usuários

- O cadastro administrativo permite criar usuários com perfil de admin e/ou revisor.
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

### Participação em evento

- Todo participante do evento deve estar associado a uma conta cadastrada no sistema.
- Participantes ouvintes são registrados em `event_registrations` com `registration_type = 'listener'`.
- Participantes que submetem artigo são registrados em `event_registrations` com `registration_type = 'author'`.
- Se um ouvinte posteriormente submete artigo no mesmo evento, sua inscrição é promovida automaticamente para `author`.
- Um participante com múltiplos artigos conta uma única vez nas métricas de inscritos com artigo.

### Autenticação e senha

- Usuários inativos (`is_public = 0`) não conseguem autenticar.
- Os formulários com senha possuem controle visual para mostrar ou ocultar caracteres.
- Contas com perfil administrativo não podem acessar `/author` nem `/submeter/:eventId`.

## Fluxos Principais

### Fluxo operacional

1. Admin cria evento.
2. Admin publica evento.
3. Participante autenticado pode se inscrever no evento como ouvinte.
4. Público autenticado submete artigo dentro da janela permitida.
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
| `/admin/articles` | Gestão de artigos |
| `/admin/users` | Gestão de usuários |
| `/admin/assignments` | Atribuição de revisores |
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
│   ├── reviewers.js
│   ├── users.js
│   ├── assignments.js
│   ├── reports.js
│   ├── reviewer.js
│   ├── public.js
│   └── config.js
└── views/
```

Observações estruturais:

- `routes/config.js` continua presente como área legada em `/admin/config`.
- `routes/reviewers.js` permanece como herança da estrutura anterior.

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
- Fluxo de atribuição de revisores.
- Dashboard do revisor baseado em atribuições e pareceres.
- Restrição de submissão por janela real de datas.
- Relatórios por evento com recomendações consolidadas.
- Controle visual de mostrar ou ocultar senha nos formulários principais.

### Parcial ou pendente de validação

- Decisão final administrativa precisa de validação funcional ponta a ponta.
- Upload público de arquivo ainda não está completo no fluxo efetivo.

### Fora do escopo atual

- Notificações por e-mail.
- Exportação de relatórios.
- API externa.
- Internacionalização.

## Riscos e Gaps Conhecidos

1. O campo `pdf_path` existe, mas o upload público real ainda não está operacional de ponta a ponta.
2. Existem rotas legadas ainda montadas no projeto, especialmente `/admin/config`.
3. Ainda há endpoints legados de toggle individual de perfis no backend, embora a interface principal já utilize salvamento em lote.
4. O fluxo completo de decisão final administrativa ainda requer validação integrada.

## Próximos Passos Recomendados

### Alta prioridade

1. Concluir o upload real de artigo na submissão pública.
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
