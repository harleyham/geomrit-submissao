# Manual do Sistema — Gerência de Eventos

> Guia operacional inicial. Este documento acompanha a versão V0.3 e será ampliado com capturas de tela, exemplos e procedimentos administrativos específicos.

## 1. Introdução

A Gerência de Eventos é um sistema web para organizar eventos acadêmicos e científicos. Ele reúne em um único ambiente:

- cadastro e publicação de eventos;
- inscrição e importação de participantes;
- submissão e revisão de artigos;
- cadastro de atividades e etapas/aulas;
- controle de presença manual e por QR Code;
- configuração, emissão e verificação de certificados;
- estatísticas e relatórios administrativos.

O sistema utiliza uma conta única por pessoa. Os papéis podem variar conforme o evento: administrador, participante, revisor, palestrante, professor, apresentador oral ou apresentador pôster.

## 2. Instalação e primeiro acesso

### Requisitos

- **Node.js >= 22** (versão travada no `.nvmrc`/`.node-version`, atualmente 22.23.2);
- npm disponível;
- ambiente capaz de compilar `better-sqlite3`;
- navegador moderno.

> O projeto usa módulos nativos e bibliotecas que exigem Node >= 22. O `npm install` é silencioso em versões antigas, mas o servidor **não sobe**. Se o `npm start` reclamar da versão, atualize o Node antes de continuar.

### Instalação

```bash
git clone https://github.com/harleyham/geomrit-submissao.git
cd geomrit-submissao

# 1) Node >= 22. Se o nvm estiver presente, ele ativa a versão do .nvmrc automaticamente.
node --version          # deve imprimir 22.x, 23.x, 24.x ...

# 2) Dependências (package.json + package-lock.json).
npm install

# 3) (opcional) Confirme o ambiente antes de rodar.
npm run verify-env
```

### Configurações de ambiente (`.env`)

Crie um arquivo `.env` na raiz do projeto com as variáveis de ambiente (`PORT`, `SESSION_SECRET`, SMTP e as demais). O `npm start` o carrega automaticamente quando o arquivo existe, portanto **basta criá-lo antes de rodar**:

```bash
# crie o .env na raiz do projeto (não versionado)
printf 'PORT=3000\nSESSION_SECRET=\nSMTP_HOST=\nSMTP_PORT=465\nSMTP_SECURE=true\nSMTP_USER=\nSMTP_PASS=\n' > .env
```

Se preferir rodar direto com `node server.js` (sem o wrapper do `npm start`), o `.env` não é lido automaticamente: passe `--env-file=.env` (Node >= 22) ou exporte as variáveis no shell.

Configure ao menos `PORT` e `SESSION_SECRET`. O uso de câmera para QR Code exige HTTPS, exceto em `localhost`.

### Início

