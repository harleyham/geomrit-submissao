# Histórico Técnico do Projeto

Registro cronológico das principais alterações no sistema de gestão de eventos, avaliação de artigos, participação, presença e certificados de participação.

Versão atual registrada: **V0.1**.

## 2026-08-04

### Correção do vínculo Atividade–Pessoa–Presença–Certificado

- Separado o papel atribuído no evento (`event_user_roles`) da atuação efetiva registrada na presença (`activity_attendance_records.role`). Marcar ou remover presença não altera mais os papéis da pessoa no evento.
- A chamada de cada atividade passou a oferecer somente papéis simultaneamente elegíveis para a atividade e já pertencentes à pessoa no evento; o papel `participant` decorre da inscrição.
- Corrigida a remoção de presença ao selecionar “— selecionar —”, que antes era convertida indevidamente em presença como participante.
- Marcações, alterações de papel e remoções de presença por atividade passaram a gerar registros em `participant_audit_logs`.
- Removido o `UPSERT` que tentava atualizar a coluna inexistente `event_user_roles.updated_at`.
- A elegibilidade de participante, palestrante, professor e apresentadores passou a exigir o mínimo configurado de presenças no papel correspondente. Revisores continuam elegíveis por parecer enviado.
- A carga horária de cada certificado agora considera somente atividades habilitadas nas quais a pessoa esteve presente naquele mesmo papel.
- A administração pode ativar ou desativar uma atividade no cálculo de certificados e carga horária diretamente na listagem de atividades.
- A mesma pessoa pode receber certificados distintos por seus diferentes papéis no evento, com resumo e carga horária próprios das atividades de cada papel.
- Adicionada a coluna `activities_summary` às emissões para preservar e exibir no PDF e na área do participante as atividades consideradas na emissão.
- A antiga regra por atividade foi retirada do fluxo, pois comparava o total consolidado com apenas a primeira regra encontrada. Mínimo de presenças, fundo, cor e texto permanecem centralizados por papel de certificado.

### Correção do botão "Visualizar original" na página de certificados do admin

- Corrigida a função `resetToOriginal` em `views/admin/events/certificates.ejs`: ao clicar "Visualizar original", a prévia agora é renderizada diretamente com as configurações salvas (fundo, cor, título e texto) no banco, sem modificar os campos do formulário com valores antigos.
- Adicionado helper `showPreview(params)` para centralizar a exibição da prévia em `buildPreview` e `resetToOriginal`, eliminando duplicação de código e garantindo comportamento consistente.
- Adicionada a rota `GET /admin/events/:id/certificates/rule/current` em `routes/events.js` que retorna as configurações salvas de todas as regras de certificado por papel.
- Corrigido o endpoint de prévia (`certificates/preview`) para aceitar parâmetros `title` e `body_text` via query string, permitindo renderizar a prévia com os valores atuais do formulário.

### Exportação em lote dos certificados emitidos em ZIP

- Adicionada a rota `GET /admin/events/:id/certificates/export-all` em `routes/events.js` que gera um arquivo ZIP com todos os certificados emitidos (`status = 'issued'`) do evento.
- Cada certificado é renderizado em PDF via PDFKit e adicionado ao ZIP com nome formatado `certificado-VV-nome-participante-tipopapel-vN.pdf`. O arquivo ZIP usa o nome `{nome_evento}-certificados.zip`.
- Função `generateCertificateBuffer` reutiliza a lógica de `renderCertificatePdf` para gerar buffers de PDF em memória, usando `getBackgroundPath` para resolução de caminhos de fundos.
- Corrigido erro `Class constructor PDFDocument cannot be invoked without 'new'`: `require('pdfkit')` retorna a classe `PDFDocument`, que exige `new` para instânciação.
- Botão "Exportar todos os certificados emitidos" adicionado em `views/admin/events/certificates.ejs` com cor laranja (`#ea580c`), linkando para a rota de exportação.
- `services/certificates.js` passou a exportar `getBackgroundPath` para ser reutilizada pelo gerador de buffer.

### Botão "Baixar" nos certificados emitidos

- Alterado o link "Baixar" de `<a>` para `<button class="secondary">` em `views/admin/events/certificates.ejs`, eliminando o sublinhado e padronizando visualmente com os botões "Emitir" e "Reemitir".

### Inscrição explícita de participantes nas atividades

