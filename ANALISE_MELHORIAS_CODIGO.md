# Análise de melhorias do código

Data da revisão: 01/09/2026
Escopo: aplicação Node.js/Express, rotas administrativas e públicas, templates EJS, SQLite, migrações, backup/restore, autenticação, autorização e operação em produção.

## Resumo executivo

A aplicação possui controles importantes já implementados, como CSRF global, CSP com nonce, consultas SQL parametrizadas, escopo por evento, verificação de integridade de backup e transações em parte dos fluxos críticos. A revisão, porém, encontrou riscos que devem ser tratados antes de ampliar o uso em produção.

Prioridades principais:

1. Eliminar a credencial previsível do superadministrador.
2. Corrigir o contrato de validação, que atualmente permite que handlers HTML processem dados inválidos.
3. Separar claramente as permissões de `admin` e `staff`.
4. Corrigir operações administrativas que falham por CSRF ou método HTTP incorreto.
5. Tornar migrações, restore e gravações compostas atômicos e observáveis.
6. Criar testes automatizados para os fluxos de autorização, inscrição, presença, revisão e certificados.

Não foram encontrados sinais de SQL injection nas consultas revisadas. A sintaxe dos arquivos JavaScript e a compilação dos templates EJS estavam válidas na revisão anterior. O projeto, entretanto, não possui uma suíte automatizada versionada.

## Achados críticos e altos

### 1. Credencial inicial previsível do superadministrador

**Severidade:** crítica
**Evidências:** `services/db-reset.js:1176-1184`.

Todo banco novo ou resetado cria `admin@admin.com` com a senha pública `123456`. Embora a troca seja obrigatória no primeiro acesso, qualquer pessoa que autentique antes do operador pode assumir a conta e definir a nova senha.

**Impacto:** controle completo sobre usuários, eventos, artigos, backups, restore e reset do sistema.

**Melhoria recomendada:** exigir uma senha inicial forte por variável de ambiente ou gerar um segredo aleatório de uso único. O servidor não deve aceitar tráfego externo enquanto o bootstrap do superadministrador estiver pendente.

### 2. Validações HTML não interrompem os handlers

**Severidade:** alta
**Evidências:** `security/validation.js:3-31`, `routes/reviewer.js:138-193`.

`validateAndHandle` responde com `400` para JSON, mas, em requisições HTML, apenas grava erros em `res.locals.validationErrors` e chama `next()`. O handler seguinte continua executando. No parecer, por exemplo, uma recomendação fora da whitelist chega ao handler e é normalizada para `approved`.

**Impacto:** dados inválidos podem ser persistidos; decisões administrativas podem assumir valores padrão inesperados.

**Melhoria recomendada:** alterar o contrato para que erro de validação interrompa o fluxo. Cada rota HTML deve fornecer explicitamente uma função para reexibir o formulário com status `400`. Antes disso, revisar as chamadas existentes para remover dependências acidentais do comportamento atual.

### 3. Rate limits compartilhados por todos atrás do nginx

**Severidade:** alta
**Evidências:** `server.js:23-31`, `server.js:71-72`, `security/rate-limits.js:3-78`.

Os limitadores usam `req.socket.remoteAddress`. Atrás do nginx, a chave tende a ser o endereço do próprio proxy, tornando os limites globais para todos os visitantes. Dez tentativas de login podem bloquear todos os logins por 15 minutos, e 200 requisições podem bloquear toda a aplicação.

**Impacto:** negação de serviço simples contra login, cadastro e páginas públicas.

**Melhoria recomendada:** usar `req.ip` com uma cadeia de proxies confiáveis corretamente configurada e impedir acesso direto ao processo Node. Em múltiplas instâncias, usar um store compartilhado para os contadores.

### 4. `staff` recebe acesso administrativo a artigos e relatórios

**Severidade:** alta
**Evidências:** `routes/auth.js:217-252`, `server.js:255-258`, `routes/articles.js:36-64`, `routes/reports.js:7-35`.

