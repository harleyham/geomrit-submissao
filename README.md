# Geomrit-Submissão — Sistema de Gestão de Eventos, Artigos, Presença e Certificados

## Versão atual
V0.1


Aplicação web para gestão de eventos acadêmicos e científicos, com inscrição de participantes, submissão de artigos, revisão por pares, controle de presença e emissão de certificados de participação.

## Funcionalidades

- **Gestão de eventos**: CRUD de eventos, cronograma público, janelas de inscrição/submissão/certificados e administração restrita aos eventos atribuídos ao usuário
- **Importação de participantes**: importação administrativa de planilhas CSV, XLS ou XLSX exportadas pelo Even3, com criação/atualização de contas e relatório do processamento
- **Submissão de artigos**: formulário público, rascunhos, múltiplos revisores, parecer individual, deliberação final administrativa
- **Revisão**: painel do revisor com artigos pendentes, envio de parecer e recomendação
- **Participantes e papéis**: conta única por pessoa, com papéis independentes por evento (administrador, participante, revisor, palestrante, professor e apresentador); telefone internacional no cadastro de participantes e usuários
- **Primeiro acesso**: contas novas com senha temporária devem trocar a senha e completar identificação, contato, instituição e formação acadêmica antes de acessar os painéis
- **Presença**: atividades/partes configuráveis do evento, com papéis elegíveis e ações explícitas para marcar, atualizar ou remover presença; participantes aparecem somente na chamada das atividades em que estão inscritos
- **Inscrição por atividade**: seleção explícita na inscrição pública ou inclusão administrativa, edição posterior pelo participante ou administrador e contadores de inscritos por atividade
- **Certificados**: emissão em PDF por papel no evento (participante, revisor, palestrante, professor e apresentador oral/pôster), com fundo (thumbnails ordenadas alfabeticamente), texto, cor, prévia dinâmica, carga horária em horas-aula quando aplicável, reemissão versionada e botão "Salvar configuração geral" para replicar cor e fundo em todos os tipos de certificado; para participante, cada atividade contabilizada exige inscrição e presença
- **Verificação pública**: consulta pública da autenticidade de certificados pelo código de verificação
- **Vínculo de papéis por atividade**: seleção do papel que cada pessoa efetivamente exerce em cada atividade, sem alterar seus papéis administrativos no evento; presenças e cargas horárias são consolidadas separadamente para cada certificado

## Fluxo operacional de atividades e certificados

1. O administrador cria o evento.
2. Em `/admin/events/:id/activities`, cadastra as atividades do evento, como palestras, minicursos e apresentações.
3. O participante seleciona suas atividades durante a inscrição pública ou posteriormente em `/evento/:id/atividades`. O administrador também pode fazer essa ligação na inclusão ou edição do participante.
4. Em `/admin/events/:id/attendance`, o administrador abre a chamada de cada atividade, escolhe o papel exercido e usa os botões para marcar, atualizar ou remover a presença.
5. Em `/admin/events/:id/certificates`, são emitidos os certificados elegíveis. Para participante, apenas atividades certificáveis com inscrição e presença entram no certificado e na carga horária.

Uma atividade com presença registrada não pode ser removida da inscrição. A mesma pessoa pode receber certificados distintos pelos diferentes papéis exercidos no evento.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js + Express |
| Banco de dados | SQLite (`better-sqlite3`) |
| Templates | EJS |
| Sessão | `express-session` |
| Segurança | `helmet` + `bcryptjs` + `express-rate-limit` + `express-validator` |
| Upload | `multer` |
| Certificados PDF | `pdfkit` |
| Compactação | `compression` |
| Download ZIP | `archiver` |

## Estrutura

```
artigos/
├── server.js            # Ponto de entrada do Express
├── db.js                # Schema SQLite e helpers de consulta
├── package.json         # Dependências
├── security/            # Módulos de segurança (CSRF, rate limiting, validação)
├── uploads/             # Arquivos enviados (certificados, artigos)
├── assets/Fundos/       # Fundos padrão de certificado
├── routes/              # Rotas da API
│   ├── auth.js
│   ├── events.js
│   ├── articles.js
│   ├── users.js
│   ├── reports.js
│   ├── reviewer.js
│   └── public.js
├── services/            # Serviços (ex: geração de PDF de certificados)
└── views/               # Templates EJS
```

## Download e Instalação

### 1. Clonar o repositório

```bash
git clone https://github.com/harleyham/geomrit-submissao.git
cd geomrit-submissao
```

### 2. Instalar dependências

```bash
npm install
```

> O `better-sqlite3` requer compilação nativa. Se falhar, verifique que o sistema possui `build-essential` e `python3` instalados.

### 3. Executar

```bash
npm start
# ou
node server.js
```

O servidor inicia em `http://localhost:3000`.

### 4. Acesso inicial

O sistema cria automaticamente um administrador padrão:

| Campo | Valor |
|-------|-------|
| E-mail | `admin@admin.com` |
| Senha | `123456` |

Ao fazer login pela primeira vez, será solicitada a troca de senha.

## Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta HTTP | `3000` |
| `SESSION_SECRET` | Chave de sessão | `edigemia-ligem-secret-2027` |

## Observações

- O banco de dados SQLite (`artigos.db`) é criado automaticamente na primeira execução.
- Mudanças em rotas ou templates exigem reinício do servidor.
- O sistema não possui hot reload nativo.

## Segurança

| Recurso | Descrição |
|---------|-----------|
| Helmet | Headers de segurança (CSP, referrer policy, X-Content-Type-Options) |
| CSRF | Token por sessão, validação timing-safe, 403 em requisições inválidas |
| Rate Limiting | Tetos por rota (login, cadastro, admin) e teto global |
| Senhas | Hash `bcrypt` com fator 10 |
| Sessão | Cookie `httpOnly`, `sameSite=lax`, `secure` em produção |
| Validação | `express-validator` nas rotas críticas com mensagens localizadas |
| Payload | Limite de 1 MB em JSON e form-urlencoded |

## Licença

MIT