- Criada a tabela `participant_activity_enrollments` para separar inscrição na atividade de presença efetiva.
- O formulário de inclusão administrativa de participante passou a exigir ao menos uma atividade quando o evento possui programação cadastrada.
- O mesmo formulário, em modo de edição, permite adicionar ou remover atividades da inscrição posteriormente.
- A listagem de participantes passou a mostrar quantidade e nomes das atividades vinculadas, com acesso direto à edição.
- A listagem de atividades passou a mostrar separadamente inscritos e presentes e contém orientação para a página onde os vínculos são administrados.
- As atividades cadastradas podem ser reabertas para edição de nome, tipo, data, carga horária, papéis elegíveis e participação no cálculo de certificados.
- A chamada passou a listar participantes inscritos naquela atividade, preservando também pessoas elegíveis por papéis como revisor, palestrante, professor ou apresentador.
- Na primeira migração, inscrições existentes são vinculadas às atividades atuais elegíveis para participante para preservar o histórico; novas inscrições exigem seleção explícita das atividades.
- A inscrição pública passou a criar o vínculo participante–atividade e a área do participante ganhou `/evento/:id/atividades` para edição posterior. Atividades com presença registrada são preservadas.
- A elegibilidade do certificado de participante exige simultaneamente inscrição e presença em cada atividade certificável.
- A chamada por atividade passou a exibir botões explícitos para marcar, atualizar e remover presença; o papel selecionado permanece independente da ação, evitando que a coluna de presença mostre apenas “—” sem controle operacional.
- `README.md` e `submissao.md` foram consolidados com o fluxo operacional Evento → Atividades → Inscrição → Presença → Certificados e com as rotas utilizadas por participante e administrador.

### Endurecimento de segurança, CSRF, rate limiting e validação server-side

- Instalado `express-validator` e criados módulos em `security/`: `csrf.js`, `rate-limits.js` e `validation.js`.
- Proteção CSRF implementada com token gerado por sessão, validação `timingSafeEqual` e rejeição 403 para requisições POST/PUT/DELETE sem token ou com token inválido. Campo `_csrf` injetado automaticamente em todos os formulários via partial `views/partials/csrf-inject.ejs`.
- Rate limiting configurado: 10 tentativas/15 min no login, 5/hora no cadastro público e inscrições, 30/min em ações administrativas sensíveis, 200/15 min como teto global.
- express-validator aplicado nas rotas de login, troca de senha, cadastro público, revisão e decisão final, com mensagens de erro localizadas.
- `server.js` atualizado: secret de sessão via `SESSION_SECRET` ou `crypto.randomBytes(32)`, cookie `secure` ativado em produção, CSP com `objectSrc: none`, `baseUri` e `formAction` restritos, `referrerPolicy` configurado, payload limit de 1 MB.
- Todos os endpoints POST administrativos recebem `strictLimiter` para prevenir abuso de operações sensíveis.
- `package.json` atualizado com a nova dependência `express-validator`.

## 2026-08-03

### Papéis por evento, certificados por papel e presença unificada

- O gerenciamento de usuários foi consolidado no modelo de conta única: papéis são atribuídos por evento em `event_user_roles`, incluindo Administrador, Participante, Revisor, Palestrante, Professor, Apresentador Oral e Apresentador Pôster.
- Administração migrada para o escopo do evento: cada administrador vê e administra apenas os eventos atribuídos; administradores legados foram associados aos eventos existentes; o criador de um novo evento passa a ser administrador dele automaticamente.
- Página de papéis do evento ampliada para atribuir e remover administradores do evento.
- Certificados evoluídos para emissão por papel, permitindo vários certificados independentes para a mesma pessoa em um evento; configuração individual de fundo, cor, título e texto; emissão em lote de certificados elegíveis pendentes.
- Seleção de fundos de certificado passou a usar miniaturas. A prévia dinâmica usa as escolhas atuais de fundo e cor do formulário antes de salvar a configuração.
- Presença simples passou a ser registrada por pessoa e evento, incluindo todas as pessoas vinculadas (participantes, revisores, palestrantes, professores e apresentadores) sem duplicidade por acúmulo de papéis.
- Edição administrativa de participante ficou restrita aos dados da inscrição; a atribuição de papéis e a vinculação de artigos aprovados para apresentações são feitas na edição do usuário, após escolher o evento.