`requireAdminOrStaff` une eventos administrados e eventos em que a pessoa é `staff` em um único `req.scopedEventIds`. Os routers de artigos e relatórios verificam apenas esse conjunto, sem preservar qual papel concedeu o acesso.

Um `staff` pode, conforme as rotas atuais, visualizar submissões e pareceres, baixar PDFs, atribuir revisores, alterar decisões ou excluir artigos do evento.

**Impacto:** quebra de confidencialidade e integridade do processo de avaliação.

**Melhoria recomendada:** manter `adminEventIds` e `staffEventIds` separados. Decisão, exclusão e atribuição de revisores devem exigir papel `admin` no evento. Se houver consulta permitida ao staff, ela deve ser somente leitura e explicitamente autorizada.

### 5. Importação por evento permite alterar contas globais

**Severidade:** alta
**Evidências:** `routes/events.js:1283-1285`, `routes/events.js:1366-1380`, `routes/events.js:1409-1428`.

A importação disponível no contexto do evento localiza contas existentes por e-mail, CPF ou passaporte e executa `UPDATE users`, alterando nome, instituição, telefone, e-mail e documentos globais. Como `staff` pode acessar esse fluxo, uma função operacional do evento consegue modificar a identidade usada em todos os eventos.

**Impacto:** corrupção de dados pessoais e alteração de contas fora do escopo autorizado.

**Melhoria recomendada:** a importação por evento deve criar a conta quando inexistente, mas, para contas existentes, atualizar somente `event_registrations`. Alterações em `users` devem ficar restritas ao próprio titular ou ao superadministrador, com auditoria explícita.

### 6. Remover papel de revisor não revoga atribuições antigas

**Severidade:** alta
**Evidências:** `routes/reviewer.js:8-51`, `routes/reviewer.js:67-74`, `routes/reviewer.js:100-135`, `routes/reviewer.js:138-193`.

O middleware verifica se a pessoa é revisora em algum evento. Depois disso, o acesso ao artigo exige apenas uma linha em `assignments`. Se o papel for removido no evento A, mas a pessoa continuar revisora no evento B, atribuições antigas do evento A continuam acessíveis.

**Impacto:** leitura de artigos e envio ou alteração de parecer após revogação de acesso.

**Melhoria recomendada:** dashboard, detalhe e submissão devem exigir simultaneamente uma atribuição e o papel `reviewer` ativo no `event_id` do artigo. Ao remover o papel, definir também a política para atribuições pendentes.

### 7. Ações de artigo por `fetch` não enviam CSRF

**Severidade:** alta
**Evidências:** `views/admin/articles/list.ejs:196-227`, `security/csrf.js:72-78`.

As chamadas `PUT` e `DELETE` da listagem não enviam `_csrf` nem `X-CSRF-Token`. A proteção global deve responder `403`. A alteração de status também ignora a resposta, fazendo a falha parecer bem-sucedida.

**Impacto:** alteração de status e exclusão pela interface não funcionam de forma confiável.

**Melhoria recomendada:** incluir o token no header das chamadas `fetch`, verificar `response.ok`, exibir erro e atualizar a interface somente após confirmação do servidor.

### 8. Migração legada pode deixar chaves estrangeiras desligadas

**Severidade:** alta
**Evidências:** `services/db-reset.js:880-917`.

A migração executa `PRAGMA foreign_keys = OFF`, mas restaura a configuração apenas no caminho de sucesso. O `catch` apenas registra um aviso. Além disso, o insert de reviewer usa `.get().insertId`; para `better-sqlite3`, o correto é `.run().lastInsertRowid`.

**Impacto:** em banco legado, a migração pode falhar e o processo continuar com integridade referencial desativada.

**Melhoria recomendada:** restaurar `foreign_keys` em `finally`, corrigir a API do insert, envolver cada migração em transação e interromper o boot quando uma migração crítica falhar. Executar `PRAGMA foreign_key_check` antes de começar a atender requisições.

### 9. Migrações silenciosas podem deixar schema parcial

**Severidade:** alta
**Evidências:** `services/db-reset.js:543-799`, `services/db-reset.js:919-1071`.

