#!/bin/sh
set -eu

cd -- "$(dirname -- "$0")"
printf '%s\n' 'OUTPOST - Iniciar servidor' '1) Socket.IO' '2) WebSocket nativo' '0) Salir'
printf '%s' 'Selecciona una opcion: '
if ! IFS= read -r opcion; then
  printf '\n%s\n' 'Error: no se recibio una opcion.' >&2
  exit 1
fi

case "$opcion" in
  1) exec ./iniciar-socketio.sh ;;
  2) exec ./iniciar-websocket.sh ;;
  0) exit 0 ;;
  *) printf '%s\n' 'Error: opcion no valida. Usa 1, 2 o 0.' >&2; exit 1 ;;
esac
