# Manual do Sistema — Gerência de Eventos

> Guia operacional inicial. Este documento acompanha a versão V0.32 e será ampliado com capturas de tela, exemplos e procedimentos administrativos específicos.

## 1. Introdução

A Gerência de Eventos é um sistema web para organizar eventos acadêmicos e científicos. Ele reúne em um único ambiente:

- cadastro e publicação de eventos;
- inscrição e importação de participantes;
- submissão e revisão de artigos;
- cadastro de atividades e etapas/aulas, com horários e salas;
- gestão de salas por tamanho, alocação sem sobreposição e relatórios de ocupação;
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
| Senha inicial | Valor de `SUPER_ADMIN_INITIAL_PASSWORD`, definido pelo operador antes de criar ou resetar o banco |

Use uma senha inicial forte e troque-a no primeiro acesso. Sem `SUPER_ADMIN_INITIAL_PASSWORD`, um banco novo ou reset não é criado. A conta `admin@admin.com` é o superadministrador e possui acesso às funções sensíveis de backup, restauração e reset do banco.

## 3. Navegação e perfis

Após o login, o usuário é encaminhado conforme seus papéis, consultados no banco a cada acesso: `admin@admin.com` vai para `/admin/dashboard`; quem é administrador ou staff de algum evento vai para `/admin/events`; quem tem papel **Revisor** em pelo menos um evento pode alternar com `/reviewer`; as demais contas aprovadas vão para `/author` (Área do Participante). Não existem mais papéis globais: participante, revisor, palestrante, professor, apresentador e staff são exercidos **por evento**.

O administrador de evento administra apenas os eventos nos quais possui o papel `admin` (e, nos artigos e relatórios, enxerga só os seus eventos). O papel atribuído em um evento não altera os demais eventos nem o cadastro global da pessoa.

Contas novas podem exigir troca de senha e conclusão do perfil antes de acessar os painéis. Complete nome, país, instituição, telefone e formação acadêmica.

## 4. Criação e administração de usuários

A área de usuários (`/admin/users` — cadastro, edição, reset de senha, aprovação, importação global e a prévia "Área do Participante") é **exclusiva do superadministrador** (`admin@admin.com`). Os demais usuários gerenciam pessoas apenas dentro dos seus eventos (participantes, importação por evento e página de Papéis). Quem precisa trocar a própria senha sem ser o superadmin usa **Alterar Senha** na Área do Participante (`/author/profile`).

Ao usar a prévia "Área do Participante" de um usuário, a sessão passa a navegar como ele e **todas as páginas** mostram uma tarja laranja no topo: "Visualização administrativa como \<pessoa\> — ações são registradas em nome deste usuário". Clique em **Sair da visualização** na própria tarja (ou acesse qualquer página de `/admin/*`) para encerrar a prévia e retomar a sessão de administrador.

### Cadastro individual

1. Acesse **Administração → Usuários → Novo usuário** (`/admin/users/new`).
2. Informe nome, e-mail, instituição, documentos, telefone e formação acadêmica.
3. Para quem fará revisão, informe as áreas de atuação (usadas na sugestão de revisores). O papel de revisor em si é atribuído **por evento**, na página de Papéis.
4. Salve o cadastro e comunique a senha temporária ao usuário por canal seguro.

> As antigas chaves globais (**Administrador**, **Revisor**, **Staff**, **Participante**, **Palestrante**, **Professor**, **Apresentador**) foram removidas da criação/edição e da listagem de usuários: todos os papéis são **por evento**, atribuídos em `/admin/events/:id/roles`. As colunas `is_*` permanecem no banco por compatibilidade, mas não autorizam mais nada. A flag `is_admin` sobrevive apenas no seed do superadministrador (`admin@admin.com`). A listagem de usuários agora mostra quantos papéis a pessoa exerce, por resumo.

Quando o usuário não possui curso de graduação, selecione essa opção. Os campos de titulação e status ficam ocultos e são armazenados como nulos.

### Reset de senha

Na listagem de usuários, o botão **Resetar Senha** (disponível também na linha do usuário logado, com aviso de que a senha atual deixará de valer) gera uma senha temporária (a antiga deixa de valer e a troca passa a ser obrigatória no primeiro acesso) e envia ao usuário um **e-mail com link de uso único** (válido por 72 horas) para ele definir a nova senha — a senha não transita no e-mail. Se o envio de e-mails estiver **desativado** (master switch global) ou a conta **não tiver e-mail**, o sistema abre uma página mostrando a senha temporária para você comunicá-la por canal seguro.

### Cadastro público sem senha

