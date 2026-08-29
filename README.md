# Gerência de Eventos

## Versão atual
V0.31


Aplicação web para gestão de eventos acadêmicos e científicos, com inscrição de participantes, submissão de artigos, revisão por pares, controle de presença e emissão de certificados de participação.

## Funcionalidades

- **Gestão de eventos**: CRUD de eventos, cronograma público, janelas de inscrição/submissão/certificados e administração restrita aos eventos atribuídos ao usuário
 - **Atividades no evento público**: a seção "Atividades do Evento" da página pública `/evento/:id` oferece três visualizações alternáveis — **Cards** (padrão, agrupados por tipo, no mesmo formato do painel administrativo), **Lista** (com data, horário e sala) e **Grade (dia × hora)**; cada atividade mostra descrição/ementa, data e horário, e a **sala** (quando não tem etapas); quando tem etapas, cada uma é listada com data, horário e sala; o botão **Etapas** (só aparece quando há etapas) abre a página pública somente-leitura `/evento/:id/atividades/:id/etapas`, e o link "Assistir transmissão" abre o vídeo em nova aba; abaixo da programação, a seção **Transmissões** lista as atividades e etapas com vídeo (link próprio ou herdado da atividade; aviso "Transmissão prevista" quando ainda sem link)
- **Logo do evento**: upload de PNG/JPEG (até 5 MB) no formulário de criação/edição, com prévia imediata do arquivo selecionado e substituição/remoção na edição; exibido nas páginas públicas (card na home e página do evento) e nos materiais impressos (crachá, lista de presença e folha com QR Code)
- **Página pública a partir de PDF**: upload opcional de um PDF de até 50 MB no evento, com substituição e remoção administrativas; eventos publicados ou encerrados disponibilizam o documento em `/evento/:id/conteudo`, com visualização incorporada e link direto para o arquivo
- **Avaliação de atividades**: participante inscrito avalia cada atividade em `/evento/:id/atividades` (texto livre de até 2000 caracteres; com o evento encerrado, as inscrições ficam travadas e apenas as avaliações continuam editáveis); o administrador vê as avaliações na chamada da atividade e no relatório do evento (card "Participantes que avaliaram" e lista expansível por atividade)
- **Importação de participantes**: importação administrativa de planilhas CSV ou XLSX, com auto-detecção de delimitador (vírgula ou ponto-e-vírgula), compatibilidade com quebras de linha Windows (CRLF) e Unix (LF), detecção flexível de colunas, criação/atualização de contas, relatório pessoa por pessoa com status (Sucesso/Falha/Ignorado) e download em CSV; via evento (`/admin/events/:id/import-users`) também inscreve os participantes automaticamente; via usuários (`/admin/users/import`) cria apenas contas sem inscrição
- **Submissão de artigos**: formulário público, rascunhos, múltiplos revisores, parecer individual, deliberação final administrativa
- **Revisão**: painel do revisor com artigos pendentes, envio de parecer e recomendação
- **Participantes e papéis**: conta única por pessoa, com papéis independentes por evento (administrador, staff, participante, revisor, palestrante, professor e apresentador); telefone internacional e formação acadêmica (área, curso, titulação, status) editáveis no cadastro de participantes e usuários
- **Papel Staff**: elegibilidade global acionada pela chave **Staff** na listagem de usuários, com designação por evento (Perfis por evento ou página de Papéis); opera os seus eventos — gestão de participantes, presença (manual, em lote e por QR) com impressão de listas, QR de check-in e crachás, edição de atividades e etapas existentes, certificados, artigos/revisões e relatórios do evento — sem poder criar/apagar evento, apagar usuário, criar/apagar atividades/etapas, gerir papéis/salas ou acessar outros eventos e módulos administrativos
- **Primeiro acesso**: contas novas com senha temporária devem trocar a senha e completar identificação, contato, instituição e formação acadêmica antes de acessar os painéis
- **Presença**: atividades/partes configuráveis do evento, com papéis elegíveis e ações explícitas para marcar, atualizar ou remover presença; participantes aparecem somente na chamada das atividades em que estão inscritos; botões de presença em lote ("Marcar presença (todos)" e "Desmarcar presença (todos)") na chamada de cada atividade
- **Presença por QR Code**: botão "QR Presença" na listagem de atividades imprime uma folha letter por etapa (ou da atividade, quando sem etapas) com evento, atividade, data, etapa, **sala** e QR Code (idem na lista de assinaturas); o usuário escaneia o código no dia e marca a própria presença na página pública, no papel que exerce (participante, palestrante, professor ou apresentador), exigindo login e vínculo à atividade para participantes. Alternativamente, cada participante possui um QR Code pessoal (crachá) com código estável por evento em `/evento/:id/qr-presenca` (exibível e imprimível); na chamada, o administrador lê o QR pela câmera (jsQR servido localmente) ou digita o código para marcar a presença da pessoa no papel correspondente
- **Inscrição com aprovação configurável**: cada evento pode confirmar inscrições públicas automaticamente ou submetê-las à análise administrativa. Na análise, a organização pode aprovar todas, algumas ou nenhuma das atividades solicitadas; enquanto aguarda decisão, a pessoa não conta como inscrita nem pode alterar a solicitação.
- **Inscrição por atividade**: seleção explícita na inscrição pública ou inclusão administrativa, edição posterior pelo participante em `/evento/:id/atividades` ou pelo administrador e contadores de inscritos por atividade; em eventos com análise, a seleção decidida pela organização fica bloqueada ao participante. Na página pública, cada atividade com etapas mostra quantas presenças o participante já tem e quais etapas frequentou
- **Horários e salas**: atividades e etapas têm hora de início e término; o administrador cadastra quantas salas quiser por evento, classificadas por tipo (Tipo 1, Tipo 2, Tipo 3, Auditório, Mini Auditório, Foyer, Coffee break, Restaurante e Posters) com capacidade livre informada e nomeadas; a sala é designada por etapa, pela atividade sem etapas ou pelo evento (quando ainda não há atividades, reservando-a em todos os dias do intervalo), com bloqueio automático de sobreposição de horário na mesma sala e verificação transacional; nos formulários de atividade/etapa o seletor de sala traz apenas as salas livres no dia/horário escolhidos, e erros de gravação preservam os dados já digitados
- **Agenda e relatórios de salas**: página `/admin/events/:id/rooms` com CRUD de salas, card "Aguardando sala" (etapas e atividades sem etapas pendentes de alocação) e relatórios imprimíveis de ocupação por dia e agenda por sala; na página pública do evento, o bloco "Programação nas Salas" alterna as visualizações por dia e por sala
- **Certificados**: emissão em PDF por papel no evento (participante, revisor, palestrante, professor e apresentador oral/pôster), com fundo (thumbnails ordenadas alfabeticamente), texto, cor, prévia dinâmica, carga horária em horas-aula quando aplicável, reemissão versionada e botão "Salvar configuração geral" para replicar cor e fundo em todos os tipos de certificado; para participante, cada atividade contabilizada exige inscrição e presença; elegibilidade por "Presença mínima (%)": apresentações oral/pôster e mesas-redondas contam com qualquer presença, e palestras, seminários, minicursos e outras exigem o percentual de etapas presente na atividade
- **Verificação pública**: consulta pública da autenticidade de certificados pelo código de verificação
- **E-mails transacionais**: fila persistente via SMTP/Zoho com master switch global e por evento (ambos desligados por padrão), confirmação de cadastro/aprovação, recebimento e resultado da análise de inscrição, alteração administrativa de atividades, lembrete no dia anterior, certificado emitido/reemitido, alterações de transmissão e autorização explícita após importações; mensagens geradas com envio desativado ficam **supensas** e aparecem no dashboard do superadmin com lista consultável e possibilidade de exclusão definitiva
- **Vínculo de papéis por atividade**: seleção do papel que cada pessoa efetivamente exerce em cada atividade, sem alterar seus papéis administrativos no evento; presenças e cargas horárias são consolidadas separadamente para cada certificado

