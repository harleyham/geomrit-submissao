# Histórico Técnico do Projeto

Registro cronológico das alterações relevantes do sistema de submissão de artigos.

## 2026-07-28

### Documentação

- `submissao.md` consolidado como especificação técnica do estado atual do produto.
- `submissao_log.md` mantido como histórico técnico incremental do projeto.

### Implementações

- Fluxo de revisão ajustado para usar `assignments` e `reports` como fonte de verdade no painel do revisor.
- Regra real de período de submissão aplicada com base em `submission_start` e `submission_end`.
- Exibição do e-mail do usuário autenticado adicionada nas áreas principais do painel administrativo e do painel do revisor.
- Controle de visibilidade de senha adicionado aos principais formulários com campo de senha.
- Página `/admin/users` alterada para trabalhar com salvamento único em lote de perfis e status.
- Interface de gestão de usuários refinada para separar claramente `Revisor` de `Conta ativa`.
- Badge visual adicionado para identificar revisor inativo na tela de usuários.

### Correções

- Correção da separação entre artigos pendentes e artigos revisados no dashboard do revisor.
- Correção da lógica pública de abertura e fechamento da janela de submissão.
- Correção do parsing de flags de usuários para persistir corretamente valores ativados e desativados.
- Correção da contagem de `Revisores Ativos` no dashboard administrativo.
- Correção da contagem de `Revisores Inativos` no dashboard administrativo.
- Correção do ícone de mostrar ou ocultar senha para alternar visualmente com o estado do campo.

### Observações Técnicas

- A rota `POST /admin/users/bulk-update-flags` passou a ser o fluxo principal de persistência de perfis na listagem de usuários.
- Endpoints legados de toggle individual continuam presentes no backend, mas a interface principal não depende mais deles.
- O sistema continua exigindo reinício do servidor para refletir alterações em rotas e templates.

### Pendências Conhecidas

- Upload público real de arquivo ainda não está fechado de ponta a ponta.
- Fluxo de decisão final administrativa ainda precisa de validação funcional completa.
- Há rotas e estruturas legadas no projeto que ainda precisam ser enxugadas.
