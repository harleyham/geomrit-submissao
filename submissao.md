# Análise Completa do Sistema de Gerenciamento de Submissão de Artigos Científicos

## 📋 Visão Geral

Sistema web desenvolvido em **Node.js/Express** com **SQLite** (via `better-sqlite3`) e templates **EJS** para gerenciar submissão e revisão de artigos científicos para congressos. Utiliza autenticação por sessão e suporta múltiplos eventos.

---

## 🏗️ Arquitetura

### Stack Tecnológico
| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js + Express |
| Banco de Dados | SQLite (better-sqlite3) |
| Templates | EJS |
| Uploads | Multer |
| Sessões | express-session |
| Segurança | Helmet, bcryptjs |
| Performance | Compression, rate-limiter |

### Estrutura de Diretórios
```
artigos/
├── server.js              # Ponto de entrada
├── db.js                  # Schema + queries helper
├── uploads/               # Arquivos de artigos
├── routes/
│   ├── auth.js            # Login admin
│   ├── events.js          # CRUD eventos (admin)
│   ├── articles.js        # Gestão artigos (admin)
│   ├── reviewers.js       # Gestão revisores (admin)
│   ├── assignments.js     # Atribuição revisores
│   ├── reports.js         # Relatórios/admin
│   ├── reviewer.js        # Dashboard revisor
│   └── public.js          # Página pública
└── views/                 # Templates EJS
```

---

## 🗄️ Schema do Banco de Dados

### Tabela `admins`
- `id`, `username`, `password` (hashed), `created_at`

### Tabela `events`
- `id`, `name`, `short_name`, `description`, `date_start`, `date_end`, `location`, `url`, `area`, `status` (draft/published), `created_at`, `updated_at`

### Tabela `reviewers`
- `id`, `name`, `email` (único), `password` (bcrypt), `area`, `institution`, `bio`, `is_active`, `created_at`, `updated_at`

### Tabela `articles`
- `id`, `event_id` (FK), `title`, `title_en`, `area`, `authors`, `abstract`, `keywords`, `pdf_path`, `contributor`, `affiliation`, `city`, `email_submission`, `access_code`, `type` (oral/poster), `status` (pending/in_review/approved/rejected), `reviewer_id`, `reviewer_name`, `reviewer_area`, `review_notes`, `rejection_reason`, `date_submitted`, `created_at`, `updated_at`

### Tabela `assignments`
- `id`, `article_id` (FK), `reviewer_id` (FK), `status` (pending/accepted/declined), `reviewed_at`, `created_at`, `updated_at`

### Tabela `reports`
- `id`, `assignment_id` (FK), `score` (1-5), `report`, `recommendation` (approved/rejected/revision_requested), `created_at`, `updated_at`

---

## 👥 Perfis de Usuário

### Admin
- Dashboard com estatísticas
- Gerenciamento de eventos (CRUD)
- Gerenciamento de artigos (listar, detalhar, deletar, download)
- Gerenciamento de revisores (CRUD)
- Atribuição de revisores a artigos
- Visualização de relatórios e decisões finais

### Revisor
- Login com email/senha
- Dashboard pessoal (pendentes/aprovados/rejeitados)
- Visualização de artigos atribuídos
- Submissão de revisão (aprovado/rejeitado/revisão solicitada)
- Preenchimento de relatório

### Público
- Listagem de eventos publicados
- Submissão de artigos (com código de acesso)
- Consulta de artigo por código de acesso
- Listagem do corpo de revisores

---

## 🔒 Segurança

- **Hash de senhas**: bcrypt (10 rounds)
- **Helmet**: CSP configurado, headers de segurança
- **Rate Limiting**: 100 requisições/15min
- **Compressão**: Gzip automático
- **Sessões**: Secret configurável via ENV
- **Uploads**: Validação de tipo (.pdf, .doc, .docx), limite 20MB
- **Autenticação**: Middleware `requireAuth` em rotas admin

---

## 🔄 Fluxo do Sistema

```
1. Submissão (público) → Artigo criado com status "pending"
2. Triagem (admin) → Atribuição de revisor
   ↓
3. Revisão → Status "in_review", revisor recebe atribuição
   ↓
4. Decisão Revisor → "approved"/"rejected"/"revision_requested"
   ↓
5. Decisão Final (admin) → Consolidação dos pareceres
   ↓
6. Resultado → Status final "approved"/"rejected"
```

---

## 🛠️ Correções Aplicadas