### Carga horária no certificado e preparação de testes

- O PDF e a área autenticada de certificados passaram a apresentar a carga horária consolidada em `hora-aula` ou `horas-aula` apenas quando o total das atividades do certificado for maior que zero.
- Os registros de `certificate_emissions` foram limpos no ambiente de testes, preservando eventos, regras, fundos, atividades, inscrições e presenças para permitir novas emissões.
- A emissão passou a consolidar a carga horária pelas presenças da pessoa em atividades habilitadas para certificado, independentemente do papel do certificado.
- O painel `/admin/events/:id/attendance` foi reorganizado como entrada para as chamadas por atividade; a presença geral deixou de ser apresentada como ação de certificação.

### Consolidação de perfis e atividades por evento

- Atribuição de perfis foi centralizada na edição do usuário com evento selecionado; a edição de participante voltou a tratar exclusivamente da inscrição e aponta para o fluxo de perfis por evento.
- Cadastro de atividades reformulado para representar partes do evento, com seleção de perfis elegíveis e do perfil de certificado que cada atividade habilita.
- Controle de presença por atividade ajustado para marcar pessoas elegíveis, independentemente de possuírem apenas inscrição ou outro papel no evento.

### Vinculação de papéis por atividade no controle de presença

- Adição da coluna `role` (TEXT DEFAULT 'participant') em `activity_attendance_records` para registrar o papel específico que cada pessoa exerce em cada atividade.
- Rota `POST /admin/events/:id/activities/:activityId/attendance/:userId` atualizada para aceitar `role` do formulário; ao selecionar um papel, o registro de presença é atualizado e o papel é propagado automaticamente para `event_user_roles` via `INSERT OR REPLACE`.
- Selecionar papel vazio ("— selecionar —") remove o registro de presença e o papel vinculado àquela atividade.
- Rota `GET /admin/events/:id/activities/:activityId/attendance` ajustada para retornar `activity_role` de cada pessoa, com query corrigida para eliminar erro "ambiguous column name: user_id" causado pela junção de `event_registrations`, `event_user_roles` e `activity_attendance_records` (alias `person_user_id`).
- View `views/admin/events/activity-attendance.ejs` reescrita com layout topbar/Inter, stats cards (presentes/ausentes/total), tabela com colunas de pessoa, perfis no evento (badges), role na atividade (dropdown com seleção automática via `onchange`) e status de presença.
- Papéis aceitos no dropdown: participante, professor, palestrante, apresentador oral e apresentador pôster.

---

### Certificados por papel no evento

- Separadas permissões globais (`Administrador` e `Revisor`) dos papéis certificados por evento: Participante, Revisor, Palestrante, Professor, Apresentador Oral e Apresentador Pôster.
- Criadas as tabelas `event_user_roles` e `event_certificate_rules` para atribuição de papéis e configuração individual de fundo, cor, título e texto de cada certificado.
- Emissões migradas para identificar pessoa e papel, permitindo múltiplos certificados e reemissões independentes para a mesma pessoa no mesmo evento.
- Administração ganhou a página de papéis do evento e a emissão agrupada por tipo de certificado; PDFs e área autenticada identificam o papel certificado.

---

### Participante: exibição do status do subsídio e topbar unificada em certificados

#### Implementações

- **Status do subsídio no painel do participante:** adição da coluna condicional "Subsídio" na tabela "Minhas Participações" da página `/author`. O badge exibe `Pendente` (amarelo), `Aprovado` (verde) ou `Rejeitado` (vermelho) conforme o valor de `subsidy_status` em `event_registrations`. A coluna só aparece quando pelo menos um dos registros de participação do usuário possui `subsidy_requested = 1`.
- **Topbar unificada em certificados de participante:** a página `/evento/:id/certificates` passou a exibir, quando autenticado, o e-mail da conta em badge e o botão "Sair" em vermelho, seguindo o padrão já adotado por `event.ejs`, `submit.ejs` e demais páginas públicas autenticadas.

#### Correções

- **Erro de renderização EJS em `/admin/users/:id/participant`:** o prop `showSubsidyStatus` não estava sendo passado ao template quando o admin acessa a área de participante de um usuário via botão "Área do Participante". A rota em `routes/users.js` agora calcula e repassa a flag, eliminando o erro de template.

#### Arquivos alterados

