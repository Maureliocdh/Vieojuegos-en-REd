@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 exit /b 1

echo OUTPOST - Iniciar servidor
echo 1) Socket.IO
echo 2) WebSocket nativo
echo 0) Salir
choice /c 120 /n /m "Selecciona una opcion: "
if errorlevel 255 exit /b 1
if errorlevel 3 exit /b 0
if errorlevel 2 goto websocket
if errorlevel 1 goto socketio
exit /b 1

:websocket
set "argumento=--nativo"
goto iniciar

:socketio
set "argumento="

:iniciar
where node >nul 2>&1
if errorlevel 1 (
  echo Error: Node.js no esta instalado o no esta disponible en PATH.
  pause
  exit /b 1
)
node iniciar.js %argumento%
set "resultado=%errorlevel%"
if not "%resultado%"=="0" pause
exit /b %resultado%