O boot contém vários blocos independentes com erros suprimidos, inclusive `catch` vazios. Não há tabela de versão de schema nem garantia de que uma migração foi concluída integralmente.

**Impacto:** o servidor pode iniciar com colunas, índices ou constraints ausentes e apresentar falhas distantes da causa original.

**Melhoria recomendada:** adotar migrações numeradas, uma tabela `schema_migrations`, transações por versão, logs explícitos e política fail-fast para erros inesperados.

### 10. Backup e restore não garantem consistência completa

**Severidade:** alta
**Evidências:** `services/backup.js:145-193`, `services/backup.js:298-398`.

O banco é fotografado com `VACUUM INTO`, mas uploads e assets são lidos depois diretamente das pastas ativas. Alterações durante a geração podem produzir um ZIP com banco e arquivos de instantes diferentes.

No restore, se os uploads forem substituídos e uma falha posterior ocorrer nos assets, o catch externo restaura o banco, mas não restaura os uploads. A conexão nova também já pode ter sido publicada por `setDb`, aumentando o risco de rollback incompleto no Windows.

**Impacto:** backup aparentemente íntegro, porém semanticamente inconsistente; restore com banco antigo e arquivos novos após uma falha.

**Melhoria recomendada:** pausar mutações de arquivos durante snapshot/restore, copiar banco e filesystem para uma área de staging, validar o conjunto e efetuar uma troca final. O rollback deve cobrir banco, uploads, assets e workers como uma única operação.

### 11. Presença em lote diverge da presença individual

**Severidade:** alta
**Evidências:** `routes/events.js:2676-2707`, `routes/events.js:2786-2863`.

A marcação individual exige matrícula na atividade para o papel `participant`. A marcação em lote considera suficiente existir inscrição no evento. Ela também escolhe um único papel global por prioridade, o que pode ignorar participantes matriculados ou marcar pessoas com um papel diferente do esperado.

**Impacto:** presenças e certificados incorretos.

**Melhoria recomendada:** reutilizar `applyAttendanceMark` ou uma única função de elegibilidade nos fluxos individual, QR e lote. Determinar o papel elegível por pessoa, não uma vez para todo o lote, e executar o lote em transação.

### 12. Check-in público não confere os papéis elegíveis da atividade

**Severidade:** alta
**Evidências:** `routes/public.js:2594-2619`, `routes/public.js:2702-2742`.

Para papéis especiais, `canMarkCheckinRole` verifica somente se a pessoa possui o papel no evento. Não verifica `activity.eligible_roles`. Um professor pode registrar presença como `teacher` em atividade configurada apenas para participantes.

**Impacto:** presença indevida e possível emissão incorreta de certificado por papel.

**Melhoria recomendada:** cruzar o papel solicitado com `eligible_roles` no backend e usar a mesma regra centralizada da marcação administrativa.

## Achados médios

### 13. Notificação de decisão de inscrição nunca é enfileirada

**Evidências:** `routes/events.js:3512-3542`.

No caminho de sucesso, `activities` não existe no escopo usado por `queueRegistrationReviewDecision`. O `ReferenceError` é capturado, a decisão permanece salva e a rota redireciona com sucesso, mas o e-mail não é criado.

**Melhoria recomendada:** carregar as atividades antes da transação e passar uma lista definida ao serviço de e-mail. Testar que decisão e notificação permanecem coerentes mesmo quando o SMTP está desligado.

### 14. “Salvar configuração geral” redireciona para rota exclusivamente POST

**Evidências:** `routes/events.js:2875-2901`.

Quando `apply_to_all=1`, a rota responde com redirect para `/certificates/rule/apply-to-all`. O navegador transforma isso em GET, mas o endpoint existe somente como POST.

**Melhoria recomendada:** executar a operação compartilhada diretamente no mesmo handler ou extrair uma função usada pelos dois POSTs; não usar redirect para disparar mutação.

### 15. Operações compostas sem transação