- `routes/public.js` — variável `showSubsidyStatus` calculada a partir de `participations` e passada ao template em `/author`.
- `routes/users.js` — prop `showSubsidyStatus` adicionada ao `res.render` na rota `/:id/participant`.
- `views/public/author-dashboard.ejs` — coluna condicional "Subsídio" na tabela "Minhas Participações" com badge colorido por status.
- `views/public/event-certificates.ejs` — topbar ampliada com `session-pill` (e-mail) e botão "Sair" vermelho, condicionais a `userEmail`, `isAdmin` e `isReviewer`.

#### Documentação

- `submissao.md` atualizado: novos itens em "Implementado" referenciando status do subsídio e topbar unificada em certificados.
- `submissao_log.md` atualizado com registro destas mudanças.

---

### Certificados: prévia inline, cor da fonte e seleção de fundos em miniatura

#### Implementações

- **Cor da fonte configurável:** adição da coluna `text_color` (TEXT DEFAULT `#0f172a`) nas tabelas `certificate_rules` e `certificate_emissions` via migration. Seletor de cor (`input type="color"`) no formulário de regra de elegibilidade. Toda a fonte do certificado em PDF agora utiliza a cor selecionada (título, corpo, nome do participante, datas e código de verificação).
- **Prévia inline do certificado:** nova rota `GET /admin/events/:id/certificates/preview` que gera um PDF de prévia com fundo e cor da fonte selecionados via parâmetros `?background_id=X&text_color=Y`. A prévia reflete as configurações atuais do formulário antes de salvar, não os valores persistidos no banco. Exibida em iframe inline na própria página com botão alternável "Visualizar prévia do certificado" / "Ocultar prévia".
- **Seleção de fundos em miniatura:** remoção do combobox de fundos e substituição por grade de miniaturas clicáveis organizadas em dois grupos (Fundos padrão de `assets/Fundos/` e Fundos enviados de `uploads/certificate-backgrounds/`). Clique na miniatura atualiza o campo oculto `background_id` e a prévia em tempo real.
- **Rota para servir fundos enviados:** `GET /admin/events/:id/certificates/backgrounds/:backgroundId/view` serve a imagem do fundo com o MIME type correto, lendo o caminho relativo da tabela `certificate_backgrounds` e resolvendo o caminho absoluto.
- **Reorganização do layout:** campos de regra (presenças mínimas + cor da fonte) em linha no topo do card; grade de fundos abaixo; botão "Salvar regra" posicionado após a seleção de fundos.

#### Correções

- Corrigido erro de caminho de arquivos para fundos enviados: o `file_path` armazenado em `certificate_backgrounds` agora é salvo com prefixo `uploads/certificate-backgrounds/` (antes `certificate-backgrounds/`), garantindo que os arquivos sejam encontrados corretamente.
- Corrigido erro "18 values for 17 columns" na emissão de certificados: `INSERT INTO certificate_emissions` estava com número incorreto de placeholders no `VALUES`.
- Corrigido erro "16 values for 17 columns" na emissão de certificados: `INSERT INTO certificate_emissions` com `datetime('now','-3 hours')` literal no `VALUES` contava como valor adicional. Data/hora agora é calculada em JavaScript com o mesmo fuso horário UTC-3 usado em todo o código.
- Corrigido erro "6 values for 7 columns" na atualização de regra de certificado: `INSERT INTO certificate_rules` tinha número incorreto de placeholders para a coluna `updated_by`.

#### Documentação

- `submissao.md` atualizado: descrição de certificados de participação ampliada com cor da fonte configurável, prévia inline e seleção de fundos em miniatura.
- `submissao_log.md` atualizado com registro destas mudanças.

---

### Épico 3: presença por atividade, dia ou minicurso — implementado

#### Implementações