1. **Schema unificado**: Senha em reviewers, campos de submissão em articles, status normalizados
2. **Autenticação segura**: Senhas hashed em `reviewer.js` e `reviewers.js`
3. **SQL bugs**: Removido COALESCE incorreto, SQLs corrigidos
4. **Consistência de status**: `pending` para submissão, `in_review` durante revisão
5. **Reports table sincronizada**: Criação/leitura correta via tabela `reports`
6. **Middleware de autenticação**: Todos os rotas admin exigem `isAdmin`
7. **Remoção de rotas legadas**: `/submit` antigo e `/events/:id/submit` removidos de server.js
8. **Código de acesso**: Geração automática para consulta de artigos
9. **Uploads**: Diretório `uploads/` criado

---

## 🔧 Status Atual do Desenvolvimento (Última Atualização: 24/07/2026)

### ✅ Bug Corrigido: Redirecionamento após login admin
**Problema**: Ao logar como admin, o sistema redirecionava para `/admin`, mas não existia um handler de rota para esta URL, resultando em erro 404.

**Causa Raiz**: O `authRouter` estava montado apenas em `/login`, mas o redirecionamento após o login bem-sucedido apontava para `/admin/dashboard`. O handler `GET /admin` existia diretamente no `server.js`, mas após a reestruturação das rotas, este handler foi removido, deixando a rota `/admin` sem handler.

**Solução Implementada**:
1. **Adicionado `router.get('/dashboard')` no `authRouter`** (`routes/auth.js`):
   - Verifica se `req.session.isAdmin` é verdadeiro
   - Busca estatísticas do banco de dados (total de eventos, artigos, revisores, artigos recentes)
   - Renderiza o template `views/admin/dashboard.ejs`
   
2. **Montado `authRouter` em `/admin`** no `server.js`:
   - `app.use('/admin', authRouter)` antes das rotas individuais de admin
   - Isso permite que as rotas `/admin/login` (GET) e `/admin/dashboard` (GET/POST) funcionem

3. **Atualizado redirecionamentos**:
   - Login GET: redireciona para `/admin/dashboard` se já autenticado
   - Login POST: redireciona para `/admin/dashboard` após autenticação bem-sucedida
   - Dashboard GET: redireciona para `/login` se não autenticado

**Estrutura de Rotas Atualizada**:
```
/auth (authRouter):
  - GET /          → Login page
  - POST /         → Autenticação
  - GET /dashboard → Dashboard admin (requer autenticação)
  - POST /logout   → Logout

/admin (authRouter):
  - GET /          → Redireciona para /login se não autenticado
  - GET /dashboard → Dashboard admin
  - POST /logout   → Logout
```

### 📊 Funcionalidades Verificadas
- ✅ Sistema carrega sem erros
- ✅ Login admin funciona corretamente
- ✅ Redirecionamento após login para /admin/dashboard
- ✅ Dashboard renderiza estatísticas e artigos recentes
- ✅ Middleware de autenticação protege rotas admin

### 📝 Observações
- O servidor está rodando em `http://localhost:3000`
- Admin panel disponível em `http://localhost:3000/login`
- Revisor panel disponível em `http://localhost:3000/reviewer/login`
- Página pública disponível em `http://localhost:3000`

---

## 🔄 Próximos Passos Sugeridos

### Prioridade Alta
1. **Teste completo do fluxo**: Submeter artigo → atribuir revisor → revisão → decisão
2. **Teste de segurança**: Verificar proteção contra XSS, SQL injection, CSRF
3. **Validação de formulários**: Adicionar validação no client e server-side
4. **Notificações**: Implementar sistema de notificação para revisores e submissões

### Prioridade Média
5. **Export de relatórios**: Gerar PDF dos relatórios de revisão
6. **Upload de arquivos**: Suporte a múltiplos arquivos por artigo
7. **Busca e filtros**: Adicionar busca por título, autor, área nos artigos
8. **Histórico de revisões**: Manter log de decisões anteriores

### Prioridade Baixa
9. **API REST**: Expor endpoints para integração com sistemas externos
10. **Internacionalização**: Suporte a múltiplos idiomas (português/inglês)
11. **Tema escuro/claro**: Alternância de temas no frontend
12. **Mobile responsiveness**: Melhorar layout para dispositivos móveis


# Guia de Uso do Sistema de Submissão de Artigos

## 🚀 Instalação e Execução

### 1. Instalar dependências
```bash
cd /media/ham1/2TB_NTFS/Codigo/artigos
npm install
```

### 2. Iniciar o servidor
```bash
node server.js
```
Ou, em produção:
```bash
NODE_ENV=production ADMIN_PASSWORD=sua_senha node server.js
```

O sistema estará disponível em:
- **Página pública**: http://localhost:3000
- **Admin**: http://localhost:3000/login
- **Revisor**: http://localhost:3000/reviewer/login

