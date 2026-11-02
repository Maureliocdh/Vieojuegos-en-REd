<div align="center">

# OUTPOST
### Arena multijugador en tiempo real

**Explora. Equípate. Entra en los edificios. Sobrevive a la tormenta.**

JavaScript · Canvas 2D · Node.js · Socket.IO · WebSocket

[Arranque rápido](#arranque-rápido) · [Jugar desde el móvil](#jugar-desde-el-móvil) · [Controles](#controles) · [Pruebas](#pruebas)

</div>

---

## La Arena

OUTPOST es un juego de acción con vista cenital inspirado en el formato de ZombsRoyale. Es una arena de **todos contra todos con reapariciones**: gana quien alcance el límite de bajas o lidere el marcador cuando se agote el tiempo. No es una partida de eliminación permanente.

Comparte una partida con otros navegadores y dispositivos. El servidor mantiene el estado común de jugadores, bots, botín, munición, puertas, proyectiles y zona segura; cada cliente dibuja ese estado con su propia cámara.

| En la arena | Qué encontrarás |
| :--- | :--- |
| Operadores | Seis skins originales: Pulse, Ronin, Nova, Viper, Glitch y Tide. |
| Mapa | Terreno texturizado, caminos, árboles, rocas y edificios con interiores. |
| Edificios | Puertas interactivas y techos que se vuelven transparentes al entrar. |
| Arsenal | Puños, pistola, rifle, sniper, escopeta y granadas. |
| Suministros | Botiquines, pociones de escudo y cajas de munición por tipo de arma. |
| Tormenta | Zona segura que se reduce durante la partida y daña a quienes quedan fuera. |
| Sonido | Volumen general, efectos, ambiente y silencio; ajustes guardados en el navegador. |
| Música del menú | Ambientación espacial original sintetizada, con acordes suaves y graves sostenidos. Se controla con el volumen de ambiente. |
| Móvil | Joystick de movimiento, joystick de apuntado y disparo, e inventario táctil. |

## Arranque Rápido

### 1. Requisitos

- Node.js 22 o 24 LTS y npm.
- Un navegador moderno con Canvas 2D, WebSocket y Web Audio.
- Una terminal situada en la carpeta que contiene `package.json` y `server.js`.

Comprueba las herramientas:

```powershell
node --version
npm --version
```

Si abriste la carpeta superior `red`, entra primero al proyecto:

```powershell
cd .\Vieojuegos-en-REd
```

### 2. Instalar Dependencias

```powershell
npm ci
```

### 3. Encender el Servicio

```powershell
npm start
```

Abre **http://localhost:3000**. Mantén la terminal abierta mientras juegas.

> No abras directamente `public/index.html`: el juego necesita el servidor HTTP y la conexión de red.

### 4. Detener o Reiniciar

Pulsa **Ctrl+C** en la terminal del servidor para detenerlo. Ejecuta de nuevo `npm start` para reiniciarlo.

El estado de la partida vive en memoria: reiniciar el proceso elimina la ronda actual. Los ajustes personales guardados en el navegador se conservan.

## Dos Modos de Red

| Modo | Comando | Transporte |
| :--- | :--- | :--- |
| Predeterminado | `npm start` | Socket.IO |
| Nativo | `npm run start:nativo` | WebSocket con `ws` |

El cliente consulta `/modo` y elige automáticamente el adaptador correcto. No necesitas modificar el HTML para cambiar de modo.

**Los dos modos usan las mismas reglas, pero son alternativas de ejecución.** Dos procesos en puertos distintos tienen partidas independientes; para jugar juntos hay que conectarse a la misma dirección y puerto.

### Cambiar el Puerto en PowerShell

```powershell
$env:PORT = "3001"
npm run start:nativo
```

Abre **http://localhost:3001**. Para volver al puerto predeterminado, detén el servidor y ejecuta:

```powershell
Remove-Item Env:PORT -ErrorAction SilentlyContinue
npm start
```

## Jugar Desde el Móvil

1. Conecta el ordenador y el móvil a la **misma red Wi-Fi**.
2. Arranca el servidor en el ordenador.
3. Ejecuta `ipconfig` y busca la dirección IPv4 del adaptador Wi-Fi o Ethernet activo.
4. En el móvil, abre `http://IP_DEL_ORDENADOR:3000`. Por ejemplo: `http://192.168.1.50:3000`.
5. Si Windows pregunta por el acceso de Node.js a la red, permite únicamente la red privada de confianza.

> En el móvil, `localhost` se refiere al propio teléfono, no al ordenador que ejecuta el juego.

Si no conecta, comprueba el puerto, el firewall y que el router no tenga aislamiento de clientes. No hace falta abrir puertos del router para jugar dentro de la red local.

La interfaz admite orientación vertical y horizontal. Las pruebas automatizadas emulan pantallas de **390×844**, **320×568** y **844×390**; no sustituyen las comprobaciones en un teléfono físico, especialmente para audio, rendimiento y permisos de red.

## Preparar una Partida

Selecciona una pestaña antes de crear la sala:

| Modalidad | Preparación | Acceso |
| :--- | :--- | :--- |
| Clásico | Cuenta de cuatro segundos y combate Arena habitual. | Multijugador. |
| Con puzzles | 5 s de instrucciones, 60 s de balizas, 20 s de compras, cuenta de cuatro segundos y combate Arena. | Multijugador. |
| Un jugador | Arena clásica con la cantidad de bots elegida. | Sala exclusiva, sin invitados. |

Los invitados heredan la modalidad elegida por el anfitrión y pueden personalizar su nombre y personaje. El tiempo máximo configurado corresponde al combate; no consume los segundos de puzzles, tienda ni cuenta inicial.

En **Con puzzles**, cada jugador entra solo a una cámara de entrenamiento de 1000×700, con nueve balizas aleatorias separadas por sectores. Primero aparecen las instrucciones y una cuenta sincronizada de cinco segundos: durante ella se muestra la sala con las balizas apagadas y el movimiento bloqueado. Al terminar empieza el minuto completo de entrenamiento. Se ilumina una baliza a la vez durante seis segundos. Se camina con WASD o los botones direccionales de pantalla; acercarse a una baliza encendida recoge automáticamente su energía y otorga cinco créditos. Después de recogerla o de que expire, hay una pausa de 0,4 segundos antes de la siguiente activación. No hay daño ni penalización por dejar pasar energía.

Todos reciben 80 créditos base y pueden ganar hasta 100 adicionales. La fase dura un minuto para todos; luego pasan juntos a la tienda. El servidor calcula movimiento, activaciones y recogidas. Cada cliente recibe solo las posiciones de sus propias balizas, su posición y su saldo; los puntos de los demás no se envían durante la preparación. El mapa de combate permanece congelado y las posiciones del entrenamiento no cambian el lugar de aparición en la arena.

La tienda ofrece escopeta (80), rifle (100), sniper (140), escudo inicial +50 (40), botiquín (30) y 24 balas de reserva de pistola (20). Cada suministro se compra una vez, excepto la munición, que admite dos compras. El servidor valida las respuestas, el saldo, los límites y el espacio de inventario. Los bots disponen de un presupuesto intermedio de 100 créditos y compran un rifle. El botín del mapa se conserva; al morir se pierde el equipo comprado y se reaparece con la pistola habitual. Los créditos sobrantes no pasan al combate ni a otras rondas.

1. Elige un operador y escribe tu nombre.
2. Selecciona las **bajas para ganar**: 5, 10, 20 o 30.
3. Selecciona el **tiempo máximo**: 1, 2, 3 o 5 minutos.
   Elige también la cantidad y la **dificultad de los bots**: Fácil (más lentos, disparan de cerca, con pausas y menor puntería), Normal (comportamiento habitual) o Difícil (más rápidos y atacan desde más lejos). La dificultad se guarda en el navegador; en multijugador manda la selección del anfitrión.
4. Ajusta el sonido desde el botón de configuración.
5. Pulsa **Crear sala**. El primer participante será el anfitrión y fijará las reglas.
6. Los demás abren la misma dirección, personalizan su personaje, escriben su nombre y pulsan **Unirse a la sala**.
7. Todos ven la lista de participantes. Cuando estén los jugadores deseados, el anfitrión pulsa **Iniciar partida**.

La sala se cierra al comenzar la ronda: no se admiten participantes nuevos durante la partida. El combate empieza tras una preparación de cuatro segundos; durante ella, jugadores, bots y temporizadores permanecen detenidos. Si el anfitrión se desconecta o recarga, el rol pasa a otro participante. Antes de comenzar, el anfitrión puede deshacer la sala y devolver a todos a la pantalla principal.

La arena incluye once bots por defecto. Tras una eliminación, reapareces a los tres segundos. Al finalizar se muestra la clasificación completa y se destacan los tres primeros puestos. Cada jugador conserva sus resultados hasta pulsar **Volver al inicio**, desde donde puede crear una nueva sala o unirse a otra.

El botón de **abandonar partida** (icono de salida, junto al sonido) te devuelve al menú en cualquier modalidad, incluida la sala de espera, las balizas, la tienda y la cuenta inicial. Solo sale quien lo pulsa: si quedan jugadores humanos, la ronda continúa sin reiniciarse y el anfitrión se releva cuando corresponde. Desde el menú puedes pulsar **Volver a la partida** para regresar a esa misma ronda, conservando personaje, posición, salud, equipo, bajas y progreso de preparación. La fase y el reloj siguen avanzando mientras estás fuera. Este permiso pertenece a la conexión que participó, no al nombre: funciona con Socket.IO y WebSocket nativo mientras no recargues ni cierres la página, y no permite entrar a jugadores nuevos. Si sale el último humano, la ronda se cancela, se borra el permiso de regreso y queda disponible una nueva sala.

## Controles

### Ordenador

| Acción | Control |
| :--- | :--- |
| Moverse | `W`, `A`, `S`, `D` |
| Apuntar | Ratón |
| Disparar, golpear o usar el consumible equipado | Clic izquierdo; mantener pulsado para disparar armas continuamente |
| Seleccionar hueco de inventario | `1` a `5` |
| Abrir o cerrar una puerta cercana | `E` |
| Intercambiar con una plataforma, si no hay una puerta cercana | `E` |
| Recargar | `R` |
| Soltar el objeto equipado | `G` |
| Lanzar una granada del inventario | `F` |

### Móvil

| Acción | Control |
| :--- | :--- |
| Moverse | Joystick izquierdo |
| Apuntar y disparar | Mantener desplazado el joystick derecho |
| Equipar objeto | Tocar su hueco del inventario |
| Recargar | Botón de flecha circular |
| Soltar objeto | Botón de caja abierta; desactivado con los puños |
| Lanzar granada | Botón de círculo con punto central |
| Usar botiquín o escudo | Equiparlo y desplazar el joystick derecho |
| Abrir o cerrar puerta | Botón de dos flechas opuestas cuando estás cerca |
| Intercambiar en una plataforma | Botón de dos flechas opuestas si no hay una puerta cercana |
| Cambiar sonido | Botón de ajustes de la esquina superior |

En computadora, el botón de ajustes también se abre con un clic. Cerca de una puerta aparece **Abrir puerta [E]** o **Cerrar puerta [E]**. Las manos adoptan los colores de la skin y giran con el apuntado; con los puños seleccionados aparece **PUÑOS EQUIPADOS**.

### Daño de la Tormenta

Fuera del círculo seguro, la tormenta quita vida directamente una vez por segundo, sin consumir escudo. No afecta a jugadores en el menú.

| Reducción | Inicio desde que empieza la ronda | Daño por segundo |
| :--- | :--- | ---: |
| Primera | 20 segundos | 1 |
| Segunda | 45 segundos | 2 |
| Tercera | 70 segundos | 3 |
| Cuarta | 95 segundos | 4 |
| Quinta y posteriores | Desde 120 segundos | 5 como máximo |

La progresión se reinicia en cada ronda. Antes de la primera reducción no hay daño. Las rondas cortas pueden terminar antes de alcanzar las últimas fases.

## Armas y Munición

### Arbustos

Puedes entrar en los arbustos para esconderte. Desde dentro, el follaje se muestra al 25 % de opacidad; desde fuera, otros jugadores no ven tu personaje, arma, nombre, barras ni marca del minimapa. Quienes estén dentro del mismo arbusto pueden verse entre sí. Los bots tampoco detectan objetivos ocultos desde fuera.

Los arbustos no bloquean el movimiento ni las balas: puedes disparar desde dentro y los demás verán los proyectiles sin que tu personaje se revele. No ofrecen protección contra disparos ni contra la tormenta. Esta ocultación se aplica al renderizado y a la selección de objetivos de los bots; no es una protección antitrampas contra clientes modificados que inspeccionen el estado de red.

En el menú puedes elegir **0, 5, 11, 15 o 20 bots** (11 por defecto). La preferencia se guarda en el navegador. Quien inicia la ronda fija la cantidad para todos; el selector queda bloqueado hasta la siguiente ronda. Con 0 bots solo participan jugadores humanos.

Las armas disparan mientras mantienes pulsado el clic izquierdo o desplazado el joystick derecho, respetando su cadencia. Solo el rifle dispara rápido: **3 disparos por segundo**. La pistola tiene una pausa de **0,65 s** entre disparos; la escopeta, **1,2 s**; y el sniper, **1,4 s**. Soltar el botón detiene el disparo. La recarga sigue siendo manual.

Al entrar y en cada reaparición recibes **una pistola base equipada, 12 balas en el cargador y 24 de reserva**. Conservas los puños en el primer hueco.

### Cofres y Rarezas

Los edificios contienen cofres que se abren con **E** en computadora o con el botón **Abrir cofre** en móvil. Cada cofre entrega un arma aleatoria, balas compatibles y un botiquín o una poción de escudo. Solo puede abrirse una vez por ronda y su estado es compartido entre jugadores.

También hay armas adicionales junto a los puntos de suministros y dentro de los edificios.

| Rareza | Color en inventario y suelo | Multiplicador de daño |
| :--- | :--- | ---: |
| Base | Azul | 1 |
| Épica | Morado | 1,0015 |
| Legendaria | Dorado | 1,003 |

El incremento es **0,15 % del daño base por nivel**: épica +0,15 % y legendaria +0,30 %. La munición es compartida por tipo de arma, independientemente de su rareza. Recoger un arma repetida suma sus balas y conserva la mayor rareza de las dos. El borde blanco exterior identifica el hueco equipado.

| Arma | Cargador | Daño por proyectil | Recarga |
| :--- | ---: | ---: | ---: |
| Pistola | 12 | 15 | 1,2 s |
| Rifle | 30 | 25 | 1,5 s |
| Sniper | 5 | 65 | 2,2 s |
| Escopeta | 6 | 10 × 3 perdigones | 1,8 s |

- Cada arma utiliza su **propia reserva acumulable**. Las cajas del mapa no ocupan huecos de inventario.
- El indicador muestra **balas en el cargador / balas de reserva**.
- Recargar transfiere solo las balas disponibles: sin reserva no hay recarga.
- Excepción: solo los bots tienen reservas ilimitadas. Respetan el cargador, la cadencia y el tiempo de recarga; su botín entrega únicamente cantidades finitas.
- Recoger un arma que ya tienes suma su munición a la reserva, sin duplicar el arma en el inventario.
- Soltar e intercambiar conservan las balas reales del cargador: no lo rellenan gratis.
- Al eliminar a alguien, recibes las balas compatibles con las armas que llevas. El resto queda como botín.
- Los puños no se pueden tirar ni intercambiar.

Los botiquines recuperan hasta 50 de vida; las pociones aportan hasta 50 de escudo. La vida y el escudo están limitados a 100. Las granadas causan daño de área, incluido al propio lanzador.

## Pruebas

### Reglas y Multijugador

```powershell
npm test
```

Incluye puertas, colisiones, protección de puños, reservas finitas, transferencia de munición y dos clientes reales en cada modo de transporte.

### Navegador y Móvil

Instala Chromium de pruebas una vez:

```powershell
npx playwright install chromium
```

Ejecuta la validación visual y táctil:

```powershell
npm run test:browser
```

Playwright arranca sus propios servidores en los puertos **3410 y 3411**; deben estar libres. Valida escritorio y móvil, selección de skins, ajustes de sonido, reglas de ronda, carga de imágenes, separación del HUD y píxeles del efecto de tormenta. Las capturas se guardan en `test-results/`.

Para repetir un caso:

```powershell
npm run test:browser -- --project=socketio-mobile
```

## Estructura

```text
Vieojuegos-en-REd/
├── server.js                 # Simulación y adaptadores de red
├── package.json              # Dependencias y comandos
├── playwright.config.js     # Matriz de pruebas de navegador
├── public/
│   ├── index.html            # Menú, HUD y controles
│   ├── css/style.css         # Estilos y adaptación móvil
│   ├── js/
│   │   ├── game.js           # Cliente, audio, entrada y renderizado
│   │   ├── lobby.js          # Preferencias y selección de skins
│   │   ├── assets.js         # Catálogo de sprites originales
│   │   ├── buildings.js      # Geometría compartida de edificios
│   │   └── world.js          # Terreno, interiores y techos
│   └── assets/              # Recursos gráficos existentes y texturas
└── tests/                   # Reglas, conexiones y navegador
```

## Solución de Problemas

| Síntoma | Qué comprobar |
| :--- | :--- |
| `EADDRINUSE` | Ya hay un proceso en ese puerto. Detén tu servidor anterior o elige otro puerto. |
| El móvil no conecta | Misma Wi-Fi, IP correcta, puerto correcto y acceso permitido en la red privada. |
| Dos jugadores no se ven | Deben usar la misma dirección y puerto, no dos procesos distintos. |
| No suena nada | Pulsa Jugar, revisa el silencio y los tres volúmenes. El navegador puede bloquear audio antes de una interacción. |
| No recarga | Comprueba la reserva del tipo de arma equipado. |
| No se cierra una puerta | Una entidad está ocupando el hueco; aléjate para no quedar atrapado. |
| El juego muestra una versión anterior | Reinicia el servidor tras cambiar código de servidor y recarga la página con `Ctrl+F5`. |
| Falla Playwright | Instala Chromium y comprueba que 3410 y 3411 estén libres. |

La música del menú empieza tras el primer clic, toque o pulsación de tecla, por las restricciones de reproducción automática del navegador. Se detiene al entrar en una sala, jugar, ver resultados u ocultar la pestaña, y vuelve al regresar al menú. Respeta **Volumen general**, **Ambiente** y **Silenciar todo**; no descarga música externa ni reproduce melodías de Halo.

### Chrome va lento pero Firefox no

Puede deberse a diferencias de Canvas 2D, aceleración gráfica, controladores, extensiones o ahorro de energía; no basta con comparar navegadores para confirmar la causa. El render evita dibujar entidades fuera de cámara y el marcador solo reconstruye sus filas cuando cambian, sin alterar la simulación ni los transportes.

1. Actualiza Chrome y prueba sin extensiones, con el mismo número de bots y el mismo zoom.
2. Revisa **Configuración → Sistema → Usar aceleración de gráficos cuando esté disponible**, reinicia Chrome y compara. En `chrome://gpu` puedes comprobar si Canvas está acelerado o usa software; no fuerces opciones experimentales.
3. Desactiva temporalmente el ahorro de energía y comprueba los controladores gráficos del sistema.
4. Si persiste, graba unos segundos jugando en **DevTools → Performance**. Una captura permite distinguir coste de dibujo, JavaScript y pausas del navegador; las pruebas automatizadas no reproducen necesariamente tu GPU.

## Gestión de Assets

Los gráficos del jugador, las armas y buena parte del mapa combinan **SVG generados desde JavaScript con dibujo en Canvas 2D**, sin depender de un paquete externo de sprites para esos elementos.

### Jugadores

En [public/js/assets.js](public/js/assets.js), cada skin define sus colores, detalles y accesorios. `skinUrl()` genera la imagen SVG para el menú o la partida. Las imágenes se cargan y reutilizan, en lugar de regenerarlas en cada fotograma.

Las manos se dibujan aparte en [public/js/game.js](public/js/game.js), con los colores de la skin. Esto permite orientarlas hacia la mira y animar los golpes independientemente del cuerpo.

### Mapa

En [public/js/world.js](public/js/world.js), árboles y rocas son imágenes SVG reutilizadas. El suelo emplea una textura repetida mediante `createPattern()`, mientras que caminos, edificios, muebles, puertas y techos se dibujan con Canvas. Los techos se vuelven transparentes al entrar en un edificio.

Las colisiones se calculan mediante geometría, no a partir de los píxeles de las imágenes. [public/js/buildings.js](public/js/buildings.js) comparte la geometría de paredes y puertas entre cliente y servidor.

### Armas y Objetos

`itemUrl()` en [public/js/assets.js](public/js/assets.js) genera las imágenes de armas, munición y consumibles. Se reutilizan en el inventario, en el suelo y al mostrar el objeto equipado. La rareza se distingue mediante bordes y etiquetas de color, sin necesitar tres imágenes distintas de cada arma.

### Carga y Multijugador

Los SVG generados se convierten en URLs `data:image/svg+xml` y se cargan como objetos `Image` para dibujarlos en Canvas. Por la red viajan identificadores y estado, como skin, arma, rareza y posición; **las imágenes no se envían en cada actualización de la partida**.

Este enfoque facilita modificar colores y diseños desde código. Para incorporar arte más detallado, se pueden sustituir los SVG por PNG o spritesheets adaptando la carga y el renderizado, sin cambiar las reglas del juego.

## Recursos y Alcance

Al finalizar una partida, los tres integrantes del podio escuchan una melodía de victoria; los demás participantes escuchan una de derrota. Son melodías originales sintetizadas con Web Audio, sin archivos de música externos. Respetan el volumen general, el volumen de efectos y el silencio. No se reproducen para quienes permanecen en el menú y se detienen al reiniciar la ronda.

Las nuevas skins, iconos de armas, consumibles y textura de terreno son originales de este proyecto; no se extrajeron personajes ni recursos de ZombsRoyale. Se conservan algunos sprites anteriores del repositorio, cuya procedencia debe revisarse antes de redistribuirlos. Lucide proporciona iconos de interfaz y NippleJS los joysticks; sus licencias acompañan a los paquetes.

Este proyecto está orientado a desarrollo y partidas en una red de confianza. No incluye cuentas, persistencia de partidas ni una protección antitrampas completa. Antes de publicarlo en Internet necesita endurecimiento de validaciones y límites de tráfico, HTTPS/WSS y revisión de dependencias.

---

<div align="center">

**OUTPOST · Entra en la arena.**

</div>