- **Consolidação de carga horária por participante:** helper `getWorkloadSummaryByEvent` no `db.js` calcula total de atividades frequentadas e carga horária consolidada por participante com base em `activity_attendance_records` e `event_activities` (somente atividades com `certificate_enabled = 1`).
- **Conexão de regras de atividade à elegibilidade de certificados:** `getCertificateParticipants` reescrita para consultar presenças por atividade e calcular elegibilidade com base em `activity_certificate_rules` (quando disponíveis) ou `attendance_records` (fallback por presença simples).
- **Emissão de certificado com informações de atividades:** `issueCertificate` atualizada para popular colunas `activity_id`, `activities_attended` e `total_workload_hours` no registro de `certificate_emissions`.
- **PDF do certificado atualizado:** `services/certificates.js` exibe a carga horária consolidada em horas-aula apenas quando houver total maior que zero.
- **Nova rota de regra de certificado por atividade:** `POST /admin/events/:id/activities/:activityId/certificate-rule` permite salvar mínimo de presenças e fundo específico por atividade.
- **Colunas adicionais em `certificate_emissions`:** migration adiciona `activities_attended` (INTEGER DEFAULT 0) e `total_workload_hours` (REAL DEFAULT 0).

#### Views

- `views/admin/events/activities.ejs` reescrito com topbar, grid de cards, badges por tipo de atividade (Palestra/Seminário/Mesa redonda/Minicurso/Outra), contagem de presenças por atividade e link para gerenciar presença.
- `views/admin/events/activity-attendance.ejs` reescrito com topbar, stats cards (presentes/ausentes/total), formulário de regra de certificado (mínimo de presenças + seletor de fundo com grupos "Fundos padrão" e "Fundos enviados"), lista de participantes com botão presente/ausente.
- `views/admin/events/certificates.ejs` reescrito com topbar, colunas de atividades frequentadas e carga horária por participante, tags das atividades, badges de elegibilidade.

#### Correções

- Corrigido erro "18 values for 16 columns" na emissão de certificados: `INSERT INTO certificate_emissions` estava com número incorreto de placeholders no `VALUES`.

#### Documentação

- `submissao.md` atualizado: Épico 3 marcado como implementado; riscos e gaps relacionados a carga horária e regras por atividade removidos; ordem recomendada ajustada; backlog técnico atualizado.
- `submissao_log.md` atualizado com registro desta entrega.

---

## 2026-07-31

### Implementações

- Gestão administrativa de participantes por evento concluída com criação ou seleção de conta, inscrição, edição, remoção condicionada e auditoria.
- Tabela `participant_audit_logs` adicionada para registrar alterações manuais na participação e a reconciliação provocada pela exclusão de artigos.
- Índices únicos adicionados para impedir duplicidade de inscrição por evento/e-mail normalizado e por evento/conta vinculada.
- Exclusão administrativa de artigo ajustada: ao remover o último artigo submetido, a inscrição do autor é preservada e reclassificada para `listener`; se houver outro artigo, permanece como `author`.
- Presença simples por evento implementada com a tabela `attendance_records`, lançamento manual, remoção, observação opcional e identificação do administrador responsável.
- Painel administrativo de presença adicionado à gestão do evento, com filtros e totais de inscritos, presentes e participantes sem presença.
- Formulário administrativo de inclusão de participante ampliado com seletor de contas já cadastradas, preenchimento automático e vínculo explícito ao evento.
- Inclusão administrativa passou a exigir conta vinculada: o admin cria uma conta com senha temporária ou inscreve conta ativa já existente, preservando o acesso do participante a autosserviço e certificados.
- Download administrativo em lote dos artigos de um evento implementado em arquivo ZIP, incluindo apenas submissões com PDF disponível.
- Relatório do evento ampliado com checkbox por seção e controles para selecionar ou limpar todas as seções antes da impressão em PDF.
- Layout da listagem administrativa de eventos ajustado para quebrar os botões de ação e permitir rolagem horizontal da tabela em telas estreitas.

### Correções

- Correção do download ZIP em lote para usar a API `ZipArchive` compatível com a versão instalada da dependência `archiver`.

### Certificados

- Módulo de certificados implementado com regra de elegibilidade por presença, emissão versionada, reemissão auditável e download autenticado em PDF.
- Biblioteca de fundos de certificado adicionada com seleção de imagens existentes e upload administrativo de PNG/JPEG.

### Atividades e presença detalhada

- Cadastro administrativo de atividades internas por evento adicionado, com tipos como palestra, seminário, mesa-redonda, minicurso e outras atividades.
- Atividades passaram a armazenar data, carga horária e indicação de emissão de certificado.
- Presença por atividade implementada em `activity_attendance_records`, permitindo registrar a participação da mesma pessoa em várias atividades do evento.
- Base `activity_certificate_rules` adicionada para suportar regras e fundos específicos por atividade; a conexão da emissão de certificados a essa seleção permanece como próxima etapa.

