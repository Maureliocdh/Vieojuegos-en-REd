const { test, expect } = require('@playwright/test');

test('Duelo persistente: sala, colores, marcador, reingreso y resultado del equipo', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.getByRole('tab', { name: 'Duelo por equipos', exact: true }).click();
  await page.reload();
  await expect(page.locator('#tab-equipos')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#nickname').fill('Capitán');
  await page.locator('#match-bots').selectOption('5');
  await page.locator('#jugar-button').click();
  const guest = await context.newPage();
  guest.on('pageerror', error => errors.push(error.message));
  await guest.goto('/');
  await expect(guest.locator('#jugar-button')).toBeEnabled();
  await guest.locator('#nickname').fill('Invitado');
  await guest.locator('#jugar-button').click();
  await expect(page.locator('#room-players li')).toHaveCount(2);
  await expect(page.locator('#room-players [data-equipo=azul]')).toHaveCount(1);
  await expect(page.locator('#room-players [data-equipo=rojo]')).toHaveCount(1);
  await expect(page.locator('#room-rules')).toContainText('DUELO POR EQUIPOS');
  await expect(guest.locator('#tab-equipos')).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: testInfo.outputPath('team-room.png') });
  await page.locator('#start-match').click();
  await expect(page.locator('#match-countdown')).toBeVisible();
  await expect(page.locator('#match-countdown h2')).toContainText('Sin fuego amigo');
  await page.waitForFunction(() => currentTeams && jugadores[network.id]?.equipo);
  const team = await page.evaluate(() => jugadores[network.id].equipo);
  await expect(page.locator('#scoreboard')).toContainText('Azul: 0 / 10');
  await expect(page.locator('#scoreboard')).toContainText('Rojo: 0 / 10');
  await page.locator('#leave-match').click();
  await page.getByRole('button', { name: 'Volver a la partida', exact: true }).click();
  await page.waitForFunction(team => gameStarted && jugadores[network.id]?.equipo === team, team);
  const ownTeam = page.locator('#scoreboard div').filter({ hasText: 'Tu equipo:' });
  await expect(ownTeam).toHaveText(`Tu equipo: ${team === 'azul' ? 'Azul' : 'Rojo'}`);
  const ownBounds = await ownTeam.boundingBox(), boardBounds = await page.locator('#scoreboard').boundingBox();
  expect(ownBounds.y + ownBounds.height).toBeLessThanOrEqual(boardBounds.y + boardBounds.height);
  await expect(page.locator('#match-countdown')).toBeHidden({ timeout: 8000 });
  await page.screenshot({ path: testInfo.outputPath('team-game.png') });
  await page.locator('#leave-match').click();
  await guest.locator('#leave-match').click();
  await page.waitForFunction(() => currentRoom && !currentRoom.activa && !currentRoom.anfitrionId);
  await page.evaluate(() => {
    window.originalReceive = network.receive;
    network.receive = function (type, data) { if (type !== 'estadoJuego') window.originalReceive.call(this, type, data); };
    currentTeams = { puntos: { azul: 10, rojo: 6 }, limite: 10, ganador: 'azul', finalizada: true };
    gameStarted = true;
    network.receive('finDeJuego', [{ id: network.id, nombre: 'Capitán', skin: 'nova', equipo: 'azul', kills: 4 },
      { id: 'guest', nombre: 'Invitado', skin: 'pulse', equipo: 'rojo', kills: 6 }]);
  });
  await expect(page.locator('#team-result')).toHaveText('Victoria del equipo Azul · Azul 10 — Rojo 6');
  await expect(page.locator('#podio li').first()).toContainText('(Azul)');
  await page.screenshot({ path: testInfo.outputPath('team-result.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { network.receive = window.originalReceive; });
  await guest.close();
  expect(errors).toEqual([]);
});

test('Charcos de vida y escudo: polígonos, renderizado y escudo real en los dos mapas', async ({ page }, testInfo) => {
  test.setTimeout(40000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.locator('#nickname').fill('Explorador');
  await page.locator('[data-mode=clasico]').click();
  await page.locator('#match-bots').selectOption('0');
  for (const map of ['outpost', 'orbital']) {
    await page.locator('#match-map').selectOption(map);
    await page.locator('#jugar-button').click();
    await page.locator('#start-match').click();
    await page.waitForFunction(() => gameStarted);
    await expect(page.locator('#match-countdown')).toBeHidden({ timeout: 8000 });
    const render = await page.evaluate(() => {
      const surface = document.createElement('canvas');
      surface.width = 500; surface.height = 400;
      const context = surface.getContext('2d');
      const results = [];
      for (const type of ['curacion', 'escudo']) {
        const zone = SpecialZones.zones.find(zone => zone.tipo === type);
        const lines = [], arcs = [];
        const lineTo = context.lineTo.bind(context), arc = context.arc.bind(context);
        context.clearRect(0, 0, 500, 400);
        context.save(); context.translate(250 - zone.x, 200 - zone.y);
        context.lineTo = (x, y) => { lines.push([x, y]); lineTo(x, y); };
        context.arc = (...args) => { arcs.push(args); arc(...args); };
        WorldArt.specialZones(context, (x, y) => x === zone.x && y === zone.y);
        context.restore();
        const inside = context.getImageData(250, 200, 1, 1).data;
        const outside = context.getImageData(250, 200 + Math.floor(zone.radio * 0.9), 1, 1).data;
        results.push({ type, points: zone.points.length, lines: lines.length, arcs: arcs.length,
          inside: inside[3], outside: outside[3] });
      }
      const shield = SpecialZones.zones.find(zone => zone.tipo === 'escudo');
      const target = { x: shield.x, y: shield.y };
      window.originalSend = network.send;
      network.send = function (type, data) {
        return window.originalSend.call(this, type, type === 'movimiento' ? { ...data, ...target } : data);
      };
      Object.assign(player, target);
      return results;
    });
    for (const result of render) {
      expect(result.points).toBe(18);
      expect(result.lines).toBeGreaterThanOrEqual(17);
      expect(result.arcs).toBe(0);
      expect(result.inside).toBeGreaterThan(0);
      expect(result.outside).toBe(0);
    }
    await page.waitForFunction(() => jugadores[network.id]?.escudo >= 2);
    await page.screenshot({ path: testInfo.outputPath(`puddle-shield-${map}.png`) });
    await page.evaluate(() => { network.send = window.originalSend; });
    await page.locator('#leave-match').click();
    await expect(page.locator('#jugar-button')).toBeEnabled();
  }
  expect(errors).toEqual([]);
});
