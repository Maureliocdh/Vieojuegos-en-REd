const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const socket = io();
// Esta copia se actualiza con el estado global que envía el servidor.
let jugadores = {};

// Se comprueba una vez: en móviles se añaden controles táctiles.
const isMobile = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent);
const keys = new Set();
const mouse = { x: 0, y: 0 };
const movement = { x: 0, y: 0 };
const aim = { x: 1, y: 0 };

const player = {
  x: window.innerWidth / 2, y: window.innerHeight / 2, angle: 0, speed: 350,
  image: new Image(),
};

socket.on('jugadores', (jugadoresDelServidor) => {
  jugadores = jugadoresDelServidor;
});

// La notificación permite quitarlo sin esperar al siguiente tick de 30 FPS.
socket.on('jugadorDesconectado', (id) => {
  delete jugadores[id];
});

// Express sirve "public" como raíz estática, por eso la ruta comienza con /.
player.image.src = '/assets/sprites/jugador.png';
player.image.addEventListener('error', () => console.error('No se pudo cargar /assets/sprites/jugador.png'));

/** Ajusta el búfer para pantallas retina sin cambiar las coordenadas del juego. */
function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  player.x = Math.min(Math.max(player.x, 0), window.innerWidth);
  player.y = Math.min(Math.max(player.y, 0), window.innerHeight);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ----- Controles de PC ----------------------------------------------------
window.addEventListener('keydown', (event) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousemove', (event) => {
  const bounds = canvas.getBoundingClientRect();
  mouse.x = event.clientX - bounds.left;
  mouse.y = event.clientY - bounds.top;
});

/** Carga NippleJS únicamente si el dispositivo es móvil. */
function loadNippleJS() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/nipplejs@0.10.2/dist/nipplejs.min.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar NippleJS'));
    document.head.appendChild(script);
  });
}

function createMobileControls() {
  document.body.classList.add('mobile');
  const options = { mode: 'static', color: '#fff', size: 120, restOpacity: 0.45 };
  const moveStick = nipplejs.create({ zone: document.getElementById('move-zone'), ...options });
  moveStick.on('move', (_event, data) => {
    movement.x = data.vector.x;
    movement.y = -data.vector.y; // NippleJS considera arriba como Y positiva.
  });
  moveStick.on('end', () => Object.assign(movement, { x: 0, y: 0 }));

  const aimStick = nipplejs.create({ zone: document.getElementById('aim-zone'), ...options });
  aimStick.on('move', (_event, data) => {
    aim.x = data.vector.x;
    aim.y = -data.vector.y;
  });
  aimStick.on('end', () => Object.assign(aim, { x: 0, y: 0 }));
}

if (isMobile) loadNippleJS().then(createMobileControls).catch(console.error);

function update(deltaSeconds) {
  let moveX = movement.x;
  let moveY = movement.y;
  if (!isMobile) {
    moveX = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    moveY = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
  }

  const magnitude = Math.hypot(moveX, moveY);
  if (magnitude > 0) {
    player.x += (moveX / magnitude) * player.speed * deltaSeconds;
    player.y += (moveY / magnitude) * player.speed * deltaSeconds;
  }

  if (isMobile) {
    if (Math.hypot(aim.x, aim.y) > 0.05) player.angle = Math.atan2(aim.y, aim.x);
  } else {
    player.angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
  }

  // El servidor conservará este estado asociado a socket.id.
  socket.emit('movimiento', { x: player.x, y: player.y, angle: player.angle });
}

function draw() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.fillStyle = '#20242b';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  if (!player.image.complete || !player.image.naturalWidth) return;

  // Cada entrada fue creada y sincronizada por el servidor.
  for (const id in jugadores) {
    const jugador = jugadores[id];

    // Se traslada al centro antes de rotar: la imagen rota sobre su propio centro.
    ctx.save();
    ctx.translate(jugador.x, jugador.y);
    ctx.rotate(jugador.angle);
    ctx.drawImage(player.image, -player.image.naturalWidth / 2, -player.image.naturalHeight / 2);
    ctx.restore();
  }
}

let previousTime = performance.now();
function gameLoop(currentTime) {
  // Se limita el delta para que no salte al regresar a la pestaña.
  const deltaSeconds = Math.min((currentTime - previousTime) / 1000, 0.1);
  previousTime = currentTime;
  update(deltaSeconds);
  draw();
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