O formulário "Solicitar Cadastro" (`/cadastro`) não pede senha. Além de nome, e-mail e instituição, o **e-mail deve ser repetido no campo "Confirme E-mail"**; o envio só é aceito quando os dois valores conferem, com validação feita no navegador e também no servidor (recusa o cadastro com aviso quando difiram). Após o envio, o usuário é encaminhado para a página de confirmação (/cadastro/sucesso), onde são relembrados que a conta ficará em análise e que devem verificar o e-mail — inclusive a caixa de Lixo Eletrônico ou Spam — para receber o. A conta é criada em análise com senha interna inutilizável; ao aprovar o cadastro, o usuário recebe um **e-mail com link de uso único (72h)** para definir a própria senha (`/definir-senha`) e só então faz login e completa o perfil. O e-mail de aprovação enviado pelo superadministrador na criação de usuários em `/admin/users` segue o mesmo padrão. Senhas nunca são enviadas por e-mail; quem perder o link usa "Esqueci a senha" na `/login`.

### Importação

Há dois fluxos:

- **Por evento** (`/admin/events/:id/import-users`): disponível para o administrador do evento (e para o superadmin); cria ou atualiza contas e já inscreve as pessoas no evento.
- **Por usuários** (`/admin/users/import`): exclusiva do superadmin; cria ou atualiza contas sem inscrição em evento.

São aceitos CSV e XLSX. A importação identifica delimitador de vírgula ou ponto e vírgula, aceita CRLF/LF e apresenta relatório pessoa a pessoa. Baixe o modelo CSV quando necessário.

Cada linha é conferida para evitar duplicatas: primeiramente pelo e-mail e, quando o arquivo traz o dado, pelo CPF ou passaporte. Linha que já bate com uma conta existente só atualiza os campos informados (nome, instituição, telefone, e-mail, CPF ou passaporte); se nada mudou, ela é sinalizada como sem alterações. Usuário novo é criado já aprovado e ativo. A importação por usuário implica aprovação dos acessos (os e-mails de criação de conta são enfileirados automaticamente — veja mais abaixo); a importação por inscrição em evento segue exigindo autorização manual dos e-mails.

### Inativação e exclusão

Desative **Conta ativa** para impedir novo acesso preservando inscrições, presenças e histórico. A exclusão permanente é bloqueada quando a conta possui histórico (inscrições em eventos, artigos submetidos ou certificados emitidos) — nesses casos use a desativação; a exclusão direta só é aceita para contas sem histórico.

## 5. Criação de eventos

**Qualquer usuário autenticado pode criar eventos**: acesse **Meus Eventos** (`/admin/events`, botão na Área do Participante) e clique **+ Novo Evento**, ou abra `/admin/events/new` diretamente. Na tela **Meus Eventos**, o menu superior dos usuários **não superadministradores** traz o link **Área do Participante** para voltar à área (`/author`). O superadministrador (`admin@admin.com`) vê e administra **todos** os eventos do sistema em `/admin/events`, mesmo sem papel atribuído neles.

1. Acesse **Administração → Eventos → Novo evento** (`/admin/events/new`).
2. Informe nome, sigla, áreas/trilhas, datas e local.
3. Defina o status: **Rascunho**, **Publicado** ou **Encerrado**. Na listagem de **Meus Eventos**, botões rápidos alternam o status: **Publicar** (rascunho), **Voltar para Rascunho** (publicado — sai da página inicial e as páginas públicas do evento passam a dar 404), **Encerrar** (publicado) e **Reabrir** (encerrado, que devolve o evento à condição de publicado); na edição, o botão **Reabrir Evento** aparece para eventos encerrados.
4. Configure as janelas de inscrição, submissão, análise e certificados.
5. Indique se o evento aceita artigos e se oferece subsídio.
6. Defina **Inscrições abertas ao público?**: mantenha ativo para permitir a inscrição do público no site; desative para que apenas a administração cadastre os participantes (a linha "Inscrições" sai do cronograma público e a página de inscrição exibe a mensagem correspondente).
7. Defina **Confirmação das inscrições públicas**: em **Automática**, a inscrição é confirmada assim que enviada; em **Sujeita à análise**, a organização precisa decidir sobre a solicitação.
8. Selecione um logo PNG/JPEG de até 5 MB. A tela mostra a prévia imediatamente.
9. Se o evento não possui site próprio, envie em **Conteúdo do evento em PDF** um documento de até 50 MB com sua programação e demais informações.
10. Salve o evento.

Ao criar o evento, o usuário criador recebe automaticamente o papel de administrador daquele evento, podendo gerenciá-lo por completo e delegar papéis (inclusive o de administrador do evento) na página de Papéis (`/admin/events/:id/roles`). A página **Meus Eventos** lista apenas os eventos que o usuário administra ou onde é staff. Um evento publicado aparece na página inicial. Ao encerrá-lo, o evento deixa de figurar na lista principal e passa ao bloco **Eventos Encerrados** da página inicial; a página pública e os certificados permanecem acessíveis, mas novas inscrições e submissões são bloqueadas.

