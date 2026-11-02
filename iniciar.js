const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { dependencies } = require('./package.json');

process.chdir(__dirname);

function missingDependencies() {
  return Object.keys(dependencies).some(name => {
    try {
      require.resolve(name, { paths: [__dirname] });
      return false;
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
      return true;
    }
  });
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/d', '/c', 'start', '', url] : [url];
  const browser = spawn(command, args, { stdio: 'ignore' });
  browser.on('error', error => console.error(`No se pudo abrir el navegador: ${error.message}. Abre ${url}`));
  browser.on('exit', code => {
    if (code) console.error(`El navegador no se pudo abrir (codigo ${code}). Abre ${url}`);
  });
}

function main() {
  if (missingDependencies()) {
    console.log('Instalando dependencias. La primera vez necesitas conexion a Internet...');
    const install = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/c', 'npm ci'], { stdio: 'inherit' })
      : spawnSync('npm', ['ci'], { stdio: 'inherit' });
    if (install.error) throw install.error;
    if (install.status !== 0) throw new Error('No se pudieron instalar las dependencias. Revisa los mensajes anteriores.');
  }

  const native = process.argv.includes('--nativo');
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), ...(native ? ['--nativo'] : [])], {
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  let output = '';
  let opening = false;
  const startupTimer = setTimeout(() => {
    console.error('El servidor no confirmo su inicio en 15 segundos. Revisa los errores y el puerto configurado.');
    process.exitCode = 1;
    server.kill();
  }, 15000);
  server.stdout.on('data', data => {
    process.stdout.write(data);
    output = (output + data).slice(-2000);
    const address = output.match(/en (http:\/\/localhost:\d+)/);
    if (!address || opening) return;
    opening = true;
    clearTimeout(startupTimer);
    const url = address[1];
    const request = http.get(`${url}/modo`, response => {
      let body = '';
      response.on('data', data => { body += data; });
      response.on('error', error => console.error(`Error comprobando el servidor: ${error.message}`));
      response.on('end', () => {
        try {
          if (response.statusCode !== 200 || JSON.parse(body).modo !== (native ? 'nativo' : 'socket.io')) {
            throw new Error('El servidor no responde con el modo de red esperado.');
          }
          console.log(`Listo. Mantén esta terminal abierta. Para detener el servidor: Ctrl+C.\n${url}`);
          if (!process.argv.includes('--sin-navegador')) openBrowser(url);
        } catch (error) {
          console.error(`Error comprobando el servidor: ${error.message}`);
          server.kill();
          process.exitCode = 1;
        }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error('Tiempo de espera agotado')));
    request.on('error', error => {
      console.error(`No se pudo comprobar el servidor: ${error.message}`);
      server.kill();
      process.exitCode = 1;
    });
  });
  server.on('error', error => {
    clearTimeout(startupTimer);
    console.error(`No se pudo iniciar el servidor: ${error.message}`);
    process.exitCode = 1;
  });
  server.on('exit', (code, signal) => {
    clearTimeout(startupTimer);
    if (code) process.exitCode = code;
    else if (signal && signal !== 'SIGINT' && signal !== 'SIGTERM') process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.kill(signal));
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
