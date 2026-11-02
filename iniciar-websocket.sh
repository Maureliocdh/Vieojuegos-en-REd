#!/bin/sh
set -eu

cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Error: Node.js no esta instalado o no esta disponible en PATH.' >&2
  exit 1
fi

exec node iniciar.js --nativo
