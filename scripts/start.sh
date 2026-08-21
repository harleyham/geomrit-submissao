#!/usr/bin/env bash
set -e

NVM_HOME="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_HOME/nvm.sh" ]; then
  unset npm_config_prefix NPM_CONFIG_PREFIX
  source "$NVM_HOME/nvm.sh"
  nvm use --silent
fi

exec node server.js
