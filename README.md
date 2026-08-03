# Geomrit-Submissão — Sistema de Gestão de Eventos, Artigos, Presença e Certificados

## Versão atual
V0.1


Aplicação web para gestão de eventos acadêmicos e científicos, com inscrição de participantes, submissão de artigos, revisão por pares, controle de presença e emissão de certificados de participação.

## Funcionalidades

- **Gestão de eventos**: CRUD de eventos, cronograma público, janelas de inscrição/submissão/certificados
- **Submissão de artigos**: formulário público, rascunhos, múltiplos revisores, parecer individual, deliberação final administrativa
- **Revisão**: painel do revisor com artigos pendentes, envio de parecer e recomendação
- **Participantes**: gestão manual por evento, promoção automática `listener` → `author`, auditoria
- **Presença**: registro manual por evento e por atividade (palestras, minicursos, etc.) com consolidação de carga horária
- **Certificados**: emissão em PDF com fundo configurável, cor da fonte, prévia inline e reemissão versionada

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js + Express |
| Banco de dados | SQLite (`better-sqlite3`) |
| Templates | EJS |
| Sessão | `express-session` |
| Segurança | `helmet` + `bcryptjs` |
| Upload | `multer` |
| Certificados PDF | `pdfkit` |
| Compactação | `compression` |

## Estrutura

```
artigos/
├── server.js            # Ponto de entrada do Express
├── db.js                # Schema SQLite e helpers de consulta
├── packages.json        # Dependências
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

## Licença

MIT