**Evidências principais:** `routes/reviewer.js:164-193`, `routes/events.js:3661-3695`, `routes/events.js:3002-3090`, `routes/public.js:1324-1425`.

Há sequências em que uma parte pode ser confirmada antes da seguinte falhar:

- parecer atualiza artigo e assignment antes de gravar o relatório;
- edição de participante confirma papéis antes dos demais dados;
- emissão e reemissão de certificado alteram versões sem uma transação única;
- inscrição pública combina banco, atividades, auditoria e arquivos em etapas independentes.

**Melhoria recomendada:** envolver todas as gravações SQL de cada ação em uma transação. Para arquivos e e-mails, usar staging e padrão outbox: confirmar o estado no banco e processar efeitos externos posteriormente.

### 16. Limite de vagas não é uniforme nem protegido estruturalmente

**Evidências:** `routes/public.js:758-767`, `routes/public.js:1292-1295`, `routes/public.js:1568-1600`, `routes/public.js:1687-1712`.

Alguns fluxos verificam lotação antes da transação; o endpoint específico do minicurso reconta dentro da transação. Em múltiplos processos, duas requisições podem ocupar a última vaga. Pedidos que exigem análise também recebem tratamento diferente entre tela, inscrição inicial e endpoint dedicado.

**Melhoria recomendada:** centralizar matrícula e pedido em um serviço transacional, definir explicitamente se pedido pendente reserva vaga e documentar uma única regra para todos os pontos de entrada.

### 17. Estado de pedidos armazenado como JSON favorece perda de atualização

**Evidências:** `routes/public.js:1668-1696`, `routes/public.js:1728-1734`, `routes/events.js:3551-3590`.

`requested_activity_ids` e `rejected_activity_ids` são lidos, alterados em memória e regravados por inteiro. Requisições concorrentes podem sobrescrever alterações distintas.

**Melhoria recomendada:** substituir os arrays JSON por uma tabela de solicitações com `registration_id`, `activity_id`, `status`, timestamps e constraint única. Isso simplifica consultas, auditoria e concorrência.

### 18. Certificados podem ficar com múltiplas versões ativas

**Evidências:** `routes/events.js:3002-3090`, `services/db-reset.js:423-454`, `routes/public.js:2397-2420`.

A interface esconde o botão de emissão quando existe certificado ativo, mas o endpoint não repete a regra. Uma chamada direta ou dupla submissão pode criar outra versão `issued`. A consulta pública também apresenta uma versão `reissued` como “Certificado Verificado”, sem informar que foi substituída.

**Melhoria recomendada:** impor uma única emissão ativa por evento, usuário e papel, preferencialmente com índice único parcial. Em reemissão, alterar as versões em transação e indicar publicamente quando um código foi substituído.

### 19. Sessões e rate limits usam memória local

**Evidências:** `server.js:97-107`, `security/rate-limits.js:13-78`.

Sem `store` explícito, `express-session` usa `MemoryStore`. Sessões somem em reinícios, não são compartilhadas entre processos e consomem memória do processo. Rate limits também não são compartilhados entre instâncias.

**Melhoria recomendada:** usar store persistente com TTL para sessões e limitadores. Se a decisão for manter uma única instância, documentar e monitorar essa restrição.

### 20. Alterar senha não invalida outras sessões

**Evidências:** `server.js:97-107`, `routes/auth.js:780-811`, `routes/public.js:2294-2343`, `routes/users.js:758-793`.

Uma sessão roubada continua válida até expirar mesmo depois de troca ou reset de senha.

**Melhoria recomendada:** adicionar `session_version` ou `password_changed_at` ao usuário, copiar o valor para a sessão no login e destruí-la quando houver divergência.

### 21. Upload de logo confia em MIME e extensão do cliente

**Evidências:** `routes/events.js:284-302`, `server.js:86-88`.

O arquivo mantém a extensão original e é servido pela mesma origem. Um arquivo HTML enviado com MIME de imagem pode ser armazenado e servido como conteúdo ativo.

