# Plano de Implementação - Entrada pelo evento e acesso de organizadores

## 1. Objetivo

Separar claramente as formas de entrada no sistema:

1. **Participar de um evento:** cadastro e inscrição iniciados exclusivamente pelo card do evento.
2. **Acessar uma conta existente:** entrada única para participantes, revisores, organizadores e administradores.
3. **Organizar um evento:** solicitação específica, independente da inscrição como participante.

Essa estrutura elimina o cadastro público genérico e evita que o visitante precise compreender previamente a diferença entre criar uma conta e se inscrever em um evento.

## 2. Navegação da página inicial

Para visitantes sem sessão, o menu superior deverá exibir somente:

- **Verificar Certificado**;
- **Acessar conta / Administração**.

O link **Solicitar Cadastro** será removido da navegação.

A verificação de certificados continuará sendo pública e acessível diretamente pelo menu superior.

## 3. Cards dos eventos

Cada card deixará de funcionar como um único link e passará a apresentar ações distintas:

- **Ver evento**;
- **Solicitar inscrição**, quando a inscrição pública estiver disponível.

O botão **Solicitar inscrição** abrirá:

`/evento/:id/inscricao`

Para visitantes, essa página permitirá solicitar conjuntamente:

- a criação da conta, quando ainda não existir;
- a inscrição no evento;
- a participação nas etapas ou atividades selecionadas;
- o subsídio, quando oferecido pelo evento.

Para usuários autenticados, a mesma página utilizará os dados da conta existente e realizará somente a inscrição no evento e em suas etapas.

Eventos encerrados, sem inscrição pública ou fora do período de inscrição não exibirão uma ação ativa de solicitação.

## 4. Cadastro e inscrição pelo evento

### 4.1 Visitante sem conta

O formulário deverá coletar inicialmente:

- nome completo;
- e-mail;
- confirmação do e-mail;
- instituição;
- etapas ou atividades desejadas;
- informações de subsídio, quando aplicáveis.

O sistema criará a conta e a solicitação de inscrição em uma única operação transacional.

A solicitação ficará inicialmente em `email_pending`. Depois da confirmação do e-mail, passará para `pending` e ficará visível ao administrador do evento.

### 4.2 Conta pendente

Se já existir uma conta pendente para o e-mail informado:

- a conta poderá ser reutilizada;
- a posse do e-mail deverá ser confirmada;
- a inscrição somente ficará visível depois da confirmação;
- nenhuma informação sobre a existência da conta será revelada na resposta pública.

### 4.3 Conta aprovada

Se o e-mail pertencer a uma conta já aprovada:

- não será criada inscrição anônima;
- a resposta pública permanecerá genérica;
- o titular receberá orientação para acessar sua conta e concluir a inscrição autenticado.

### 4.4 Usuário autenticado

O sistema utilizará obrigatoriamente a identidade e o e-mail da sessão.

Não será possível alterar a identidade da inscrição enviando outro e-mail pelo formulário.

## 5. Confirmação de e-mail

Adicionar tokens de uso único para confirmar a solicitação de inscrição, com:

- hash do token armazenado no banco;
- validade de 72 horas;
- data de uso;
- data de revogação;
- vínculo com a conta e a inscrição;
- índices e exclusão em cascata adequados.

A rota pública de confirmação deverá:

1. validar e reivindicar atomicamente o token;
2. alterar a inscrição de `email_pending` para `pending`;
3. registrar auditoria;
4. tornar o pedido visível ao administrador correto;
5. apresentar uma confirmação ao solicitante.

Tokens expirados poderão ser reenviados com segurança. A geração de um novo token revogará os anteriores da mesma solicitação.

## 6. Análise da inscrição

Somente administradores do evento poderão analisar pedidos de inscrição. Staff não poderá visualizar a seção nem acessar as rotas de análise.

Aprovar uma inscrição deverá:

1. confirmar que ela ainda está pendente;
2. registrar as atividades aprovadas;
3. aprovar a conta, caso ainda esteja pendente;
4. liberar a definição da primeira senha;
5. registrar auditoria da conta e da inscrição;
6. enfileirar os e-mails correspondentes.

Rejeitar uma inscrição deverá alterar somente a inscrição. A conta permanecerá pendente e poderá ser vinculada posteriormente a outra solicitação.

## 7. Página de login

A página de login deverá indicar explicitamente que se destina a:

- participantes que já possuem conta;
- revisores;
- organizadores;
- administradores.

O link **Solicitar novo cadastro** será removido.

O texto deverá orientar novos participantes a voltar à página inicial e selecionar o evento desejado.

## 8. Fim do cadastro público genérico

A rota `/cadastro` não continuará oferecendo cadastro geral.

Ela deverá redirecionar para a página inicial com uma orientação para escolher um evento. A rota de sucesso correspondente também será retirada do fluxo público geral.

O formulário atual poderá ser reaproveitado visualmente, mas não continuará representando uma porta genérica de criação de conta.

## 9. Solicitação de acesso como organizador

O rodapé da página inicial exibirá discretamente:

**Solicitar acesso como organizador**

Esse link abrirá uma rota específica, por exemplo:

`/solicitar-acesso-organizador`

O fluxo será independente da inscrição em eventos e deverá explicar que a autorização é necessária para criar e administrar novos eventos.

### 9.1 Dados da solicitação

- nome completo;
- e-mail;
- confirmação do e-mail;
- instituição;
- justificativa breve para organizar eventos.

### 9.2 Estados

A solicitação de organizador poderá assumir os estados:

