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

1. Elige un operador y escribe tu nombre.
2. Selecciona las **bajas para ganar**: 5, 10, 20 o 30.
3. Selecciona el **tiempo máximo**: 1, 2, 3 o 5 minutos.
4. Ajusta el sonido desde el botón de configuración.
5. Pulsa **Jugar ahora**.

El primer jugador que entra fija las reglas de la ronda. Los jugadores que llegan después ven esas reglas bloqueadas. Nadie sale del menú hasta pulsar su propio botón de jugar.

La arena incluye once bots. Tras una eliminación, reapareces a los tres segundos. Al finalizar, se muestra el podio y se prepara una nueva ronda después de diez segundos.

## Controles

### Ordenador

| Acción | Control |
| :--- | :--- |
| Moverse | `W`, `A`, `S`, `D` |
| Apuntar | Ratón |
| Disparar, golpear o usar el consumible equipado | Clic izquierdo |
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

## Recursos y Alcance

Las nuevas skins, iconos de armas, consumibles y textura de terreno son originales de este proyecto; no se extrajeron personajes ni recursos de ZombsRoyale. Se conservan algunos sprites anteriores del repositorio, cuya procedencia debe revisarse antes de redistribuirlos. Lucide proporciona iconos de interfaz y NippleJS los joysticks; sus licencias acompañan a los paquetes.

Este proyecto está orientado a desarrollo y partidas en una red de confianza. No incluye cuentas, persistencia de partidas ni una protección antitrampas completa. Antes de publicarlo en Internet necesita endurecimiento de validaciones y límites de tráfico, HTTPS/WSS y revisión de dependencias.

---

<div align="center">

**OUTPOST · Entra en la arena.**

</div>