Na edição, é possível substituir o logo ou marcar **Remover logo atual**. O logo é usado no card da home, página pública, crachás, listas de assinatura e folhas de presença com QR Code.

Quando há um PDF, eventos publicados ou encerrados ganham a URL pública `/evento/:id/conteudo`. Essa página exibe o documento no navegador e oferece o botão **Abrir PDF** como alternativa. Um novo upload substitui o documento anterior; marque **Remover PDF atual** para retirar a publicação. Eventos em rascunho armazenam o arquivo, mas só o disponibilizam publicamente depois da publicação.

## 6. Participantes e papéis no evento

Abra `/admin/events/:id/participants` para incluir, editar ou remover participantes. Na edição de uma inscrição com conta vinculada, o **administrador do evento** altera apenas os dados relativos ao evento (tipo de participante, atividades e papéis); **nome, e-mail, instituição, telefone e formação acadêmica são dados da conta e aparecem somente-leitura** — quem os altera é o superadministrador (`admin@admin.com`), que pode editar tudo também por essa tela (alterações no cadastro se refletem automaticamente nas inscrições).

Durante a inclusão ou edição:

1. selecione uma conta existente ou crie uma nova;
2. confirme a inscrição no evento;
3. na edição de um participante com conta vinculada, marque os papéis operacionais que a pessoa exerce no evento (palestrante, professor, apresentador oral ou pôster, com o artigo aprovado correspondente);
4. informe as atividades nas quais a pessoa participará, quando aplicável;
5. salve.

Os papéis disponíveis no evento incluem participante, administrador, **revisor**, palestrante, professor, apresentador oral e apresentador pôster — todos **exclusivamente por evento**. A página de Papéis (`/admin/events/:id/roles`) lista como candidatos apenas **inscritos no evento** (ou quem já tem papel nele); o superadmin pode atribuir a qualquer conta aprovada. Atribuir um papel **não altera mais nenhum dado do cadastro global** da pessoa. O participante comum não precisa de papel: a inscrição basta. O papel por atividade é escolhido na chamada e não altera os papéis gerais do evento. O painel de revisão (`/reviewer`) fica disponível a quem tem papel `reviewer` em pelo menos um evento; o administrador só pode atribuir revisores entre os inscritos do seu evento.

**Toda inscrição possui conta vinculada** (garantia imposta pelo banco de dados). Registros históricos sem vínculo são corrigidos automaticamente na inicialização do sistema: a inscrição é ligada à conta com o mesmo e-mail ou, se não existir conta, uma nova é criada (aprovada, com senha desconhecida — use **Resetar Senha** na listagem de usuários para enviar o link de definição por e-mail). Por isso a coluna "Conta" nunca mais exibe "Sem vínculo de conta".

No credenciamento, use **Imprimir crachá** na linha do participante. O crachá contém o QR pessoal usado pelo operador para localizar a pessoa na chamada.

### Papel Staff

O papel **Staff** é uma designação **exclusivamente por evento**, atribuída na página de Papéis (`/admin/events/:id/roles`) ou na seção **Perfis por evento** da edição de usuário (restrita ao superadmin). Não existe mais elegibilidade global: desligar contas não revoga papéis, e remover o papel na página de Papéis é o que encerra a designação. O acesso efetivo do Staff limita-se **apenas aos eventos em que foi designado**.

Dentro dos seus eventos, o Staff concentra a operação, sem ser administrador:

- **pode**: gerenciar participantes (adicionar, editar, importar, analisar inscrições, remover a inscrição), abrir a chamada e marcar/atualizar/desfazer presença (manual, em lote e por QR), imprimir listas de presença, folhas de QR de check-in e crachás, **editar** atividades e etapas existentes, gerenciar **certificados**, e consultar **artigos/revisões** e **relatórios** daquele evento;
- **não pode**: criar ou **apagar evento**, **apagar usuário**, **criar ou apagar atividades e etapas**, gerenciar papéis, salas, publicar/encerrar ou editar o evento, e acessar os demais módulos administrativos (dashboard, usuários, outros eventos).

O Staff entra pelo menu **Eventos**, que lista apenas os seus eventos, com as entradas de participação, presença, certificados, artigos e relatórios. Rotas administrativas fora dessa alçada retornam **Acesso negado**. O Staff não é promovido a administrador de sessão.

### Análise de solicitações de inscrição

Quando o evento está configurado como **Sujeita à análise**, uma inscrição pública fica com o status **Aguardando análise** e ainda não integra o total de inscritos. Na listagem de eventos, a coluna **Em análise** mostra essas solicitações em laranja quando houver pendências.

Abra a listagem de participantes e use **Analisar** para aprovar ou recusar a solicitação. É possível aprovar todas as atividades solicitadas, somente algumas delas ou nenhuma. A aprovação parcial informa ao participante exatamente quais atividades foram confirmadas. Após a decisão, a seleção de atividades fica somente para leitura para o participante; alterações posteriores devem ser feitas pela administração.