### Enxugamento técnico

- Removidos os endpoints individuais legados de atualização de perfis de usuários; a atualização em lote permanece como fluxo único.
- Removidos os redirecionamentos legados de login do revisor e o fallback duplicado de atualização de eventos.
- A revisão passou a usar exclusivamente `assignments` e `reports`; colunas antigas e sem consumidores foram removidas de `articles` por migração compatível.
- Dependência direta não utilizada `body-parser` e o arquivo vazio `database.sqlite` removidos.

## 2026-07-30

### Documentação

- `submissao.md` atualizado para refletir o fluxo atual de deliberação final administrativa, a leitura dos pareceres na página do artigo, os novos agrupamentos do dashboard e a persistência de timestamps em horário local do Brasil.
- `submissao_log.md` atualizado com o histórico das mudanças implementadas em 30 de julho de 2026.
- Documentação reposicionada para tratar o produto como sistema de gestão de eventos, artigos, presença e certificados de participação, e não apenas como fluxo de submissão.
- Documentação ampliada com diagnóstico por objetivo e planejamento por fases para cobrir integralmente gestão de eventos, avaliação de artigos, presença e certificados de participação.
- Planejamento documental detalhado em épicos, entregas incrementais e tarefas técnicas agrupadas por arquivo.

### Implementações

- Página administrativa do artigo ampliada com seção de deliberação final, permitindo aprovar, reprovar e alterar a modalidade `oral`/`poster` sem sair do detalhe do artigo.
- Card `Revisores Atribuídos` ampliado com leitura expansível dos pareceres já enviados.
- Dashboard administrativo reorganizado em grupos temáticos (`Eventos`, `Revisores`, `Usuários`, `Artigos`).
- Dashboard administrativo ampliado com métricas e listas para artigos sem revisor, em análise e prontos para deliberação final.
- Fluxo de exclusão de artigos na listagem administrativa ajustado para usar modal customizado em vez da caixa nativa do navegador.
- Consulta pública por código ampliada com andamento agregado da avaliação, usando contagem de pareceres e recomendações.

### Correções

- Correção do fluxo de parecer do revisor para registrar recomendação individual sem deliberação final automática do artigo.
- Correção do painel do revisor para diferenciar `Meu Parecer` de `Aguardando deliberação final administrativa`.
- Correção do link `Corpo de Revisores` no painel do revisor, ajustando a navegação para `/revisores`.
- Correção da página pública do evento para permitir que contas administrativas autenticadas também sigam o fluxo de participante em inscrições, submissões e certificados de participação, quando aplicável.
- Correção da listagem administrativa de artigos para usar rótulos de status em português no combobox de ação.
- Correção da persistência de timestamps nas rotas ativas para gravar em horário local do Brasil (`UTC-3`) em vez de UTC puro.

### Observações Técnicas

- O fluxo oficial de múltiplos revisores agora trata `assignments` e `reports` como fonte de verdade para recomendações individuais, enquanto a deliberação final administrativa permanece como etapa própria.
- O status `accepted` em atribuições antigas pode continuar aparecendo em registros históricos já persistidos antes da atualização do fluxo.
- A exclusão física de artigos pela administração ainda pode exigir ajustes adicionais para sincronizar a participação em `event_registrations`.

## 2026-07-29

### Documentação

- `submissao.md` atualizado para refletir o cronograma público por evento, as novas janelas (`registration`, `review`, `certificates`) e as regras reais de bloqueio por período.
- `submissao_log.md` atualizado com o histórico das mudanças implementadas em 29 de julho de 2026.

### Implementações

- Página pública do evento reorganizada em formato de cronograma com coluna de ação por etapa.
- Cadastro e edição de eventos ampliados para suportar datas de inscrições, análise de submissão e certificados de participação.
- Painel `/author` ajustado para mostrar apenas eventos futuros em cards clicáveis, levando diretamente à página pública do evento.
- Fluxo público de submissão ajustado para exigir inscrição prévia no evento antes do envio do artigo.
- Eventos passaram a suportar a flag `has_article_submission`, com exibição condicional das etapas de submissão e análise nas telas públicas.
- Cadastro administrativo de usuários ampliado com `reviewer_areas`, permitindo sugerir revisores compatíveis com a trilha do artigo.
- Tela administrativa do artigo ampliada com lista de revisores atribuídos, sugestão por trilha e ações de atribuição e remoção.
- Dashboard administrativo ampliado com cards para artigos sem designação, solicitações de subsídio e solicitações de cadastro pendentes.
- Painel do revisor ampliado com atalhos para área do participante, dashboard admin, eventos, consulta de artigo e corpo de revisores.
- Área do participante ampliada com navegação para múltiplos perfis, bloco exclusivo de rascunhos e retomada de preenchimento.
- Fluxo de exclusão de rascunhos implementado diretamente na área do participante, com atualização imediata dos contadores.
- Modal customizado implementado para confirmar a exclusão de rascunhos sem usar a caixa nativa do navegador.

