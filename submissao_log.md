# Histórico Técnico do Projeto

Registro cronológico das principais alterações no sistema de gestão de eventos, avaliação de artigos, participação, presença e certificados de participação.

Versão atual registrada: **V0.1**.

## 2026-08-03

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
- **PDF do certificado atualizado:** `services/certificates.js` agora exibe linha com "X atividades · Carga horária total: Yh" quando o participante frequentou atividades.
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

- Ainda falta implementar um fluxo administrativo dedicado para gestão manual de participantes inscritos em eventos.
- Ainda pode ser útil expor na interface pública o status detalhado da inscrição no evento para o participante.
- Há rotas e estruturas legadas no projeto que ainda precisam ser enxugadas.