## 7. Criação de atividades

1. Acesse `/admin/events/:id/activities`.
2. Clique em **Nova atividade**.
3. Informe nome, tipo, intervalo/data, **hora de início e hora de término**, carga horária e se a atividade emite certificado. Para **Palestra** e **Minicurso**, preencha também uma descrição breve ou ementa, com até 2000 caracteres. **Carga horária**: se informada (> 0), é a carga total da atividade e **prevalece sobre as etapas** — as etapas ficam sem carga própria (zeradas e bloqueadas na edição); se deixada vazia, a carga da atividade é a **soma das cargas das etapas**.
4. Defina os papéis elegíveis.
5. (Opcional) Selecione a **sala** da atividade — disponível quando a atividade não possui etapas (veja a Seção 9).
6. (Opcional) Informe o **link da transmissão de vídeo** (ex.: YouTube). Ele aparece ao lado do nome da atividade na página pública do evento; deixe vazio para remover.
7. Salve.

Tipos comuns: palestra, seminário, mesa-redonda, minicurso, apresentação oral ou pôster e **atividades extras** (café da manhã, coffee break, brunch, almoço e jantar). As atividades extras funcionam como quaisquer outras (etapas, salas, chamada, certificados), a diferença é que **não podem ser marcadas como interesse nem escolhidas para participação** pelo participante (não aparecem na lista de escolha de atividades da inscrição pública nem no formulário administrativo do participante). O formulário de atividade também permite definir o **número máximo de participantes** (vazio = sem limite), se a **inscrição exige aprovação** da organização e se a atividade é **Obrigatória para participantes** — com essa flag, todos os participantes do evento são inscritos nela automaticamente: nos pontos de escolha do participante ela aparece **marcada e não pode ser desmarcada** (badge "Obrigatória"). A flag só é oferecida quando o papel "Participante" está elegível e o tipo não é logístico. Minicurso obrigatório é inscrito automaticamente respeitando vagas — se esgotado, fica para a organização inscrever manualmente — e não pode ser desmarcado pelo participante. Em eventos com inscrição sujeita a análise, a obrigatória entra no pedido e é aprovada automaticamente. — a listagem administrativa mostra "Inscritos: N/M", com destaque "Vagas esgotadas" quando o limite é atingido (o administrador pode inscrever além do limite; o contador fica vermelho).

Na página pública do evento (`/evento/:id`), a seção **Atividades do Evento** oferece três visualizações alternáveis: **Cards** (padrão, agrupados por tipo, no mesmo formato do painel administrativo), **Lista** e **Grade (dia × hora)**, esta com os dias nas colunas, o horário de início nas linhas e, em cada célula, o intervalo de horário (início–fim) e o nome das atividades/etapas. Nas visões **Lista** e **Grade** e na **Programação nas Salas**, o nome da atividade/etapa aparece na **cor do seu tipo** (a mesma dos badges "SEMINÁRIO, MINICURSO..." da visão Cards); horários e demais colunas mantêm cor neutra. Uma atividade sem etapas cadastrada com intervalo de vários dias aparece em **todos os dias** do intervalo. Cada atividade exibe nome, descrição/ementa, data e horário; quando **não tem etapas**, mostra também a **sala**; quando **tem etapas**, cada etapa aparece com data, horário e sala.

A quarta visualização, **Grade (dia × hora) – Barras**, posiciona cada atividade/etapa como uma **barra retangular da cor do seu tipo** no eixo de horários do dia: o eixo vai da primeira à última hora ocupada do evento (56px por hora, com linhas-guia), e a barra cobre do horário de início ao de término. Quando há atividades no mesmo período, a coluna do dia é dividida em faixas iguais — quantas atividades simultâneas, tantas barras lado a lado. Etapas aparecem com o rótulo "Atividade : Etapa"; atividade sem etapas com intervalo de vários dias repete a barra em todos os dias; sem horário de término, a barra cobre 1 hora; etapa com data mas sem horário aparece como barra do dia inteiro. Passe o mouse sobre a barra para ver o horário completo e o nome no tooltip.

O botão **Etapas** aparece somente nas atividades que possuem etapas e abre a página pública somente-leitura `/evento/:id/atividades/:activityId/etapas` (sem nenhum campo de edição), com #, nome, data, horário, sala, carga e transmissão de cada etapa.

