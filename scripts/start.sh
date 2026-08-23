#!/usr/bin/env bash
set -e

MIN_MAJOR=22
REQUIRED="Node ${MIN_MAJOR}.0 ou superior"

version_major() {
  # Imprime a versão major de um binário node (ex.: 22) ou falha.
  local out
  out="$("$1" --version 2>/dev/null | sed 's/^v//')" || return 1
  echo "${out%%.*}"
}

# 1) Se o nvm estiver disponível, use a versão travada (conforme .nvmrc) ou >= 22.
NVM_HOME="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_HOME/nvm.sh" ]; then
  unset npm_config_prefix NPM_CONFIG_PREFIX
  source "$NVM_HOME/nvm.sh"
  nvm use --silent || true
fi

# 2) Descubra a versão do Node que rodará.
NODE_BIN="${NODE:-node}"
[ "$(version_major "$NODE_BIN")" ] || NODE_BIN="node"
MAJOR="$(version_major "$NODE_BIN")"

if [ -z "$MAJOR" ] || [ "$MAJOR" -lt "$MIN_MAJOR" ]; then
  cat >&2 <<EOF
[start] ERRO: $REQUIRED é obrigatório.
  Versão detectada: "$(node --version 2>/dev/null)"

O projeto usa módulos nativos (better-sqlite3) e bibliotecas que exigem Node >= ${MIN_MAJOR}.
Instale/ative o Node ${MIN_MAJOR}+ antes de rodar (escolha uma):

  1) nvm (recomendado, ~/ .nvm/nvm.sh):
       nvm install ${MIN_MAJOR} --reinstall-packages-from="$(node --version 2>/dev/null)"
       nvm use ${MIN_MAJOR}
     Ou seguir a versão travada no .nvmrc:
       nvm install && nvm use

  2) Direto da fonte: baixe um release >= ${MIN_MAJOR} em
       https://nodejs.org/dist/   (escolha a build da sua plataforma: x64 ou arm64)
     e inclua o binário no PATH.

Depois de atualizar, reinstale as dependências e rode:
     npm install
     npm start
     npm run verify-env   # cheque a versão do Node e as dependências obrigatórias
EOF
  exit 1
fi

ARGS=(server.js)
if [ -f ".env" ]; then
  ARGS=(--env-file=.env "${ARGS[@]}")
fi
exec node "${ARGS[@]}"