- `email_pending`;
- `pending`;
- `approved`;
- `rejected`.

Somente pedidos com e-mail confirmado poderão aparecer para análise.

### 9.3 Contas novas e existentes

- **Pessoa sem conta:** criar uma conta pendente vinculada ao pedido.
- **Pessoa autenticada:** registrar somente o pedido de autorização.
- **E-mail já cadastrado sem sessão:** retornar resposta genérica, sem confirmar a existência da conta, e orientar o titular por e-mail a entrar no sistema.

## 10. Modelo de autorização para criar eventos

Adicionar uma autorização explícita, como `can_create_events`, à conta.

Poderão criar novos eventos:

- o superadmin;
- organizadores com solicitação aprovada;
- administradores de eventos existentes preservados pela migração.

Participantes comuns não poderão criar eventos apenas por possuírem uma conta aprovada.

O middleware `requireSignedUser`, atualmente usado na criação de eventos, deverá ser substituído por uma verificação específica dessa autorização.

A autorização para criar eventos não concederá administração global. Ao criar um evento, o usuário continuará recebendo apenas o papel `admin` daquele novo evento.

## 11. Persistência das solicitações de organizador

Criar uma tabela específica, como `organizer_access_requests`, em vez de misturar essa decisão com o estado geral da conta.

A tabela deverá registrar:

- usuário vinculado, quando existir;
- nome;
- e-mail;
- instituição;
- justificativa;
- estado da solicitação;
- confirmação do e-mail;
- data da solicitação;
- data e responsável pela decisão;
- motivo de eventual rejeição.

A aprovação deverá:

- aprovar a conta, quando necessário;
- definir `can_create_events=1`;
- gerar o link de primeira senha para uma conta nova;
- registrar auditoria;
- notificar o solicitante.

A rejeição não deverá remover, bloquear ou desativar uma conta já existente.

Somente o superadmin poderá analisar pedidos de organizador.

## 12. Dashboard administrativo

O sistema terá duas filas claramente separadas:

- **Pedidos de inscrição:** visíveis apenas aos administradores dos respectivos eventos;
- **Pedidos de acesso como organizador:** visíveis apenas ao superadmin.

Staff não terá acesso a nenhuma decisão de aprovação de conta ou de autorização para criar eventos.

As filas não exibirão solicitações ainda em `email_pending`.

## 13. E-mails e privacidade

Adicionar mensagens específicas para:

- confirmação da inscrição no evento;
- confirmação do pedido de organizador;
- aprovação ou rejeição da inscrição;
- aprovação ou rejeição do acesso como organizador;
- definição da primeira senha.

As respostas públicas deverão ser uniformes para evitar enumeração de contas.

Se o envio de e-mails estiver indisponível, solicitações anônimas que dependam de confirmação não deverão ser criadas.

## 14. Atomicidade e concorrência

Os fluxos deverão:

- criar conta, solicitação, atividades e auditoria em transações;
- revalidar vagas dentro da transação;
- tratar conflitos dos índices únicos;
- impedir decisões duplicadas;
- impedir múltiplos pedidos ativos equivalentes;
- revogar tokens anteriores ao gerar um novo;
- limpar uploads quando uma operação falhar;
- remover arquivos substituídos somente após a confirmação da gravação.

## 15. Compatibilidade e migração

Na migração inicial:

- o superadmin receberá autorização para criar eventos;
- usuários que já administram algum evento receberão `can_create_events=1`;
- participantes comuns não receberão essa autorização;
- eventos e papéis atuais serão preservados;
- solicitações antigas de cadastro permanecerão identificáveis para análise manual.

Nenhuma conta existente será promovida a administradora global.

## 16. Verificação

Os testes deverão usar banco temporário isolado e cobrir:

1. A home exibe certificado e acesso à conta, mas não cadastro geral.
2. Card com inscrições abertas exibe **Ver evento** e **Solicitar inscrição**.
3. Card encerrado ou fora do período não oferece solicitação ativa.
4. Visitante cria conta e inscrição pelo evento em uma transação.
5. Pedido não aparece ao administrador antes da confirmação do e-mail.
6. Token válido torna a inscrição visível ao administrador correto.
7. Tokens usados, expirados ou revogados são recusados.
8. Conta aprovada não recebe inscrição anônima.
9. Staff não vê nem decide pedidos de inscrição.
10. Aprovação da inscrição também aprova uma conta pendente.
11. Rejeição da inscrição mantém a conta pendente.
12. Participante comum não pode criar evento.
13. Organizador autorizado pode criar evento e se torna administrador dele.
14. Pedido de organizador somente aparece após a confirmação do e-mail.
15. Somente o superadmin decide pedidos de organizador.
16. Aprovação de organizador concede `can_create_events` sem conceder administração global.
17. Migração preserva a capacidade dos administradores de eventos existentes.
18. Respostas públicas não revelam se o e-mail já está cadastrado.
19. Falhas transacionais não deixam contas, inscrições, tokens ou uploads parciais.
20. `node --check`, compilação EJS, `npm run verify-env` e `git diff --check` passam.

## 17. Arquivos principais

- `services/db-reset.js`
- `services/email.js`
- `security/validation.js`
- `routes/public.js`
- `routes/auth.js`
- `routes/events.js`
- `views/public/home.ejs`
- `views/public/home-event-card.ejs`
- `views/public/event.ejs`
- `views/public/event-register.ejs`
- `views/login.ejs`
- nova interface pública de solicitação de organizador
- interface do superadmin para pedidos de organizador
- dashboard dos administradores de evento
- documentação Markdown do projeto