**Melhoria recomendada:** verificar magic bytes, gerar a extensão a partir do formato validado e reprocessar imagens. Idealmente, servir uploads em origem isolada ou como attachment.

### 22. Avaliação declarada como cega expõe autores

**Evidências:** `routes/reviewer.js:21-35`, `routes/reviewer.js:117-122`, `views/reviewer/dashboard.ejs:157-165`, `views/reviewer/article.ejs:74-93`.

O painel e o detalhe do revisor carregam responsável e autores apesar da confirmação de avaliação cega.

**Melhoria recomendada:** criar uma projeção específica para revisão, omitindo autoria, afiliação, e-mail e nomes originais até o encerramento da etapa cega.

### 23. Mojibake em mensagens, logs e PDFs

**Evidências:** exemplos em `routes/events.js:146-181`, `routes/events.js:2661-2671`, `routes/events.js:3502-3592`.

Há literais gravados como `InscriÃ§Ã£o`, `PresenÃ§a` e sequências semelhantes. O problema alcança interface, mensagens de erro, logs e conteúdo PDF.

**Melhoria recomendada:** corrigir `routes/events.js` como UTF-8 em uma alteração isolada, revisar o diff para evitar dupla conversão e adicionar testes de strings críticas e geração de PDF.

### 24. Reset pode apagar arquivos antes de confirmar o novo banco

**Evidências:** `services/db-reset.js:1188-1218`.

`clearUploads()` é executado antes de apagar e recriar o banco. Se a inicialização falhar, os arquivos anteriores já foram perdidos.

**Melhoria recomendada:** criar backup temporário ou staging e efetuar a troca somente depois que o novo banco passar por validação de schema e integridade.

## Integridade e desempenho

### 25. Relações entre entidades do mesmo evento não são garantidas pelo schema

As chaves estrangeiras garantem que os IDs existam, mas não garantem que atividade, inscrição, usuário, sala e evento pertençam ao mesmo contexto. As rotas normalmente fazem essas validações, porém scripts, migrações ou bugs futuros podem criar relações semanticamente inválidas sem violar `foreign_key_check`.

**Melhoria recomendada:** reduzir IDs redundantes, usar chaves compostas ou triggers de consistência e criar uma verificação operacional que procure relações entre eventos incompatíveis.

### 26. Emissão de certificados apresenta padrão N+1

**Evidências:** `routes/events.js:1535-1668`, `routes/events.js:3002-3068`.

O cálculo de candidatos executa múltiplas consultas por pessoa. Na emissão em lote, a lista pode ser recalculada para cada candidato, aproximando-se de crescimento quadrático.

**Melhoria recomendada:** carregar presenças, matrículas, emissões e versões em consultas agregadas, indexadas por usuário e papel em memória durante o lote.

### 27. Consultas de salas e atividades também apresentam N+1

**Evidências:** `routes/public.js:1052-1073`, `routes/events.js:2081-2084`, `services/rooms.js:176-183`.

Atividades e etapas consultam alocação individualmente, embora a página pública já carregue atribuições do evento.

**Melhoria recomendada:** carregar todas as alocações do evento uma vez e indexá-las por atividade e etapa.

### 28. Índices adicionais devem ser avaliados com carga real

Consultas frequentes sugerem avaliar índices como:

- `articles(event_id, status, created_at)`;
- `assignments(article_id, reviewer_id)` com unicidade;
- `assignments(reviewer_id, status)`;
- `reports(assignment_id)` com unicidade;
- `event_activities(event_id, date_start)`;
- `activity_sessions(activity_id, sequence_no)`;
- `event_user_roles(user_id, role, event_id)`.

Os índices devem ser confirmados com `EXPLAIN QUERY PLAN` e dados representativos antes de inclusão.

## Manutenibilidade e operação

### 29. Arquivos concentram responsabilidades demais

`routes/events.js`, `routes/public.js` e `services/db-reset.js` concentram autorização, SQL, upload, regras de negócio, PDF, e-mail e renderização.

**Melhoria recomendada:** depois de proteger os fluxos com testes, extrair gradualmente serviços de domínio:

- inscrições e pedidos de atividade;
- presença e elegibilidade;
- certificados;
- autorização por evento;
- migrações;
- backup e restore.

Evitar uma reescrita ampla sem testes. A extração deve ocorrer por fluxo, preservando comportamento.

### 30. Regras e rótulos estão duplicados

Papéis, tipos de atividade, CPF e autorização aparecem em múltiplas rotas, serviços e templates.

**Melhoria recomendada:** criar módulos pequenos de constantes e regras compartilhadas. Não colocar acesso ao banco nesses módulos quando bastar uma função pura.

### 31. Observabilidade insuficiente

O projeto depende de `console.log`, `console.warn` e `console.error`, sem identificador de requisição ou campos estruturados.

**Melhoria recomendada:** adicionar request ID, logs estruturados, ação, usuário, evento, duração e erro. Monitorar fila de e-mail, falhas de migração, restores, respostas 403/429/500 e tempo de emissão de certificados.

### 32. Ausência de testes automatizados

`package.json` não possui scripts `test`, `lint` ou cobertura. Os E2E registrados na documentação foram execuções ad hoc sem harness versionado.

**Melhoria recomendada:** começar por testes de integração com banco temporário isolado, cobrindo:

1. superadmin, admin de evento, staff, revisor e participante;
2. CSRF em formulários e `fetch`;
3. validação inválida sem persistência;
4. inscrição, lotação e pedidos concorrentes;
5. presença individual, QR e lote com a mesma elegibilidade;
6. revogação de revisor;
7. emissão e reemissão de certificado;
8. migração de bancos representativos;
9. backup/restore com falhas injetadas;
10. datas sob `TZ=UTC` e `America/Sao_Paulo`.

## Ordem recomendada de execução

### Fase 1 - Segurança e falhas funcionais

1. Remover senha padrão do superadministrador.
2. Corrigir validações que continuam para o handler.
3. Separar permissões de admin e staff.
4. Impedir importação por evento de alterar contas globais.
5. Revogar corretamente o acesso de revisores.
6. Corrigir CSRF dos `fetch` de artigos.
7. Corrigir presença em lote e check-in público.

### Fase 2 - Integridade operacional

1. Corrigir migração legada e implementar migrações versionadas.
2. Tornar backup, restore e reset reversíveis como conjunto.
3. Adicionar transações aos fluxos compostos.
4. Corrigir vagas, pedidos e certificados com constraints adequadas.
5. Pausar workers durante restore/reset.

### Fase 3 - Produção e qualidade

1. Adotar store persistente para sessões e rate limits.
2. Invalidar sessões após troca de senha.
3. Validar conteúdo real dos uploads.
4. Corrigir mojibake.
5. Adicionar logs estruturados e métricas.
6. Criar suíte automatizada e pipeline de verificação.

### Fase 4 - Desempenho e modularização

1. Eliminar N+1 em certificados e salas.
2. Medir e criar índices.
3. Extrair serviços por fluxo, apoiados pelos testes.
4. Consolidar constantes e regras duplicadas.

## Pontos positivos observados

- Proteção CSRF global para métodos mutáveis.
- Rotação de sessão no login contra fixation.
- Cookies `httpOnly`, `sameSite=lax` e `secure` em produção.
- CSP com nonce e escaping padrão dos templates EJS.
- Consultas revisadas majoritariamente parametrizadas.
- Backup com limites contra ZIP bomb, verificação de tamanho/CRC e proteção contra path traversal.
- Uso de WAL, `foreign_keys=ON` e transações em vários fluxos importantes.
- Escopo por evento já presente como base, embora precise distinguir admin de staff.
- Tokens de definição de senha persistidos em hash, com expiração e uso único.

## Limitações da análise

A revisão foi predominantemente estática. Não foram executados fluxos HTTP autenticados sobre o banco real para evitar alteração de dados. Também não existe uma suíte automatizada que permita confirmar regressões end-to-end de forma repetível. Por isso, cada correção deve ser acompanhada por teste isolado em banco temporário antes de implantação.