O participante escolhe atividades durante a inscrição e pode reconfigurá-las na própria página de inscrição (`/evento/:id/inscricao`); o administrador também pode fazer essa associação. **As atividades extras (café da manhã, coffee break, brunch, almoço e jantar) não aparecem como opções de escolha do participante** — na inscrição pública e no formulário administrativo do participante elas são omitidas (a presença nelas é registrada normalmente na chamada). **Atividades obrigatórias aparecem marcadas, com badge "Obrigatória", e não podem ser desmarcadas** pelo participante (a obrigação é reforçada no servidor em todas as rotas de escolha). A página `/evento/:id/atividades` lista **somente as atividades em que a pessoa está inscrita** (com as avaliações de cada uma), mais a seção "Atividades de meu interesse". Em eventos com inscrição sujeita à análise, a seleção aprovada pela organização não pode ser alterada pelo participante.

Na mesma página, o participante pode registrar uma avaliação por atividade inscrita (texto livre de até 2000 caracteres; texto vazio remove a avaliação). Após o encerramento do evento, as inscrições ficam travadas, mas as avaliações continuam editáveis.

**Atividades de meu interesse:** o participante inscrito e aprovado pode marcar, na visão **Cards** de "Atividades do Evento" na página do evento (`/evento/:id`), as atividades que deseja assistir — **todos os tipos, exceto minicursos**, que exigem inscrição, e **exceto as atividades extras** (café da manhã, coffee break, brunch, almoço e jantar). Cada marcação/desmarcação é **salva automaticamente** (um indicador "✓ Interesses salvos" confirma a gravação; sem JavaScript no navegador, usa-se o botão **Salvar interesses**). A escolha é somente de preferência (não substitui a inscrição nem gera presença) e aparece na seção **"Atividades de meu interesse"** de `/evento/:id/atividades`, de onde também se retorna ao evento para alterá-la. Quem estiver logado sem inscrição vê apenas um aviso com link para se inscrever; com o evento encerrado, os interesses não podem mais ser alterados.

**Inscrição em minicursos pela página do evento:** na visão **Cards**, cada minicurso aberto a participantes traz um **checkbox de inscrição** com a indicação de vagas ("Restam X vagas" ou "Esgotado"). Se a pessoa já estiver inscrita, o checkbox aparece marcado e bloqueado ("✓ Inscrito"). Ao marcar, a inscrição é **imediata** quando não há análise exigida (e houver vaga — sem vaga o sistema avisa e desfaz a marcação); há exigência de análise quando o **evento** está configurado com "inscrição a ser analisada" (nesse caso o formulário de atividade mostra o checkbox "exige aprovação" **marcado e travado**, pois a exigência vem do evento) ou quando o **minicurso** tem o checkbox de aprovação marcado (livre apenas em eventos de inscrição automática). Com exigência de análise, o clique registra um **pedido** ("Pedido em análise") que a organização decide na edição do participante, com botões **"Sim (aprovar)" / "Não (negar)"** (a lista de participantes mostra "N pedido(s) de atividade aguardando análise" e o dashboard admin lista os pedidos pendentes). Ao **negar**, a pessoa não consegue solicitar de novo: o checkbox dela na página do evento fica travado em não inscrito com o aviso "Pedido negado pela organização" (para voltar atrás, inscreva-a manualmente na atividade). Desmarcar cancela a inscrição, salvo se a pessoa já tiver presença registrada na atividade. Quem não tiver inscrição aprovada no evento vê o checkbox bloqueado com uma dica.

## 8. Criação de etapas/aulas

Use etapas quando uma atividade possui várias aulas ou partes, como um minicurso.

1. Na listagem de atividades, abra **Etapas**.
2. Acesse `/admin/events/:id/activities/:activityId/sessions`.
3. Informe nome, ordem, data, **hora de início e hora de término** e carga horária da etapa. Quando a atividade já tem carga horária definida, o campo fica **desabilitado** (a carga total vem da atividade e as etapas não têm carga própria).
4. Garanta que a data esteja dentro do intervalo da atividade (e os horários dentro do horário da atividade, quando a atividade ocupa um único dia).
5. (Opcional) Selecione a **sala** da etapa (veja a Seção 9).
6. Salve e repita para as demais etapas.

Com etapas, a presença e a lista impressa são calculadas por etapa. A carga horária da atividade é a carga definida na atividade (> 0), senão a soma das cargas das etapas; o certificado (quando a atividade qualifica pelo percentual de presença) vale essa carga **total**, mesmo que a pessoa não tenha frequentado todas as etapas. Uma atividade sem etapas utiliza um único registro geral.

As etapas também ficam disponíveis ao público na página somente-leitura `/evento/:id/atividades/:activityId/etapas`, acessível pelo botão **Etapas** na seção de atividades da página pública (o botão só surge quando a atividade tem etapas).

## 9. Salas, horários e agenda

### Cadastro de salas