### Correções

- Correção do comportamento dos botões da página pública do evento para trocar a ação conforme autenticação e inscrição do participante.
- Correção da etapa `Submissão Artigos`, que agora só habilita envio para usuário autenticado e inscrito.
- Correção do backend para bloquear inscrições fora da janela de `registration_start` e `registration_end`.
- Correção do backend para bloquear submissões finais fora da janela de `submission_start` e `submission_end`.
- Correção da lógica pública para ocultar botões de ação quando a etapa do cronograma não possui período configurado.
- Correção da ação de certificados de participação para só aparecer quando houver inscrição válida, autenticação e janela de certificados de participação aberta.
- Correção da consistência de navegação para exibir o botão `Sair` em vermelho nas páginas públicas acessadas por usuários autenticados.
- Correção do fluxo de login para evitar erro de renderização ao abrir a área do participante.
- Correção da inscrição pública para reutilizar corretamente a instituição do usuário autenticado.
- Correção do texto de sucesso e de inscrição já existente no fluxo de inscrição de participantes.
- Correção do salvamento de rascunhos para não exigir validação completa antes da submissão final.
- Correção da listagem de rascunhos na área do participante, incluindo contagem, retomada e atualização dos indicadores após exclusão.
- Correção da rota de atribuição de revisores, ajustando literais SQL para o SQLite.
- Correção da recomendação de revisores para usar a trilha do próprio artigo, e não a área geral do evento.
- Correção da navegação entre perfis para permitir que contas com múltiplos papéis acessem `/author`, `/reviewer` e `/admin/dashboard` a partir das interfaces correspondentes.

### Observações Técnicas

- O controle de período deixou de ser apenas visual. As rotas públicas de inscrição e submissão passaram a validar a janela diretamente no backend.
- A janela de certificados de participação já está modelada e controlada na interface pública, mas ainda não existe fluxo dedicado para emissão ou download.
- Rotas legadas sem uso, como `routes/assignments.js`, `routes/config.js` e `routes/reviewers.js`, podem ser removidas da base ativa juntamente com seus templates associados.
- A área administrativa do evento não possui mais a página `stats`; a visão consolidada permanece em `Relatórios`.

## 2026-07-28

### Documentação

- `submissao.md` consolidado como especificação técnica do estado atual do produto.
- `submissao_log.md` mantido como histórico técnico incremental do projeto.
- Documentação atualizada para refletir inscrições, áreas múltiplas por evento, subsídio e métricas de participação.

### Implementações