---

## 👤 Como usar como ADMIN

### Login
1. Acesse `http://localhost:3000/login`
2. Usuário padrão: `admin`
3. Senha padrão: `admin2027` (alterável via variável de ambiente `ADMIN_PASSWORD`)

### Fluxo de trabalho

#### 1. Cadastrar um Evento
- Acesse **Admin → Eventos**
- Clique em **Novo Evento**
- Preencha: nome, descrição, datas, localização, URL, área(s)
- Clique em **Salvar**
- Altere o status para **"published"** quando o evento estiver pronto para submissões

#### 2. Cadastrar Revisores
- Acesse **Admin → Revisores**
- Clique em **Novo Revisor**
- Preencha: nome, email, área de atuação, instituição, bio
- Defina uma senha (será usada para o revisor fazer login)
- Marque/desmarque "Ativo"

#### 3. Receber e Gerenciar Artigos
- Após publicar o evento, submissões aparecerão em **Admin → Artigos**
- Cada artigo mostra: título, autores, status, tipo
- Clique no artigo para ver detalhes
- Para baixar o PDF: clique em **Download**
- Para rejeitar: altere o status e informe o motivo

#### 4. Atribuir Revisores
- Em **Admin → Atribuições**, veja artigos pendentes
- Clique em **Atribuir Revisor** para vincular um revisor ao artigo
- O status do artigo muda automaticamente para **"Em Revisão"**

#### 5. Acompanhar Relatórios
- Em **Admin → Relatórios**, selecione o evento
- Veja a decisão final consolidada por artigo (baseada nos pareceres dos revisores)
- Aprovação: maioria de revisores aprova → status "approved"
- Rejeição: maioria rejeita → status "rejected"
- Caso de empate ou dúvida → status "revision_requested"

---

## 🔍 Como usar como REVISOR

### Login
1. Acesse `http://localhost:3000/reviewer/login`
2. Use o email e senha cadastrados pelo admin

### Fluxo de trabalho

#### 1. Dashboard
- Veja a quantidade de artigos pendentes, aprovados e rejeitados
- Artigos pendentes são exibidos em ordem de submissão

#### 2. Revisar Artigo
- Clique no artigo na lista de pendentes
- Leia o resumo/abstract e os metadados
- Baixe o PDF do artigo (se disponível)
- Preencha o parecer:
  - **Aprovar**: o artigo é relevante e está bem escrito
  - **Rejeitar**: informe o motivo da rejeição
  - **Revisão solicitada**: indique o que precisa ser alterado

#### 3. Submeter Revisão
- Clique em **Submeter Revisão**
- O status do artigo é atualizado automaticamente
- O admin verá a decisão consolidada

---

## 🌐 Como usar como SUBMITENTE (público)

### 1. Acessar o Evento
- Vá para `http://localhost:3000`
- Clique no evento desejado
- Clique em **Submeter Artigo**

### 2. Preencher Formulário
Campos obrigatórios:
- **Título** (português e inglês)
- **Autores** (lista completa)
- **Resumo/Abstract**
- **Palavras-chave**
- **Área** (preenchida automaticamente pelo evento, mas pode ser alterada)
- **Tipo de apresentação**: Oral ou Pôster

Campos opcionais:
- Contribuidor, afiliação, cidade, email

### 3. Enviar
- Após enviar, um **código de acesso** é gerado
- Guarde-o para consultar o status do artigo futuramente

### 4. Consultar Artigo
- Acesse `http://localhost:3000/consultar`
- Digite o código de acesso
- Veja o status e informações do artigo

---

## ⚙️ Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta do servidor | `3000` |
| `ADMIN_PASSWORD` | Senha do admin | `admin2027` |
| `SESSION_SECRET` | Segredo das sessões | `edigemia-ligem-secret-2027` |

---

## 📱 Estrutura de URLs

| Rota | Descrição |
|------|-----------|
| `/` | Página inicial (eventos publicados) |
| `/login` | Login admin |
| `/reviewer/login` | Login revisor |
| `/reviewer` | Dashboard revisor (após login) |
| `/evento/:id` | Detalhes do evento |
| `/submeter/:eventId` | Formulário de submissão |
| `/consultar` | Consulta de artigo por código |
| `/revisores` | Corpo de revisores |
| `/admin/events` | Gerenciar eventos |
| `/admin/articles` | Gerenciar artigos |
| `/admin/reviewers` | Gerenciar revisores |
| `/admin/assignments` | Atribuir revisores |
| `/admin/reports` | Relatórios e decisões |