1. Na listagem de eventos, abra **Salas** (`/admin/events/:id/rooms`).
2. Cadastre quantas salas desejar para o evento, dando um nome a cada uma, escolhendo o **tipo** e informando a **capacidade** (livre, em lugares, para qualquer tipo):
   - **Tipo 1**, **Tipo 2** e **Tipo 3**;
   - **Auditório** e **Mini Auditório**;
   - **Foyer**, **Coffee break**, **Restaurante** e **Posters**.
   - Todos os tipos têm capacidade livre, informada pelo administrador (opcional; se preenchida, deve ser inteiro maior que zero).
3. Salas com alocações na agenda não podem ser excluídas; remova as alocações primeiro.

### Alocação de salas

A sala pode ser designada em três níveis, respeitando esta prioridade:

1. **Etapa** — quando a atividade possui etapas, a sala é sempre alocada por etapa (formulário de etapa).
2. **Atividade** — quando a atividade não possui etapas, a sala é alocada no formulário da atividade, usando a data e os horários cadastrados (em atividades de vários dias, a reserva vale no dia de início).
3. **Evento** — quando o evento ainda não possui atividades, é possível reservar uma sala no card **Sala do evento**: a sala fica bloqueada no horário informado em todos os dias entre o início e o fim do evento.

O sistema **não permite sobreposição**: se a sala já estiver ocupada na data e no horário pretendidos, a gravação é recusada com a indicação do conflito (sala, responsável e horário). A verificação é feita em transação — a atividade/etapa só é salva se a alocação couber na agenda.

Para evitar conflito, o seletor de **Sala** nos formulários de atividade e etapa lista **apenas as salas livres** para a data e o horário informados, atualizando-se automaticamente conforme esses campos mudam (a sala já atribuída à própria atividade/etapa permanece selecionável). Caso a gravação ainda assim falhe por validação ou conflito, o formulário é reexibido **com todos os dados já preenchidos**, sem exigir redigitação.

O card **Aguardando sala** na página de salas lista as etapas e as atividades sem etapas que ainda não têm sala, com o botão **Alocar sala** que abre diretamente o formulário de edição correspondente.

### Relatórios e agenda

- **Ocupação por dia** (`/admin/events/:id/rooms/occupancy`): para cada dia com alocações, as salas e os horários ocupados, com botão de impressão/PDF.
- **Agenda por sala** (`/admin/events/:id/rooms/agenda`): cada sala com suas atividades, etapas e reservas em ordem cronológica, com botão de impressão/PDF.
- Na página pública do evento (`/evento/:id`), o bloco **Programação nas Salas** aparece quando há alocações, com alternância **Por dia** / **Por sala**. Os itens são exibidos com o nome da atividade (somente o nome quando não há etapas), como `Atividade: Etapa` (quando há etapas) ou como "Reserva do evento" (reserva do evento inteiro).
- Logo abaixo, a seção **Transmissões** lista as atividades e etapas que terão vídeo (link próprio ou herdado da atividade), em ordem cronológica, com botão "Assistir transmissão"; atividades marcadas com "Haverá transmissão" mas ainda sem link aparecem com o aviso "Transmissão prevista — link a ser divulgado". A seção só aparece quando o evento tem ao menos uma transmissão configurada.
- Nos **Cards** da seção **Atividades do Evento**, a sala aparece ao lado da atividade sem etapas e de cada etapa (apenas o nome da sala).
- Na visão **Lista** da mesma seção, cada linha exibe também o **horário** e a **sala** da atividade/etapa.

## 10. Presença e QR Code

Na atividade, abra **Presença** em `/admin/events/:id/activities/:activityId/attendance`.

O administrador pode:

- escolher a etapa;
- escolher o papel exercido;
- marcar, atualizar ou remover uma presença;
- marcar ou desmarcar todos;
- ler o QR do crachá pela câmera;
- digitar manualmente o código do crachá;
- imprimir a lista de assinaturas (a sala aparece no cabeçalho);
- imprimir a folha de presença com QR Code (a sala aparece no cabeçalho, abaixo da data);
- visualizar as avaliações registradas pelos participantes na atividade.

O auto-check-in é feito pela URL `/presenca/:eventId/:activityId(/:sessionId)`. O usuário precisa estar autenticado e vinculado à atividade quando estiver atuando como participante. A presença só pode ser registrada no dia da etapa ou no período da atividade.

## 11. Configuração e emissão de certificados

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
- a carga horária é a carga total efetiva da atividade qualificada: a carga definida na atividade (> 0), senão a soma das cargas das etapas (não importa quantas etapas a pessoa frequentou);
- revisor é elegível quando possui parecer enviado.
- fundos enviados na **Biblioteca de fundos** pertencem ao evento onde foram enviados: os demais eventos não os veem nem podem usá-los; os fundos padrão são compartilhados por todos os eventos.
- o card **Biblioteca de fundos** mostra as miniaturas dos fundos do evento com **Renomear** e **Excluir**; a exclusão é bloqueada enquanto houver certificados emitidos usando o fundo, e as regras que o utilizavam ficam sem fundo até você selecionar outro.

