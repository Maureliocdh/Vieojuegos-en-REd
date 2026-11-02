const { test, expect } = require('@playwright/test');

test('Ping real, tráfico, sondas sin respuesta y estadísticas finales', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await expect(page.locator('#network-panel')).toBeHidden();
  await page.locator('#nickname').fill('Estadísticas');
  await page.locator('#match-bots').selectOption('0');
  await page.locator('#jugar-button').click();
  await page.locator('#start-match').click();
  await page.waitForFunction(() => gameStarted && preparacionRestante === 0);
  await expect(page.locator('#network-panel')).toBeVisible();
  await expect(page.locator('#network-ping')).toHaveText(/Ping: \d+ ms/);
  await expect(page.locator('#network-loss')).toContainText('0 %');
  await expect(page.locator('#network-traffic')).toHaveText(/Subida: \d+\.\d KB\/s · Bajada: \d+\.\d KB\/s/);
  const rates = await page.evaluate(() => networkMetrics.sample(performance.now()));
  expect(rates.upload).toBeGreaterThan(0);
  expect(rates.download).toBeGreaterThan(0);
  const panel = await page.locator('#network-panel').boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(testInfo.project.use.viewport.width);
  const scoreboard = await page.locator('#scoreboard').boundingBox();
  const landscape = await page.evaluate(() => isMobile && innerHeight < 499);
  if (landscape) {
    expect(panel.x).toBeGreaterThanOrEqual(scoreboard.x + scoreboard.width);
    expect(panel.y).toBe(scoreboard.y);
  } else {
    expect(panel.x).toBe(scoreboard.x);
    expect(panel.y).toBeGreaterThanOrEqual(scoreboard.y + scoreboard.height);
  }
  for (const id of ['game-settings', 'leave-match', 'quick-chat']) {
    expect(await page.locator(`#${id}`).evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThan(1);
  }
  const minimap = await page.evaluate(() => {
    const size = isMobile ? 76 : 160;
    return { x: isMobile && innerHeight >= 500 ? innerWidth - size - 12 : 14,
      y: isMobile ? 70 : innerHeight - size - 14, size };
  });
  expect(panel.x >= minimap.x + minimap.size || panel.x + panel.width <= minimap.x
    || panel.y >= minimap.y + minimap.size || panel.y + panel.height <= minimap.y).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('network-hud.png') });
  await page.evaluate(() => {
    window.originalNetworkReceive = network.receive;
    network.receive = function(type, data) {
      if (type !== 'respuestaRed') window.originalNetworkReceive.call(this, type, data);
    };
  });
  await expect(page.locator('#network-loss')).not.toContainText('0 %', { timeout: 8000 });
  await page.evaluate(() => { network.receive = window.originalNetworkReceive; });
  await expect(page.locator('#network-ping')).toHaveText(/Ping: \d+ ms/);
  await page.evaluate(() => {
    network.receive('finDeJuego', [{
      id: network.id, nombre: 'Estadísticas', skin: 'pulse', kills: 5,
      estadisticas: { daño: 315, proyectiles: 8, impactos: 3, curacion: 42, reanimaciones: 2, muertes: 1 },
    }]);
  });
  await expect(page.locator('#network-panel')).toBeHidden();
  await expect(page.locator('#match-statistics')).toBeVisible();
  await expect(page.locator('#statistics-values dd')).toHaveText(['315', '37.5 %', '3 / 8', '42', '2', '1']);
  await page.locator('#match-statistics').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('final-statistics.png') });
  await page.evaluate(() => {
    gameStarted = true;
    network.receive('finDeJuego', [{
      id: network.id, nombre: 'Sin disparos', kills: 0,
      estadisticas: { daño: 0, proyectiles: 0, impactos: 0, curacion: 0, reanimaciones: 0, muertes: 0 },
    }]);
  });
  await expect(page.locator('#statistics-values dd').nth(1)).toHaveText('—');
  await page.locator('#return-home').click();
  expect(errors).toEqual([]);
});
