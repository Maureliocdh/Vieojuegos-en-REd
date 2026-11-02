# OUTPOST: sockets y guía para la defensa del proyecto

Este documento explica cómo funciona la comunicación de este videojuego y ofrece preguntas con respuestas para una exposición. Describe la implementación actual y diferencia las funciones existentes de las posibles mejoras.

## 1. Explicación breve para comenzar la exposición

> OUTPOST es un videojuego multijugador con arquitectura cliente-servidor. El navegador dibuja la partida y envía acciones; un servidor Node.js mantiene el mundo compartido y calcula el combate. Podemos ejecutar la misma lógica con Socket.IO o con WebSocket nativo. Un adaptador traduce ambos transportes a los mismos eventos, por lo que cambiar de transporte no exige reescribir las reglas del juego.

**Aclaración importante:** no se usan dos conexiones de juego simultáneas. El servidor selecciona una alternativa al arrancar:

| Alternativa | Comando | Cliente | Servidor |
| --- | --- | --- | --- |
| Socket.IO | `npm start` | Biblioteca `socket.io-client`, servida al navegador por el servidor | Biblioteca `socket.io` |
| WebSocket nativo | `npm run start:nativo` | API `WebSocket` del navegador | Biblioteca `ws` |

Dos servidores ejecutados en puertos distintos mantienen mundos independientes, aunque usen el mismo código.

## 2. Conceptos básicos

### ¿Qué es un socket?

Es un extremo de una comunicación de red. En este proyecto usamos APIs de comunicación persistente para intercambiar mensajes entre navegador y servidor. No debemos confundir el concepto general de socket con la biblioteca Socket.IO.

### ¿Qué es WebSocket?

Es un protocolo de comunicación bidireccional y persistente. Una vez establecida la conexión, cliente y servidor pueden enviar mensajes sin crear una petición HTTP independiente para cada acción.

En la conexión WebSocket habitual sobre HTTP/1.1, el navegador solicita una actualización de protocolo mediante un handshake. Si el servidor la acepta, responde con `101 Switching Protocols`. Después se intercambian tramas WebSocket sobre la conexión TCP.

- `ws://`: WebSocket sin cifrado TLS.
- `wss://`: WebSocket protegido con TLS.
- WebSocket permite mensajes de texto y binarios; OUTPOST utiliza texto JSON.

### ¿Qué es Socket.IO?

Es una biblioteca y un protocolo de aplicación para comunicación en tiempo real. Ofrece eventos con nombre y funciones adicionales, como reconexión automática, acknowledgements y rooms.

Utiliza Engine.IO para gestionar el transporte. Con la configuración habitual puede empezar mediante HTTP long-polling y después actualizar a WebSocket, si está disponible. **El proyecto no fuerza exclusivamente WebSocket en Socket.IO.**

Socket.IO no es simplemente otro nombre para WebSocket: añade su propio formato y comportamiento.

### ¿Qué es HTTP long-polling?

El cliente abre una petición HTTP que el servidor puede mantener pendiente hasta tener información. Tras recibir la respuesta, el cliente abre otra. Permite recibir novedades sin sondear constantemente con peticiones breves, pero no es el mismo mecanismo que una conexión WebSocket.

## 3. Arquitectura del proyecto

```text
Navegador
  Menú, controles, Canvas 2D y audio
                 |
       network.send / network.on
                 |
        Adaptador seleccionado
          /               \
     Socket.IO         WebSocket
          \               /
        Servidor HTTP de Node.js
                 |
       processClientMessage
                 |
      Estado común y reglas
  jugadores, bots, balas, inventarios,
  colisiones, tormenta y preparación
                 |
       sendToClient / broadcast
                 |
       Estado hacia los clientes
```

### Archivos que conviene conocer