O certificado pode ser baixado pelo participante e verificado publicamente pelo código de autenticidade.

## 12. Dashboard administrativo

O dashboard (`/admin/dashboard`) é exclusivo do superadministrador (`admin@admin.com`) e apresenta um resumo operacional:

- total de usuários;
- eventos realizados;
- inscritos em eventos futuros;
- artigos sem revisor;
- artigos em análise;
- artigos prontos para deliberação;
- revisores ativos e inativos;
- pedidos de subsídio;
- **pedidos de inclusão em atividades** (solicitados pelo checkbox de minicurso na página do evento e ainda não analisados: cada linha leva à edição do participante, onde os botões **"Sim (aprovar)" / "Não (negar)"** registram a decisão);
- solicitações de cadastro.

Use os cards como atalhos para localizar pendências.

### Backup, restauração e reset do banco

A seção "Backup e Restaração" no dashboard concentra as operações de manutenção do banco de dados, acessíveis **exclusivamente** ao `admin@admin.com` (superadministrador):

- **Baixar Backup**: bloqueia temporariamente novas requisições, drena as requisições ativas e o worker de e-mail, captura em staging o banco (`VACUUM INTO`), `uploads/`, `assets/Fundos/` e `assets/Ligem.png`, libera a aplicação e gera o ZIP somente a partir do staging. O pacote inclui `BACKUP_META.json` com versão, data, tamanhos e contagens.
- **Restaurar Backup**: faz upload de um ZIP válido e exige a confirmação `RESTAURAR`. O sistema pausa requisições e workers, verifica tamanho, CRC32, path traversal, `integrity_check`, `foreign_key_check` e schema, prepara cópias de rollback e substitui banco, uploads, fundos e logo. A nova conexão só é publicada depois que todos os componentes terminam; uma falha tenta restaurar cada componente independentemente.
- **Resetar Banco de Dados**: exige `SUPER_ADMIN_INITIAL_PASSWORD`, pausa requisições e workers, apaga as tabelas e uploads e recria banco, schema, índices, triggers e superadministrador com a senha inicial configurada.

Backup e restauração não exigem reinício do servidor: a conexão é trocada em tempo de execução. Durante a manutenção, novas requisições recebem `503` e devem ser repetidas após alguns segundos.

**Perda da senha do superadministrador**: o botão "Resetar Senha" exige sessão de admin, então quem perde a senha do `admin@admin.com` recupera pelo script de manutenção (acesso direto ao servidor de arquivos):

```bash
node scripts/reset-admin-password.js "NovaSenha123"            # redefine admin@admin.com
node scripts/reset-admin-password.js "NovaSenha123" "outro@e.mail"  # ou outro usuário
```

A nova senha deve seguir a política padrão (8+ caracteres, maiúscula, minúscula e número) e passa a exigir troca no primeiro acesso. Defina `DB_FILE` para apontar a outro banco.

### Envio de e-mail individual

No card **Envio global de e-mails** do dashboard, visível apenas ao `admin@admin.com`, há um formulário para enviar uma mensagem a um destinatário único. Os campos são:

- **Destinatário**: endereço de e-mail do destinatário;
- **Assunto**;
- **Mensagem**;
- **Enviar e-mail**.

A mensagem é enfileirada e exibida na lista "Mensagens pendentes" com data de criação e disponibilidade formatadas em `dd/mm/aaaa hh:mm` (horário de Brasília). A lista e o contador de pendentes se atualizam automaticamente na página (a cada 15 segundos, sem recarregar): conforme os e-mails vão sendo enviados, eles saem da listagem sozinhos; quando a fila esvazia, o bloco "Ver mensagens pendentes" desaparece. O envio respeita o master switch global: quando ele está desativado, a mensagem fica na fila como suspensa e só é enviada após a reativação. O sistema tentaria enviar automaticamente, mas a saída para o servidor SMTP depende da rede/local de execução.

Quando a fila apresenta mensagens pendentes, aparece o botão **Limpar fila de e-mails** acima da lista "Ver mensagens pendentes". Ele cancela todas as mensagens da fila de uma vez, removendo-as da exibição e impedindo seu envio. Antes de executar, o sistema pede confirmação; a ação é restrita ao `admin@admin.com` e registrada na trilha de auditoria dos e-mails. Os registros são marcados como cancelados (não excluídos), preservando o histórico.

## 13. Estatísticas e relatórios

Abra `/admin/reports` e selecione o evento. O relatório consolida:

- estatísticas de artigos e pareceres;
- participantes, autores e papéis;
- atividades, inscrições e presenças;
- avaliações dos participantes por atividade (card "Participantes que avaliaram" e listas expansíveis por atividade);
- certificados emitidos;
- pedidos de subsídio;
- listagens para impressão.