## Fluxo operacional de atividades e certificados

1. O administrador cria o evento.
2. Em `/admin/events/:id/activities`, cadastra as atividades do evento, como palestras, minicursos e apresentações.
3. O participante seleciona suas atividades durante a inscrição pública ou posteriormente em `/evento/:id/atividades`. Quando o evento exige análise, a organização decide quais atividades aprovar e essa seleção fica bloqueada ao participante. O administrador também pode fazer essa ligação na inclusão ou edição do participante.
4. Em `/admin/events/:id/activities/:activityId/attendance`, o administrador abre a chamada de cada atividade, escolhe o papel exercido e usa os botões para marcar, atualizar ou remover a presença; também pode usar os botões de presença em lote ("Marcar presença (todos)" / "Desmarcar presença (todos)"). Alternativamente, o administrador imprime a folha de presença com QR Code da etapa e, no dia, o usuário escaneia o código, autentica-se e marca a própria presença na página pública.
5. Em `/admin/events/:id/certificates`, são emitidos os certificados elegíveis. Para participante, apenas atividades certificáveis com inscrição e presença entram no certificado e na carga horária.

Uma atividade com presença registrada não pode ser removida da inscrição. A mesma pessoa pode receber certificados distintos pelos diferentes papéis exercidos no evento.