| Archivo | Responsabilidad |
| --- | --- |
| [server.js](./server.js) | Servidor HTTP, elección del transporte, admisión, simulación y difusión del estado. |
| [public/js/game.js](./public/js/game.js) | Adaptador cliente, conexión, controles, representación y audio. |
| [public/js/weapon-audio.js](./public/js/weapon-audio.js) | Muestras sintetizadas por arma, voces limitadas y reproducción estéreo; el estado del servidor confirma el tipo de disparo remoto con `ultimoDisparoArma`. |
| [public/js/lobby.js](./public/js/lobby.js) | Preferencias del menú, personaje, reglas y ajustes de sonido. |
| [lib/tactical.js](./lib/tactical.js) | Fases de preparación, balizas, créditos y compras. |
| [public/js/maps.js](./public/js/maps.js) | Catálogo y geometría de Isla Outpost, Estación Orbital y Desierto Ámbar, compartidos entre transportes. Las carpas reutilizan colisiones e interiores, sin puertas que abrir. |
| [public/js/teams.js](./public/js/teams.js) | Balance de humanos y bots entre Azul y Rojo y reglas compartidas para identificar compañeros. El servidor asigna los equipos y cuenta bajas colectivas; no acepta el equipo elegido por un cliente. |
| [lib/map-vote.js](./lib/map-vote.js) | Votación autoritativa del siguiente mapa durante 15 segundos. |
| [lib/navigation.js](./lib/navigation.js) | Rutas de bots por el suelo transitable de la estación, considerando las compuertas como pasos que pueden abrir. |
| [public/js/buildings.js](./public/js/buildings.js) | Geometría y reglas relacionadas con edificios y ocultación. |
| [public/js/zones.js](./public/js/zones.js) | Zonas especiales y sus efectos. |
| [tests/network.test.js](./tests/network.test.js) | Pruebas con conexiones reales en ambos transportes. |
| [tests/combat.test.js](./tests/combat.test.js) | Pruebas de reglas con un entorno de simulación controlado. |
| [playwright.config.js](./playwright.config.js) | Pruebas de navegador para ambos transportes y varias pantallas. |

El servidor usa Express para servir los archivos de `public` y un servidor HTTP creado con `http.createServer(app)`. Sobre ese mismo servidor se monta Socket.IO o `ws`. No hace falta un puerto adicional para el juego.

## 4. Cómo está construido Socket.IO

### En el servidor

Esquema simplificado de la implementación:

```js
const { Server } = require('socket.io');
io = new Server(server);

io.on('connection', socket => {
  const { id } = socket;
  addPlayer(id);

  socket.on('movimiento', data => {
    processClientMessage(id, { type: 'movimiento', data }, socket);
  });

  socket.on('disconnect', () => removePlayer(id));
});
```

En el código real se registran también los eventos de unión, disparo, inventario, preparación, abandono y otros.

1. Socket.IO acepta la conexión y proporciona `socket.id`.
2. Se crea un jugador inicialmente fuera de la sala.
3. Se envían mapa, configuración y estado de sala.
4. Los eventos recibidos se adaptan al formato común `{ type, data }`.
5. El servidor asocia la acción al ID de esa conexión, no a un ID que el cliente diga representar.
6. La desconexión elimina su participación y puede transferir el rol de anfitrión.

### En el navegador

```js
const socket = window.io();
network.send = (type, data) => socket.emit(type, data);
socket.on('estadoJuego', data => network.receive('estadoJuego', data));
```

El cliente carga `/socket.io/socket.io.js` únicamente cuando el servidor indica que está ejecutando esta alternativa.

### Envío individual y difusión

- `socket.emit(type, data)`: envía al cliente asociado a ese socket.
- `io.emit(type, data)`: envía a todos los clientes conectados.
- `socket.on(type, handler)`: registra qué hacer al recibir un evento.

**No confundir:** OUTPOST tiene una sala lógica de juego, pero no utiliza las rooms de Socket.IO mediante `socket.join()`. Actualmente gestiona una sala/mundo por proceso usando sus propias variables.

## 5. Cómo está construido WebSocket nativo

### En el servidor

```js
const { WebSocketServer } = require('ws');
wss = new WebSocketServer({ server });

wss.on('connection', socket => {
  const id = `native-${nextNativePlayerId++}`;
  socket.playerId = id;
  addPlayer(id);

  socket.on('message', rawMessage => {
    const message = JSON.parse(rawMessage.toString());
    processClientMessage(id, message, socket);
  });

  socket.on('close', () => removePlayer(id));
});
```

Este fragmento muestra el recorrido principal; la implementación real incluye un bloque para descartar mensajes que producen errores al procesarse.

La palabra **nativo** se refiere a la API del navegador. En Node.js sí se utiliza una dependencia: `ws`.

### En el navegador

```js
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`${protocol}//${location.host}`);