É possível selecionar as seções antes de imprimir ou exportar pelo diálogo de impressão do navegador. A deliberação final do artigo também pode ser registrada pela página administrativa correspondente.

As salas também possuem relatórios próprios, acessíveis em `/admin/events/:id/rooms`: **Ocupação por dia** (grade de salas e horários bloqueados em cada dia) e **Agenda por sala** (atividades, etapas e reservas por sala em ordem cronológica). Ambos com botão de impressão/PDF (Seção 9).

## 14. Fluxo recomendado de um evento

1. Criar o evento e publicar as janelas.
2. Cadastrar ou importar usuários.
3. Inscrever participantes e associar atividades.
4. Criar atividades e etapas.
5. Configurar certificados.
6. Realizar o credenciamento e registrar presenças.
7. Acompanhar artigos, pareceres e deliberações.
8. Emitir certificados.
9. Consultar relatórios e encerrar o evento.

## 15. Solução de problemas

- Após alterar rotas, serviços ou `server.js`, reinicie o servidor.
- Se o logo não aparecer, confirme que o arquivo existe em `uploads/event-logos/` e que `logo_path` está preenchido no evento.
- Para câmera de QR Code em produção, use HTTPS; em outros ambientes, digite o código manualmente.
- Se uma ação administrativa retornar acesso negado, confirme se o usuário possui o papel `admin` naquele evento.
- Se uma conta não conseguir acessar o painel, verifique aprovação, conta ativa, troca de senha e conclusão do perfil.
- Se o contador de inscritos de uma atividade mostrar valor maior que a lista, havia matrícula órfã (inscrição excluída sem cascata); a limpeza de integridade do boot a remove automaticamente — reinicie o servidor.
- Se a senha do `admin@admin.com` for perdida, use `node scripts/reset-admin-password.js "NovaSenha123"` (veja a Seção 12).

## 16. E-mails transacionais

O envio possui dois níveis de autorização: o **master switch global**, restrito ao superadministrador, e o switch de cada evento. Ambos começam desligados. O global pode ser alterado no dashboard ou em `/admin/events`; o switch do evento também aparece na listagem e no card **Identidade dos e-mails** da criação/edição.

Além dos envios automáticos, o `admin@admin.com` pode mandar um e-mail para um endereço específico diretamente do card **Envio global de e-mails** no dashboard (`/admin/dashboard`): um campo de destinatário, um de assunto, um de mensagem e um botão **Enviar e-mail**. A mensagem entra na fila (respeitando o master switch) e pode ser acompanhada em **Ver mensagens pendentes**. Detalhes dessa funcionalidade estão na seção **Envio de e-mail individual** (Seção 12).

Ao desligar um switch, mensagens pendentes do respectivo escopo são canceladas e não retornam ao reativar. O sistema nunca bloqueia cadastro, aprovação, emissão ou importação por indisponibilidade do SMTP.

Mensagens geradas enquanto o envio está desativado (global ou do evento) entram na fila como **supensas** e não são enviadas enquanto o envio permanecer desligado. O card **Envio global de e-mails** no dashboard exibe um aviso com a contagem, permite **ver a lista de e-mails suspensos** (destinatário, mensagem, evento, motivo e datas) e **excluir a lista** definitivamente, com confirmação.

O card do evento permite definir nome da plataforma, nome exibido do remetente, assinatura e e-mail de contato (`Reply-To`). Mensagens do evento usam seu logo quando configurado; sem logo, não há imagem padrão.

A importação de usuários em **Usuários** (`/admin/users/import`) envia automaticamente os e-mails de criação de conta: como o admin que importa já aprova os acessos, os novos usuários recebam imediatamente o link individual de uso único para definir senha (válido por 72 horas), sem clique adicional. Senhas nunca são enviadas por e-mail. A autorização só é manual quando o master switch global está desativado — nesse caso, a página de resultado exibe um aviso e os e-mails ficam pendentes até a reativação e a autorização pelo admin. Já a importação de inscrições em eventos (`/admin/events/:id/import-users`) continua exigindo **Autorizar e-mails aos participantes** na página de resultado.

Nas inscrições públicas, o participante recebe uma confirmação imediata ou um aviso de recebimento para análise, conforme a configuração do evento. Depois da análise, recebe o resultado como aprovado, parcialmente aprovado (com as atividades confirmadas) ou recusado. Também recebe aviso quando a administração altera suas atividades.

Configure o Zoho por variáveis de ambiente (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`) e defina `APP_BASE_URL` com a URL pública da instalação.

## 17. Próximas melhorias do manual

- adicionar capturas de tela de cada fluxo;
- documentar o fluxo completo de submissão e revisão de artigos;
- incluir perguntas frequentes para participantes e revisores;
- registrar procedimentos de implantação em produção e configuração HTTPS;
- revisar o manual a cada nova versão do sistema.
