# Histórico Técnico do Projeto

Registro cronológico das alterações relevantes do sistema de submissão de artigos.

Versão atual registrada: **V0.1**.

## 2026-07-29

### Documentação

- `submissao.md` atualizado para refletir o cronograma público por evento, as novas janelas administrativas (`registration`, `review`, `certificates`) e as regras reais de bloqueio por período.
- `submissao_log.md` atualizado com o histórico das mudanças implementadas em 29 de julho de 2026.

### Implementações

- Página pública do evento reorganizada em formato de cronograma com coluna de ação por etapa.
- Cadastro e edição de eventos ampliados para suportar datas de inscrições, análise de submissão e certificados.
- Painel `/author` ajustado para mostrar apenas eventos futuros em cards clicáveis, levando diretamente à página pública do evento.
- Fluxo público de submissão ajustado para exigir inscrição prévia no evento antes do envio do artigo.

### Correções

- Correção do comportamento dos botões da página pública do evento para trocar a ação conforme autenticação e inscrição do participante.
- Correção da regra da etapa `Submissão Artigos`, que agora só habilita envio para usuário autenticado e inscrito.
- Correção do backend para bloquear inscrições fora da janela de `registration_start` e `registration_end`.
- Correção do backend para bloquear submissões finais fora da janela de `submission_start` e `submission_end`.
- Correção da lógica pública para esconder botões de ação quando a etapa do cronograma não possui período configurado.
- Correção da ação de certificados para só aparecer quando houver inscrição válida, autenticação e janela de certificados aberta.

### Observações Técnicas

- O controle de período deixou de ser apenas visual: as rotas públicas de inscrição e submissão passaram a validar a janela diretamente no backend.
- A janela de certificados já está modelada e controlada na interface pública, mas ainda não existe fluxo dedicado para emissão ou download.

## 2026-07-28

### Documentação

- `submissao.md` consolidado como especificação técnica do estado atual do produto.
- `submissao_log.md` mantido como histórico técnico incremental do projeto.
- Documentação atualizada para refletir inscrição de participantes, áreas múltiplas por evento, subsídio e métricas de participação.

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
- Fluxo público de inscrição de ouvintes por evento implementado com persistência em `event_registrations`.
- Sincronização automática de inscrição quando participante submete artigo no evento, promovendo `listener` para `author` quando aplicável.
- Dashboard administrativo ampliado com métricas de inscritos totais, autores e ouvintes.
- Lista de eventos e estatísticas por evento ampliadas com contadores de participantes.
- Relatório do evento ampliado com estatísticas de ouvintes, inscritos com artigo e listagem de participantes.
- Relatório do evento passou a listar nome, e-mail, órgão e situação da participação.
- Página do participante consolidada para usuários autenticados sem perfil administrativo, incluindo revisores que também submetem artigos, com listagem de eventos publicados, participações, rascunhos e submissões.
- Página `/author/profile` criada para edição dos dados cadastrais do participante.
- Bloqueio explícito de contas administrativas no fluxo `/author` e `/submeter/:eventId`.
- Botão de impressão do relatório implementado com layout otimizado para exportação em PDF via navegador.
- Lista padronizada de países adicionada aos formulários com campo de país.
- Fluxo de cancelamento de inscrição de ouvinte implementado na área do participante até o dia anterior ao início do evento.
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
- A métrica de inscritos por evento agora diferencia ouvintes de participantes com submissão.
- A tabela `event_registrations` passou a ser a fonte de verdade para participação explícita em evento.
- A tabela `event_registrations` passou a armazenar também os dados da candidatura a subsídio quando aplicável.

### Pendências Conhecidas

- Ainda falta implementar um fluxo administrativo dedicado para gestão manual de participantes inscritos em eventos.
- Ainda pode ser útil expor na interface pública o status detalhado da inscrição no evento para o participante.
- Há rotas e estruturas legadas no projeto que ainda precisam ser enxugadas.