network.send = (type, data) => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, data }));
  }
};

socket.addEventListener('message', event => {
  const { type, data } = JSON.parse(event.data);
  network.receive(type, data);
});
```

El navegador usa la misma dirección y puerto que la página. Elegir `wss:` al servir mediante HTTPS no configura por sí solo un certificado: el despliegue debe proporcionar TLS, por ejemplo mediante un proxy.

### Formato propio de mensajes

WebSocket no sabe qué significa un evento llamado `movimiento`. OUTPOST define esa convención:

```json
{
  "type": "movimiento",
  "data": {
    "x": 1200,
    "y": 900,
    "angle": 1.2
  }
}
```

`type` identifica la acción y `data` contiene sus datos. Para difundir, el servidor recorre `wss.clients` y envía el mensaje a cada conexión abierta.

### Reconexión

La API WebSocket no reconecta automáticamente. En este cliente, al recibir `close`, se programa otro intento con `setTimeout(connectNetwork, 1500)`.

Es una reconexión básica: no equivale a recuperar automáticamente la identidad anterior ni a una estrategia completa de backoff, heartbeat o recuperación de mensajes.

## 6. El adaptador: por qué las reglas sirven para ambos

Al cargar la página, `connectNetwork()` consulta:

```text
GET /modo
```

El servidor responde `{ "modo": "socket.io" }` o `{ "modo": "nativo" }`. A partir de ahí el cliente asigna la función `network.send`.

El resto del juego puede ejecutar:

```js
network.send('recargar', {});
```

sin saber si debajo se utiliza `emit` o `send`.

En el servidor ocurre lo mismo:

- `processClientMessage(id, message, client)` concentra el tratamiento de acciones.
- `sendToClient(client, type, data)` elige entre `emit` y JSON por WebSocket.
- `broadcast(type, data)` difunde o personaliza los paquetes.

Esto separa **transporte** de **lógica de juego** y reduce la posibilidad de tener reglas diferentes en cada alternativa.

## 7. Diferencias principales

| Aspecto | Socket.IO | WebSocket nativo + `ws` |
| --- | --- | --- |
| Naturaleza | Biblioteca con protocolo propio. | Protocolo estándar y API del navegador; biblioteca `ws` en Node.js. |
| Cliente | Necesita cliente compatible de Socket.IO. | API `WebSocket` incorporada al navegador. |
| Transporte | Puede usar long-polling y actualizar a WebSocket. | Utiliza WebSocket; no trae fallback a long-polling. |
| Mensajes del proyecto | Eventos con nombre y datos mediante `emit`. | Texto JSON con `{ type, data }`. |
| Reconexión | Gestionada por la biblioteca con su configuración predeterminada. | Implementada de forma básica en el cliente del proyecto. |
| ID de conexión | Proporcionado por Socket.IO. | Asignado por el servidor como `native-1`, `native-2`, etc. |
| Difusión | `io.emit`. | Recorrido de `wss.clients`. |
| Rooms y acknowledgements | Funciones disponibles, pero el proyecto no las utiliza. | Se tendrían que diseñar en la aplicación. |
| Heartbeat | Engine.IO incorpora ping/pong para supervisar conexiones. | El protocolo permite ping/pong; el proyecto no configura un heartbeat periódico propio con `ws`. |
| Complejidad | Más funciones resueltas por la biblioteca. | Mayor control, pero más responsabilidades para la aplicación. |
| Coste | Añade formato y lógica de biblioteca. | Menor capa de aplicación, pero JSON, frecuencia y tamaño siguen influyendo. |

**No son compatibles directamente:** un cliente `new WebSocket(...)` no sustituye al cliente Socket.IO. Aunque Socket.IO termine usando WebSocket como transporte, su protocolo de aplicación sigue siendo distinto.

**No hay un ganador automático en rendimiento:** debe medirse con el mismo escenario. Menos capas no garantizan mejores FPS, y un problema de dibujo puede dominar el coste de red.

## 8. Recorrido de una partida

1. El navegador descarga HTML, estilos, imágenes y JavaScript por HTTP.
2. Consulta `/modo` y abre el transporte correspondiente.
3. El servidor crea una identidad de conexión y un jugador no unido.
4. El cliente recibe `configMapa`, `configPartida` y `estadoSala`; en nativo recibe además `identidad`.
5. Al crear o unirse, envía `unirse` con nombre, skin y opciones.
6. El primer participante fija las reglas y se convierte en anfitrión.
7. El anfitrión envía `iniciarSala`; el servidor valida que tenga ese permiso.
8. Se publica `inicioPartida`. La modalidad determina si hay preparación táctica o solo cuenta inicial.
9. Los clientes envían acciones y el servidor publica el estado común.
10. Al alcanzar el límite de bajas o agotarse el tiempo, se publica `finDeJuego`, se reinicia el mundo y se abre una encuesta de 15 segundos para los humanos que terminaron la ronda.
11. El servidor cuenta un voto modificable por conexión durante 15 segundos. Gana la mayoría; en empate o abstención conserva el mapa actual. Al cerrar la encuesta inicia automáticamente otra ronda en el mapa ganador con los participantes conectados que no hayan abandonado. Conserva reglas y personajes, reinicia equipo y bajas y repite la preparación de la modalidad. No incorpora espectadores ni inicia partidas sin humanos.

En **Duelo por equipos**, `estadoSala` anuncia los equipos provisionales; `configPartida` y `estadoJuego` replican el marcador autoritativo en `equipos`. Los proyectiles conservan su equipo de origen para impedir fuego amigo incluso si su propietario se desconecta. Las bajas colectivas no se deducen sumando jugadores presentes, porque se perderían puntos cuando alguien saliera. La siguiente ronda equilibra de nuevo a los participantes y reinicia el marcador.

Los charcos de vida y escudo viajan con sus vértices en `configMapa`. El mismo test de pertenencia al polígono sirve al servidor y al cliente, pero solo el servidor modifica salud y escudo, a 10 puntos por segundo y con límite de 100. El cliente dibuja el charco y el estado recibido: no envía mensajes para concederse curación.

En duelo por equipos la primera derrota deja al jugador `abatido`, con un plazo de 20 segundos y sin conceder una baja todavía. Para rescatarlo, el cliente envía `reanimar: {activo: true}` mientras se mantiene la interacción, y `{activo: false}` al soltar. Ambos transportes pasan por el mismo despachador. El servidor comprueba equipo, distancia, línea libre, continuidad de los mensajes y tres segundos reales transcurridos; el cliente no decide la salud ni el progreso. Una concesión de entrada de 350 ms tolera pequeños retrasos pero cancela si se corta la conexión. `estadoJuego` replica el abatimiento y el progreso. Reanimar devuelve exactamente 25 de vida y cero escudo; rematar, desangrarse o quedar todo el equipo abatido conduce a la muerte y reaparición normales.

### Eventos que conviene memorizar

| Dirección | Eventos | Uso |
| --- | --- | --- |
| Cliente → servidor | `unirse`, `iniciarSala`, `cerrarSala` | Gestión de participantes y comienzo. |
| Cliente → servidor | `movimiento`, `disparar`, `recargar` | Acciones de combate. |
| Cliente → servidor | `cambiarSlot`, `intercambiar`, `tirarItem`, `lanzarGranada` | Inventario e interacción. |
| Cliente → servidor | `moverEntrenamiento`, `comprarEquipo` | Preparación táctica. |
| Cliente → servidor | `abandonarPartida` | Regresar al menú manteniendo la conexión. |
| Cliente → servidor | `votarMapa` | Elegir el mapa para la siguiente sala, si se tiene permiso. |
| Cliente → servidor | `sondaRed` | Enviar una secuencia para medir RTT de aplicación. |
| Servidor → cliente | `respuestaRed` | Devolver la secuencia validada, sin aceptar tiempos del cliente. |
| Servidor → cliente | `configMapa`, `configPartida`, `estadoSala` | Configuración y participantes. |
| Servidor → cliente | `inicioPartida`, `estadoJuego`, `tiempoPartida` | Inicio, snapshots y reloj. |
| Servidor → cliente | `kill`, `explosion`, `zonaActualizada` | Notificaciones y cambios del mundo. |
| Servidor → cliente | `entradaRechazada`, `salidaPartida` | Resultado de admisión o salida. |
| Servidor → cliente | `finDeJuego`, `reinicioPartida` | Resultados y nueva ronda. |
| Servidor → cliente | `estadoVotacion`, `votoRechazado` | Tiempo, recuento y ganador de la encuesta, o motivo del rechazo. |

El panel de red calcula el RTT con el reloj monotónico del navegador. Una sonda por segundo queda pendiente como máximo tres segundos; el porcentaje usa las últimas treinta sondas completadas o vencidas. No mide la pérdida de paquetes TCP: las retransmisiones pueden aparecer como latencia o respuestas tardías. La subida y bajada son una estimación del volumen de mensajes JSON UTF-8 por segundo, no de la capacidad máxima de Internet. Ocultar la pestaña pausa las sondas y reinicia la muestra al volver.

Cada entrada del array de `finDeJuego` incluye `estadisticas`, calculadas por el servidor: daño efectivo, proyectiles, impactos, vida recuperada, reanimaciones y muertes. El resultado copia los contadores antes de reiniciar el mundo; reaparecer no los borra. La precisión se obtiene de impactos/proyectiles de armas de fuego, contando cada perdigón y excluyendo granadas y puños. El cliente solo presenta estos datos, no decide los totales.

## 9. Simulación, sincronización y límites reales

### Servidor autoritativo, pero no un antitrampas completo

El servidor mantiene vida, escudo, inventario, recargas, proyectiles, bots y puntuaciones. Calcula impactos, daño, reapariciones, compras y final de ronda.

Sin embargo, hay que explicar con precisión las limitaciones:

- El cliente manda coordenadas de movimiento, no solamente intenciones.
- El servidor aplica límites del mapa y colisiones. La limitación de desplazamiento por tiempo está aplicada específicamente cuando hay una reducción de velocidad, no como control universal para todo movimiento.
- El disparo recibe coordenadas del cliente; que el servidor valide arma, munición y cadencia no significa que valide por completo el origen comunicado.
- No existe un sistema de autenticación de cuentas.

Por tanto, es correcto hablar de servidor autoritativo para las reglas centrales, pero no de protección total frente a clientes modificados.

### Tick y FPS

El servidor tiene `TICK_RATE = 30`: intenta actualizar y publicar el estado aproximadamente cada **33,3 ms** mediante `setInterval`.

El navegador dibuja con `requestAnimationFrame`. Sus FPS dependen del monitor, la carga, el navegador y la GPU, no de que el servidor tenga 30 ticks.

Los temporizadores de JavaScript no garantizan tiempo real estricto. Si el proceso se satura, los callbacks pueden retrasarse.

### Predicción local y corrección

El cliente actualiza `player.x` y `player.y` según controles y tiempo entre fotogramas, envía sus coordenadas y recibe el estado del servidor. Este estado también corrige la réplica local.

No hay un sistema avanzado de interpolación de snapshots para todos los jugadores, historial de entradas con números de secuencia ni lag compensation con rebobinado del servidor. La predicción existente es básica y no debe presentarse como una solución completa.

### Estado privado de preparación

Durante las fases tácticas, `broadcast` personaliza `estadoJuego` e `inicioPartida` con el snapshot de preparación de cada conexión. Antes del combate, el objeto de jugadores de esos paquetes se reduce al jugador correspondiente, si existe.

Esto evita enviar a cada participante el progreso privado de los demás. No significa que todo el protocolo sea privado: `estadoSala`, por ejemplo, contiene la lista de participantes.

## 10. Abandono, regreso y desconexión

### Salir al menú

`abandonarPartida` no cierra el socket. Retira al jugador activo, elimina sus proyectiles y conserva su estado de regreso en `jugadoresAusentes` si la ronda sigue viva.

Si quedan humanos, continúa la ronda y puede transferirse el rol de anfitrión. Si no queda ninguno, se cancela y se limpia el mundo.

### Volver a la partida

El menú muestra **Volver a la partida** a la conexión que ya participó y salió mediante el botón. El servidor restaura su jugador y, cuando existe, su cuenta de preparación. Envía el reloj y la fase actuales; no reinicia la ronda.

Cambiarse el nombre no concede permiso: se comprueba el ID de la conexión. Un jugador nuevo sigue sin poder entrar durante el combate.

### Recargar o perder la conexión no es lo mismo

Recargar, cerrar la página o una desconexión real puede generar una identidad nueva. No hay un token persistente que recupere al participante anterior. La reconexión del transporte no equivale a restauración de sesión.

En un jugador, salir retira al último humano y cancela la ronda; después puede crearse otra, no recuperar la ya cancelada.

## 11. Preguntas que puede hacer el profesor y respuestas

### Conceptos y construcción

**1. ¿Por qué utilizar sockets en un videojuego en red?**  
Porque ambos extremos necesitan enviar novedades continuamente: acciones desde el cliente y cambios del mundo desde el servidor. Una comunicación persistente evita modelar cada actualización como una consulta HTTP convencional.

**2. ¿Se envía un vídeo del juego por la red?**  
No. Se envían datos, como posiciones, vida, inventarios y proyectiles. Cada navegador dibuja su propia imagen con Canvas 2D.

**3. ¿Los dos sockets funcionan a la vez?**  
No. Son dos alternativas de ejecución seleccionadas con el argumento `--nativo`. Comparten reglas, no una partida entre procesos diferentes.

**4. ¿Qué cambia al pasar a modo nativo?**  
Cambian el establecimiento de conexión, la identidad y la forma de enviar y recibir mensajes. La simulación y los manejadores comunes permanecen.

**5. ¿Por qué se usa `ws` si el modo se llama nativo?**  
Porque el cliente usa la API nativa del navegador; el servidor Node.js utiliza `ws` para aceptar esas conexiones.

**6. ¿Puedo conectar un cliente WebSocket cualquiera a Socket.IO?**  
No directamente. Socket.IO añade su protocolo, de modo que ambos extremos deben entenderlo.

**7. ¿Qué significa full-duplex?**  
Que ambos extremos pueden enviar información de forma independiente, sin esperar una petición del otro para cada mensaje.

**8. ¿Qué es serializar?**  
Convertir los datos a un formato transmisible. En el modo nativo usamos `JSON.stringify`; al recibir, `JSON.parse` reconstruye los datos.

**9. ¿Por qué JSON?**  
Es sencillo de inspeccionar, interoperable y adecuado para un proyecto didáctico. Como desventaja, suele ocupar más que un formato binario diseñado para estos datos.

**10. ¿Qué diferencia hay entre `emit` y `send` aquí?**  
`emit` transmite un evento de Socket.IO; `send` transmite un mensaje WebSocket. Nuestro adaptador convierte ambos al mismo concepto de evento del juego.

### Arquitectura y reglas

**11. ¿Es peer-to-peer?**  
No. Los jugadores se conectan al servidor central. No intercambian directamente entre sí el estado de combate.

**12. ¿El anfitrión es el servidor?**  
No. Es un jugador con permiso para fijar reglas e iniciar la sala. El servidor Node.js sigue funcionando aunque ese jugador salga.

**13. ¿Quién decide si un disparo acierta?**  
El servidor simula el proyectil y comprueba obstáculos e impactos. El cliente solicita disparar y representa el resultado recibido.

**14. ¿Cómo evitan que alguien dispare demasiado rápido?**  
El servidor compara el tiempo del último disparo con el cooldown del arma y verifica recarga y munición. El cliente tiene comprobaciones similares para dar respuesta visual, pero no son la autoridad.

**15. ¿El juego es imposible de hackear por tener servidor autoritativo?**  
No. Hay validaciones centrales, pero todavía se aceptan coordenadas del cliente con controles incompletos. Un diseño más robusto enviaría entradas y calcularía el desplazamiento permitido en el servidor.

**16. ¿Por qué la IA de los bots se ejecuta en el servidor?**  
Para que todos vean las mismas decisiones y resultados. Si cada navegador simulara su propia IA, los mundos podrían divergir.

**17. ¿Los bots requieren un socket cada uno?**  
No. Son entidades dentro del estado del servidor. No necesitan un navegador ni una conexión propia.

**18. ¿Cómo se evita que un invitado cambie las reglas?**  
Las opciones se fijan al crear la sala y los permisos de inicio y cierre se verifican con el ID del anfitrión.

**19. ¿Cómo se sincronizan las fases de puzzles y combate?**  
El servidor calcula las fases usando tiempos comunes y envía a cada cliente la fase vigente y el tiempo restante. El navegador no decide cuándo comienza el combate.

**20. ¿Dónde se guardan las partidas?**  
En memoria del proceso. No hay base de datos de partidas; reiniciar el servidor pierde ese estado. Las preferencias locales del menú son otra cosa y se guardan en el navegador.

### Latencia y rendimiento

**21. ¿Qué es la latencia?**  
El tiempo que tarda la información en viajar. El RTT es el viaje de ida y vuelta; no debe confundirse con latencia de una sola dirección.

**22. ¿Qué es jitter?**  
La variación de los tiempos de llegada. Incluso con un RTT medio aceptable, actualizaciones que llegan irregularmente pueden producir tirones.

**23. ¿Tener 30 ticks significa tener 30 FPS?**  
No. Los ticks corresponden a la simulación del servidor; los FPS, al dibujo del cliente. Son relojes distintos.

**24. ¿Los 30 ticks están garantizados?**  
No. Son una frecuencia objetivo. `setInterval` puede retrasarse por carga del proceso o bloqueos del event loop.

**25. ¿Por qué no enviar todo a 120 veces por segundo?**  
Subir la frecuencia aumenta CPU, serialización y ancho de banda. Hay que equilibrar respuesta, coste y capacidad de los clientes; más mensajes no garantizan más fluidez.

**26. ¿Qué es interpolación?**  
Dibujar estados intermedios entre snapshots para suavizar movimiento remoto. Normalmente utiliza un pequeño retraso de representación. No hay un sistema avanzado de ese tipo implementado aquí.

**27. ¿Qué es predicción y qué es reconciliación?**  
Predicción es anticipar localmente el efecto de la entrada; reconciliación es corregirlo según la autoridad. El proyecto tiene una anticipación básica, no una reconciliación completa con historial y reejecución de comandos.

**28. ¿Qué es lag compensation?**  
Compensar retrasos al evaluar acciones, por ejemplo consultando posiciones históricas para un disparo. OUTPOST no implementa ese rebobinado.

**29. ¿WebSocket usa UDP?**  
No en esta implementación: utiliza TCP. Socket.IO tampoco convierte el juego en UDP; aquí usa sus transportes HTTP/WebSocket sobre conexiones fiables.

**30. ¿Qué ventaja y desventaja tiene TCP?**  
Entrega bytes en orden y retransmite pérdidas, lo que simplifica la comunicación. Pero una pérdida puede retrasar datos posteriores: una actualización vieja puede bloquear novedades hasta recuperarse.

**31. ¿TCP garantiza que el jugador ejecutó una acción?**  
No. Entregar bytes no demuestra que la aplicación procesara la acción. Para confirmación de negocio hacen falta respuestas o acknowledgements y una política de reintentos e idempotencia.

**32. ¿Socket.IO es siempre más lento?**  
No puede afirmarse sin medir. Añade mecanismos, pero la diferencia real depende de los mensajes, transporte activo, CPU, red y renderizado.

**33. ¿Por qué Chrome puede ir peor que Firefox?**  
Por diferencias de Canvas, aceleración gráfica, controladores, extensiones o ahorro de energía. No prueba por sí solo un problema de sockets. En el proyecto se evita dibujar entidades fuera de cámara y reconstruir el marcador si no cambia.

**34. ¿Cómo distinguir problemas de red y de dibujo?**  
Medir tiempos de llegada de mensajes y RTT por un lado, y duración de fotogramas y tareas en DevTools por otro. FPS bajos con actualizaciones regulares apuntan al cliente; retrasos de mensajes requieren investigar red o servidor.

**35. ¿Cuánto ancho de banda consume?**  
Debe medirse. Una estimación del tráfico saliente del servidor es: tamaño medio del snapshot × envíos por segundo × clientes receptores. Hay que sumar entrada, eventos y overhead. No tenemos un valor fijo certificado.

### Desconexiones, seguridad y crecimiento

**36. ¿Qué pasa si el anfitrión abandona?**  
Otro humano activo recibe el rol. Si queda alguien, la ronda continúa; no depende del navegador del anfitrión para simularse.

**37. ¿Salir al menú desconecta el socket?**  
No. Permite conservar la identidad de conexión y regresar mientras esa ronda siga activa.

**38. ¿Puedo volver después de recargar?**  
Actualmente no hay recuperación persistente de identidad. El permiso de regreso funciona con la misma conexión, no con el nombre escrito.

**39. ¿Qué ocurre si todos salen?**  
Se cancela la ronda, se limpia el mundo y se borran los permisos de regreso.

**40. ¿Qué es un heartbeat?**  
Un intercambio periódico para detectar conexiones que dejaron de responder. Engine.IO lo gestiona; el modo nativo no configura un ciclo propio equivalente de ping/pong del protocolo. Ambos modos tienen además las sondas de aplicación `sondaRed`/`respuestaRed` para el panel de latencia; estas no cierran conexiones ni sustituyen el heartbeat de transporte.

**41. ¿Se pueden conectar cientos de jugadores directamente?**  
No hay una capacidad medida que permita afirmarlo. Se transmite bastante estado a cada cliente y se simulan entidades en un proceso. Hay que realizar pruebas de carga antes de fijar un máximo.

**42. ¿Cómo mejorarías la escalabilidad?**  
Separando partidas, enviando solo entidades relevantes, reduciendo datos repetidos, midiendo CPU y tráfico, y distribuyendo mundos entre procesos. Esto sería trabajo futuro, no una función existente.

**43. ¿Cambiar a binario resolvería todos los problemas?**  
No. Puede reducir tamaño y coste de parseo, pero no corrige una mala frecuencia de envío, cálculos excesivos, latencia o dibujo costoso.

**44. ¿Qué harías para un despliegue público?**  
Añadir TLS, autenticación, validación de esquemas y tamaños, límites de frecuencia, comprobación de orígenes, supervisión de conexiones y mejores validaciones de movimiento/disparo. También registros y pruebas de carga.

**45. ¿Por qué no confiar en el ID que envía el cliente?**  
Porque podría intentar actuar como otro usuario. El manejador toma la identidad del socket aceptado por el servidor. Aun así, una identidad de conexión no equivale a una cuenta autenticada.

**46. ¿Qué pasa con un JSON malformado?**  
En nativo se intenta parsearlo y procesarlo dentro de un `try/catch`. La implementación evita que ese error interrumpa el servidor, pero ese manejo no sustituye a validar el esquema y registrar errores de manera específica.

**47. ¿Cómo comprobaron que los transportes respetan las mismas reglas?**  
Hay pruebas de red que arrancan el servidor con y sin `--nativo` y comprueban admisión, anfitrión, salida y regreso. Playwright prueba además la interfaz con ambos transportes. Esto no sustituye pruebas de carga ni todas las condiciones reales de red.

**48. ¿Qué limitación mencionarías honestamente en la defensa?**  
Que es una implementación didáctica funcional con una sala por proceso, estado en memoria, predicción básica y validaciones mejorables. La separación entre transporte y reglas facilita evolucionarla sin duplicar la simulación.

## 12. Demostración sugerida para la exposición

1. Arranca `npm start` y abre dos ventanas. Enseña la etiqueta **SOCKET.IO**.
2. Crea una sala, une al segundo jugador e inicia la ronda.
3. Explica que ambos reciben el mundo común, aunque cada uno tenga su propia cámara.
4. Sal con el primer jugador: muestra que el segundo continúa.
5. Pulsa **Volver a la partida**: muestra que regresas sin reiniciar.
6. Abre otra ventana e intenta entrar durante la ronda: el jugador nuevo no tiene permiso.
7. Detén el proceso y arranca `npm run start:nativo`. Repite la demostración y muestra **WEBSOCKET NATIVO**.
8. En DevTools → Network, explica la diferencia entre eventos Socket.IO y el JSON de la conexión WebSocket nativa. En Socket.IO identifica el transporte realmente negociado; no supongas que siempre es WebSocket.

Para varios dispositivos, todos deben usar la misma IP y puerto del servidor y una red que permita esa conexión. `localhost` en un móvil apunta al propio móvil.

## 13. Resumen para memorizar

> Tenemos dos alternativas de comunicación: Socket.IO ofrece eventos y gestión de conexión; WebSocket nativo utiliza una API estándar y un protocolo JSON definido por nosotros. Un adaptador permite compartir las reglas. El servidor mantiene el mundo y el combate, mientras el navegador interpreta entradas y dibuja. La simulación intenta avanzar a 30 ticks por segundo, independientemente de los FPS. Salir al menú conserva la conexión para volver, pero reconectar después de recargar no recupera una sesión persistente. Las mejoras futuras son mayor validación, sincronización avanzada y pruebas de capacidad.