- Página administrativa por evento implementada para listagem e análise dos pedidos de subsídio.
- Leitura administrativa dos documentos de subsídio implementada com acesso aos PDFs anexados no cadastro do participante.
- Fluxo administrativo de aprovação e reprovação de pedidos de subsídio implementado com persistência de status, observações e autor da análise.
- Fluxo de revisão ajustado para usar `assignments` e `reports` como fonte de verdade no painel do revisor.
- Regra real de período de submissão aplicada com base em `submission_start` e `submission_end`.
- Exibição do e-mail do usuário autenticado adicionada nas áreas principais do painel administrativo e do painel do revisor.
- Controle de visibilidade de senha adicionado aos principais formulários com campo de senha.
- Página `/admin/users` alterada para trabalhar com salvamento único em lote de perfis e status.
- Interface de gestão de usuários refinada para separar claramente `Revisor` de `Conta ativa`.
- Badge visual adicionado para identificar revisor inativo na tela de usuários.
- Área do evento alterada para suportar múltiplas áreas/trilhas por evento e reutilização dessas áreas na submissão de artigo.
- Campo de subsídio a participantes adicionado ao cadastro de eventos.
- Fluxo público de inscrição de participantes por evento implementado com persistência em `event_registrations`.
- Sincronização automática de inscrição quando participante submete artigo no evento, promovendo `listener` para `author` quando aplicável.
- Dashboard administrativo ampliado com métricas de inscritos totais, autores e participantes.
- Lista de eventos e estatísticas por evento ampliadas com contadores de participantes.
- Relatório do evento ampliado com estatísticas de participantes, inscritos com artigo e listagem de participantes.
- Relatório do evento passou a listar nome, e-mail, órgão e situação da participação.
- Página do participante consolidada para usuários autenticados sem perfil administrativo, incluindo revisores que também submetem artigos, com listagem de eventos publicados, participações, rascunhos e submissões.
- Página `/author/profile` criada para edição dos dados cadastrais do participante.
- Navegação do fluxo `/author` mantida também para contas administrativas com múltiplos perfis, preservando o autoacompanhamento de participações e submissões no mesmo cadastro.
- Botão de impressão do relatório implementado com layout otimizado para exportação em PDF via navegador.
- Lista padronizada de países adicionada aos formulários com campo de país.
- Fluxo de cancelamento de inscrição de participante sem artigo implementado na área do participante até o dia anterior ao início do evento.
- Fluxo de subsídio na inscrição do evento implementado com dados acadêmicos, ID Lattes e upload de histórico escolar, carta de motivação e carta de recomendação.

### Correções

- Correção do cadastro e da edição de revisores para preservar perfis múltiplos no mesmo usuário, sem remover papel administrativo existente.
- Correção da atribuição administrativa para permitir múltiplos revisores no mesmo artigo quando necessário.
- Correção das estatísticas e do relatório do evento para não contar rascunhos como submissões efetivas.
- Correção da separação entre artigos pendentes e artigos revisados no dashboard do revisor.
- Correção da lógica pública de abertura e fechamento da janela de submissão.
- Correção da interface pública para não exibir status de submissão quando o evento não possui janela de submissão configurada.
- Correção do parsing de flags de usuários para persistir corretamente valores ativados e desativados.
- Correção da contagem de `Revisores Ativos` no dashboard administrativo.
- Correção da contagem de `Revisores Inativos` no dashboard administrativo.
- Correção do ícone de mostrar ou ocultar senha para alternar visualmente com o estado do campo.
- Correção do erro público em `/evento/:id` causado por uso incorreto de aspas nas queries SQLite.
- Correção do erro em `/submeter/:eventId` causado por comparação SQL inválida com string vazia.
- Correção do fluxo de exclusão de evento em `Editar Evento`, removendo formulário aninhado.
- Correção da origem das opções de `Eixo Temático / Trilha`, agora limitadas às áreas do próprio evento.
- Correção da lógica pública de status de submissão para diferenciar `submissão fechada` de `evento sem submissão configurada`.
- Correção da página do participante para listar todos os eventos publicados, e não apenas eventos com submissão aberta.
- Correção da exibição do período do evento na home pública para mostrar início e fim quando disponíveis.
- Correção do botão de impressão do relatório, substituindo `onclick` inline por listener explícito.
- Correção do erro ao salvar edição de evento, com migração das colunas `institution` e `language` na tabela `events`.
- Validação adicionada para impedir `date_end < date_start` e `submission_end < submission_start` no cadastro e na edição de eventos.
- Validação de CPF aplicada também no perfil do participante em `/author/profile`.

### Observações Técnicas

- A rota `POST /admin/users/bulk-update-flags` passou a ser o fluxo principal de persistência de perfis na listagem de usuários.
- Endpoints legados de toggle individual continuam presentes no backend, mas a interface principal não depende mais deles.
- O sistema continua exigindo reinício do servidor para refletir alterações em rotas e templates.
- A métrica de inscritos por evento agora diferencia participantes sem artigo de participantes com submissão.
- A tabela `event_registrations` passou a ser a fonte de verdade para participação explícita em evento.
- A tabela `event_registrations` passou a armazenar também os dados da candidatura a subsídio, quando aplicável.

### Pendências Conhecidas

- Auditoria de deliberação final com histórico persistente.
- Verificação pública de certificados ainda não implementada.

### Minhas observações

- Segurança reforçada: CSRF, rate limiting, express-validator e hardened security em produção.
- Testando o fluxo completo de atividades, presença e emissão de certificados.