## Instalação e primeiro acesso

Requisito: **Node.js >= 22** (versão travada em `.nvmrc`/`.node-version`, atualmente 22.23.2).
O projeto usa módulos nativos (`better-sqlite3`) e bibliotecas que exigem Node >= 22; o `npm install`
é silencioso em versões antigas, mas o servidor **não sobe**.

```bash
git clone https://github.com/harleyham/geomrit-submissao.git
cd geomrit-submissao
node --version            # >= 22
npm install               # package.json + package-lock.json
npm run verify-env        # (opcional) confirme o ambiente
npm start                 # http://localhost:3000
```

Configure o `.env` na raiz do projeto com `PORT`, `SESSION_SECRET` e SMTP. O `npm start` o carrega automaticamente quando o arquivo existe; se preferir rodar direto com `node server.js`, passe `--env-file=.env` ou exporte as variáveis no shell. Detalhes em `manual.md` (Seção 2).

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
| QR Code | `qrcode` |
| Compactação | `compression` |
| Download ZIP | `archiver` |

## Estrutura

```
artigos/
├── server.js            # Ponto de entrada do Express
├── db.js                # Schema SQLite e helpers de consulta
├── package.json         # Dependências
├── security/            # Módulos de segurança (CSRF, rate limiting, validação)
├── uploads/             # Arquivos enviados (certificados, artigos, logos e PDFs de conteúdo dos eventos)
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

Consulte o [Manual do Sistema](manual.md) para o procedimento operacional completo, incluindo usuários, eventos, atividades, etapas, presença, certificados, dashboard e relatórios.

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
| `SMTP_HOST` | Servidor SMTP | `smtp.zoho.com` |
| `SMTP_PORT` | Porta SMTP | `465` |
| `SMTP_SECURE` | TLS direto (`true` na porta 465) | `true` |
| `SMTP_USER` | Usuário SMTP | — |
| `SMTP_PASS` | Senha de aplicativo SMTP | — |
| `MAIL_FROM_ADDRESS` | Endereço real de envio | valor de `SMTP_USER` |
| `MAIL_FROM_NAME` | Nome global do remetente | `Equipe de Eventos` |
| `MAIL_PLATFORM_NAME` | Identidade global neutra | `Plataforma de Eventos` |
| `MAIL_SIGNATURE` | Assinatura global | `Equipe de Eventos` |
| `MAIL_REPLY_TO` | Contato global | valor do remetente |
| `APP_BASE_URL` | URL pública usada nos links dos e-mails | `http://localhost:3000` |

## Observações

- O banco de dados SQLite (`artigos.db`) é criado automaticamente na primeira execução.
- Mudanças em rotas ou templates exigem reinício do servidor.
- O sistema não possui hot reload nativo.

## Segurança

| Recurso | Descrição |
|---------|-----------|
| Helmet | Headers de segurança (CSP, referrer policy, X-Content-Type-Options) |
| CSRF | Token por sessão, validação timing-safe, aceito por header (`X-CSRF-Token`) ou body (`_csrf`), validação de uploads multipart após o `multer`, 403 em requisições inválidas |
| Sessão | Cookie `httpOnly`, `sameSite=lax`, `secure` em produção; `regenerate()` no login para prevenir session fixation; `SESSION_SECRET` obrigatória (o servidor recusa o início sem ela, evitando sessões quebradas no reinício) |
| Super-admin | Acesso a reset/backup só com conta ativa, aprovada, senha trocada e `is_admin` confirmado no banco (não apenas pelo e-mail na sessão) |
| Rate Limiting | Tetos por rota (login, cadastro, admin) e teto global; IP baseadio na conexão real (sem `trust proxy`), ignorando `X-Forwarded-For` spoofável |
| Senhas | Hash `bcrypt` com fator 10 (senhas legadas são migradas com hash, não em texto puro); política de complexidade unificada (8+ caracteres, maiúscula, minúscula e número) em todas as vias |
| Validação | `express-validator` nas rotas críticas com mensagens localizadas |
| Payload | Limite de 1 MB em JSON e form-urlencoded |
| Sanitização | IDs numéricos validados com `parseInt()` antes de queries SQL |

## Licença

MIT