```bash
npm start
# O servidor fica disponível, por padrão, em `http://localhost:3000`.
```

O banco `artigos.db` e as pastas de upload são criados automaticamente. Para produção, configure pelo menos `PORT` e `SESSION_SECRET`. O uso de câmera para QR Code exige HTTPS, exceto em `localhost`.

### Conta inicial

| Campo | Valor |
|---|---|
| E-mail | `admin@admin.com` |
| Senha inicial | `123456` |

Troque a senha imediatamente. A conta `admin@admin.com` é o superadministrador e possui acesso às funções sensíveis de backup, restauração e reset do banco.

## 3. Navegação e perfis

Após o login, o usuário é encaminhado conforme seus perfis. Contas com mais de um perfil podem alternar entre `/admin/dashboard`, `/reviewer` e `/author`.

O administrador de evento só deve administrar eventos nos quais possui o papel `admin`. O papel atribuído no evento não altera automaticamente os papéis de outros eventos.

Contas novas podem exigir troca de senha e conclusão do perfil antes de acessar os painéis. Complete nome, país, instituição, telefone e formação acadêmica.

## 4. Criação e administração de usuários

### Cadastro individual

1. Acesse **Administração → Usuários → Novo usuário** (`/admin/users/new`).
2. Informe nome, e-mail, instituição, documentos, telefone e formação acadêmica.
3. Selecione os perfis necessários, como administrador ou revisor.
4. Para revisores, informe as áreas de atuação utilizadas na sugestão de revisores.
5. Salve o cadastro e comunique a senha temporária ao usuário por canal seguro.

Quando o usuário não possui curso de graduação, selecione essa opção. Os campos de titulação e status ficam ocultos e são armazenados como nulos.

### Importação

Há dois fluxos:

- **Por evento** (`/admin/events/:id/import-users`): cria ou atualiza contas e inscreve as pessoas no evento.
- **Por usuários** (`/admin/users/import`): cria ou atualiza contas sem inscrição em evento.

São aceitos CSV e XLSX. A importação identifica delimitador de vírgula ou ponto e vírgula, aceita CRLF/LF e apresenta relatório pessoa a pessoa. Baixe o modelo CSV quando necessário.

Cada linha é conferida para evitar duplicatas: primeiramente pelo e-mail e, quando o arquivo traz o dado, pelo CPF ou passaporte. Linha que já bate com uma conta existente só atualiza os campos informados (nome, instituição, telefone, e-mail, CPF ou passaporte); se nada mudou, ela é sinalizada como sem alterações. Usuário novo é criado já aprovado e ativo. A importação por usuário implica aprovação dos acessos (os e-mails de criação de conta são enfileirados automaticamente — veja mais abaixo); a importação por inscrição em evento segue exigindo autorização manual dos e-mails.

### Inativação e exclusão

Desative **Conta ativa** para impedir novo acesso preservando inscrições, presenças e histórico. A exclusão é mais ampla e pode remover vínculos, presenças, crachá e revisões; use-a somente quando necessário.

## 5. Criação de eventos

1. Acesse **Administração → Eventos → Novo evento** (`/admin/events/new`).
2. Informe nome, sigla, áreas/trilhas, datas e local.
3. Defina o status: **Rascunho**, **Publicado** ou **Encerrado**.
4. Configure as janelas de inscrição, submissão, análise e certificados.
5. Indique se o evento aceita artigos e se oferece subsídio.
6. Defina **Inscrições abertas ao público?**: mantenha ativo para permitir a inscrição do público no site; desative para que apenas a administração cadastre os participantes (a linha "Inscrições" sai do cronograma público e a página de inscrição exibe a mensagem correspondente).
7. Defina **Confirmação das inscrições públicas**: em **Automática**, a inscrição é confirmada assim que enviada; em **Sujeita à análise**, a organização precisa decidir sobre a solicitação.
8. Selecione um logo PNG/JPEG de até 5 MB. A tela mostra a prévia imediatamente.
9. Se o evento não possui site próprio, envie em **Conteúdo do evento em PDF** um documento de até 50 MB com sua programação e demais informações.
10. Salve o evento.

Ao criar o evento, o usuário criador recebe automaticamente o papel de administrador daquele evento. Um evento publicado aparece na página inicial. Ao encerrá-lo, a página pública e os certificados permanecem acessíveis, mas novas inscrições e submissões são bloqueadas.

Na edição, é possível substituir o logo ou marcar **Remover logo atual**. O logo é usado no card da home, página pública, crachás, listas de assinatura e folhas de presença com QR Code.

Quando há um PDF, eventos publicados ou encerrados ganham a URL pública `/evento/:id/conteudo`. Essa página exibe o documento no navegador e oferece o botão **Abrir PDF** como alternativa. Um novo upload substitui o documento anterior; marque **Remover PDF atual** para retirar a publicação. Eventos em rascunho armazenam o arquivo, mas só o disponibilizam publicamente depois da publicação.

## 6. Participantes e papéis no evento

Abra `/admin/events/:id/participants` para incluir, editar ou remover participantes.

Durante a inclusão ou edição:

1. selecione uma conta existente ou crie uma nova;
2. confirme a inscrição no evento;
3. na edição de um participante com conta vinculada, marque os papéis operacionais que a pessoa exerce no evento (palestrante, professor, apresentador oral ou pôster, com o artigo aprovado correspondente);
4. informe as atividades nas quais a pessoa participará, quando aplicável;
5. salve.

Os papéis disponíveis no evento incluem participante, administrador, revisor, palestrante, professor, apresentador oral e apresentador pôster. O formulário de edição do participante edita os papéis operacionais; administrador, revisor e participante são atribuídos na edição do usuário (`/admin/users/:id/edit`), na seção **Perfis por evento**, escolhendo o evento. O papel por atividade é escolhido na chamada e não altera os papéis gerais do evento.

No credenciamento, use **Imprimir crachá** na linha do participante. O crachá contém o QR pessoal usado pelo operador para localizar a pessoa na chamada.

### Análise de solicitações de inscrição

Quando o evento está configurado como **Sujeita à análise**, uma inscrição pública fica com o status **Aguardando análise** e ainda não integra o total de inscritos. Na listagem de eventos, a coluna **Em análise** mostra essas solicitações em laranja quando houver pendências.

Abra a listagem de participantes e use **Analisar** para aprovar ou recusar a solicitação. É possível aprovar todas as atividades solicitadas, somente algumas delas ou nenhuma. A aprovação parcial informa ao participante exatamente quais atividades foram confirmadas. Após a decisão, a seleção de atividades fica somente para leitura para o participante; alterações posteriores devem ser feitas pela administração.

## 7. Criação de atividades

1. Acesse `/admin/events/:id/activities`.
2. Clique em **Nova atividade**.
3. Informe nome, tipo, intervalo/data, carga horária e se a atividade emite certificado. Para **Palestra** e **Minicurso**, preencha também uma descrição breve ou ementa, com até 2000 caracteres.
4. Defina os papéis elegíveis.
5. (Opcional) Informe o **link da transmissão de vídeo** (ex.: YouTube). Ele aparece ao lado do nome da atividade na página pública do evento; deixe vazio para remover.
6. Salve.

Tipos comuns: palestra, seminário, mesa-redonda, minicurso e apresentação oral ou pôster.

Na página pública do evento, a tabela **Atividades do Evento** apresenta a descrição/ementa em uma coluna própria. Para atividades sem esse conteúdo, a coluna exibe um traço.

O participante pode escolher atividades durante a inscrição ou posteriormente em `/evento/:id/atividades`. O administrador também pode fazer essa associação. Em eventos com inscrição sujeita à análise, a seleção aprovada pela organização não pode ser alterada pelo participante.

Na mesma página, o participante pode registrar uma avaliação por atividade inscrita (texto livre de até 2000 caracteres; texto vazio remove a avaliação). Após o encerramento do evento, as inscrições ficam travadas, mas as avaliações continuam editáveis.

## 8. Criação de etapas/aulas

Use etapas quando uma atividade possui várias aulas ou partes, como um minicurso.

1. Na listagem de atividades, abra **Etapas**.
2. Acesse `/admin/events/:id/activities/:activityId/sessions`.
3. Informe nome, ordem, data e carga horária da etapa.
4. Garanta que a data esteja dentro do intervalo da atividade.
5. Salve e repita para as demais etapas.

Com etapas, a presença, a lista impressa e a carga horária do certificado são calculadas por etapa. Uma atividade sem etapas utiliza um único registro geral.

## 9. Presença e QR Code

Na atividade, abra **Presença** em `/admin/events/:id/activities/:activityId/attendance`.

O administrador pode:

- escolher a etapa;
- escolher o papel exercido;
- marcar, atualizar ou remover uma presença;
- marcar ou desmarcar todos;
- ler o QR do crachá pela câmera;
- digitar manualmente o código do crachá;
- imprimir a lista de assinaturas;
- imprimir a folha de presença com QR Code;
- visualizar as avaliações registradas pelos participantes na atividade.

O auto-check-in é feito pela URL `/presenca/:eventId/:activityId(/:sessionId)`. O usuário precisa estar autenticado e vinculado à atividade quando estiver atuando como participante. A presença só pode ser registrada no dia da etapa ou no período da atividade.

## 10. Configuração e emissão de certificados

1. Acesse `/admin/events/:id/certificates`.
2. Configure cada papel de certificado: título, texto, fundo, cor e presença mínima. A cor é escolhida numa paleta de 64 tons (grade 8×8).
3. Use a prévia antes de salvar.
4. Use **Salvar configuração geral** para replicar fundo e cor aos papéis, mantendo textos individuais.
5. Emita os certificados elegíveis.
6. Reemita quando necessário; cada emissão mantém sua versão.

Regras principais:

- participante precisa estar inscrito na atividade e ter presença;
- palestras, seminários, minicursos e outras atividades usam o percentual mínimo de etapas;
- apresentações e mesas-redondas qualificam com qualquer presença;
- a carga horária é a soma das etapas presentes;
- revisor é elegível quando possui parecer enviado.

O certificado pode ser baixado pelo participante e verificado publicamente pelo código de autenticidade.

## 11. Dashboard administrativo

O dashboard (`/admin/dashboard`) apresenta um resumo operacional:

- total de usuários;
- eventos realizados;
- inscritos em eventos futuros;
- artigos sem revisor;
- artigos em análise;
- artigos prontos para deliberação;
- revisores ativos e inativos;
- pedidos de subsídio;
- solicitações de cadastro.

Use os cards como atalhos para localizar pendências.

### Backup, restauração e reset do banco

A seção "Backup e Restaração" no dashboard concentra as operações de manutenção do banco de dados, acessíveis **exclusivamente** ao `admin@admin.com` (superadministrador):

- **Baixar Backup**: gera um ZIP com o banco (`artigos.db`), a pasta `uploads/` completa e um `BACKUP_META.json` (versão, data, tamanhos). Útil para sincronizar o estado entre as máquinas de desenvolvimento.
- **Restaurar Backup**: faz upload de um ZIP válido, confirma a ação digitando `RESTAURAR` e substitui o banco e os uploads. Antes de trocar, o sistema faz uma cópia de segurança do banco atual e rola de volta em caso de falha.
- **Resetar Banco de Dados**: apaga todas as tabelas, arquivos de upload e recria o banco limpo, com schema, índices, triggers e o seed do administrador padrão.

Backup e restauração não exigem reinício do servidor — a conexão é trocada em tempo de execução.

### Envio de e-mail individual

No card **Envio global de e-mails** do dashboard, visível apenas ao `admin@admin.com`, há um formulário para enviar uma mensagem a um destinatário único. Os campos são:

- **Destinatário**: endereço de e-mail do destinatário;
- **Assunto**;
- **Mensagem**;
- **Enviar e-mail**.

A mensagem é enfileirada e exibida na lista "Mensagens pendentes" com data de criação e disponibilidade formatadas em `dd/mm/aaaa hh:mm` (horário de Brasília). A lista e o contador de pendentes se atualizam automaticamente na página (a cada 15 segundos, sem recarregar): conforme os e-mails vão sendo enviados, eles saem da listagem sozinhos; quando a fila esvazia, o bloco "Ver mensagens pendentes" desaparece. O envio respeita o master switch global: quando ele está desativado, a mensagem fica na fila como suspensa e só é enviada após a reativação. O sistema tentaria enviar automaticamente, mas a saída para o servidor SMTP depende da rede/local de execução.

Quando a fila apresenta mensagens pendentes, aparece o botão **Limpar fila de e-mails** acima da lista "Ver mensagens pendentes". Ele cancela todas as mensagens da fila de uma vez, removendo-as da exibição e impedindo seu envio. Antes de executar, o sistema pede confirmação; a ação é restrita ao `admin@admin.com` e registrada na trilha de auditoria dos e-mails. Os registros são marcados como cancelados (não excluídos), preservando o histórico.

## 12. Estatísticas e relatórios

Abra `/admin/reports` e selecione o evento. O relatório consolida:

- estatísticas de artigos e pareceres;
- participantes, autores e papéis;
- atividades, inscrições e presenças;
- avaliações dos participantes por atividade (card "Participantes que avaliaram" e listas expansíveis por atividade);
- certificados emitidos;
- pedidos de subsídio;
- listagens para impressão.

É possível selecionar as seções antes de imprimir ou exportar pelo diálogo de impressão do navegador. A deliberação final do artigo também pode ser registrada pela página administrativa correspondente.

## 13. Fluxo recomendado de um evento

1. Criar o evento e publicar as janelas.
2. Cadastrar ou importar usuários.
3. Inscrever participantes e associar atividades.
4. Criar atividades e etapas.
5. Configurar certificados.
6. Realizar o credenciamento e registrar presenças.
7. Acompanhar artigos, pareceres e deliberações.
8. Emitir certificados.
9. Consultar relatórios e encerrar o evento.

## 14. Solução de problemas

- Após alterar rotas, serviços ou `server.js`, reinicie o servidor.
- Se o logo não aparecer, confirme que o arquivo existe em `uploads/event-logos/` e que `logo_path` está preenchido no evento.
- Para câmera de QR Code em produção, use HTTPS; em outros ambientes, digite o código manualmente.
- Se uma ação administrativa retornar acesso negado, confirme se o usuário possui o papel `admin` naquele evento.
- Se uma conta não conseguir acessar o painel, verifique aprovação, conta ativa, troca de senha e conclusão do perfil.

## 15. E-mails transacionais

O envio possui dois níveis de autorização: o **master switch global**, restrito ao superadministrador, e o switch de cada evento. Ambos começam desligados. O global pode ser alterado no dashboard ou em `/admin/events`; o switch do evento também aparece na listagem e no card **Identidade dos e-mails** da criação/edição.

Além dos envios automáticos, o `admin@admin.com` pode mandar um e-mail para um endereço específico diretamente do card **Envio global de e-mails** no dashboard (`/admin/dashboard`): um campo de destinatário, um de assunto, um de mensagem e um botão **Enviar e-mail**. A mensagem entra na fila (respeitando o master switch) e pode ser acompanhada em **Ver mensagens pendentes**. Detalhes dessa funcionalidade estão na seção **Envio de e-mail individual** (Seção 11).

Ao desligar um switch, mensagens pendentes do respectivo escopo são canceladas e não retornam ao reativar. O sistema nunca bloqueia cadastro, aprovação, emissão ou importação por indisponibilidade do SMTP.

O card do evento permite definir nome da plataforma, nome exibido do remetente, assinatura e e-mail de contato (`Reply-To`). Mensagens do evento usam seu logo quando configurado; sem logo, não há imagem padrão.

A importação de usuários em **Usuários** (`/admin/users/import`) envia automaticamente os e-mails de criação de conta: como o admin que importa já aprova os acessos, os novos usuários recebam imediatamente o link individual de uso único para definir senha (válido por 72 horas), sem clique adicional. Senhas nunca são enviadas por e-mail. A autorização só é manual quando o master switch global está desativado — nesse caso, a página de resultado exibe um aviso e os e-mails ficam pendentes até a reativação e a autorização pelo admin. Já a importação de inscrições em eventos (`/admin/events/:id/import-users`) continua exigindo **Autorizar e-mails aos participantes** na página de resultado.

Nas inscrições públicas, o participante recebe uma confirmação imediata ou um aviso de recebimento para análise, conforme a configuração do evento. Depois da análise, recebe o resultado como aprovado, parcialmente aprovado (com as atividades confirmadas) ou recusado. Também recebe aviso quando a administração altera suas atividades.

Configure o Zoho por variáveis de ambiente (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`) e defina `APP_BASE_URL` com a URL pública da instalação.

## 16. Próximas melhorias do manual

- adicionar capturas de tela de cada fluxo;
- documentar o fluxo completo de submissão e revisão de artigos;
- incluir perguntas frequentes para participantes e revisores;
- registrar procedimentos de implantação em produção e configuração HTTPS;
- revisar o manual a cada nova versão do sistema.
