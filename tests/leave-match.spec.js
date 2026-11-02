const { test, expect } = require('@playwright/test');

test('Dificultad persistente y salida individual al menú en todos los modos', async ({ page, context }) => {
  test.setTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.locator('#match-difficulty').selectOption('dificil');
  await page.reload();
  await expect(page.locator('#match-difficulty')).toHaveValue('dificil');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  const guest = await context.newPage();
  guest.on('pageerror', error => errors.push(error.message));
  await guest.goto('/');
  await expect(guest.locator('#jugar-button')).toBeEnabled();
  for (const mode of ['clasico', 'puzzles', 'solo']) {
    await expect(page.locator('#jugar-button')).toBeEnabled();
    await page.locator(`[data-mode="${mode}"]`).click();
    await page.locator('#nickname').fill('Anfitrión');
    await page.locator('#match-bots').selectOption('5');
    await page.locator('#jugar-button').click();
    await expect(page.locator('#pantalla-espera')).toBeVisible();
    await expect(page.locator('#room-rules')).toContainText('Difícil');
    const identity = await page.evaluate(() => network.id);
    if (mode !== 'solo') {
      await guest.locator('#nickname').fill('Invitado');
      await guest.locator('#jugar-button').click();
      await expect(page.locator('#room-players li')).toHaveCount(2);
    }
    await page.locator('#start-match').click();
    if (mode === 'puzzles') {
      await expect(page.locator('#tactical-screen')).toBeVisible();
    } else {
      await expect(page.locator('#match-countdown')).toBeVisible();
      if (mode === 'clasico') await expect(page.locator('#match-countdown')).toBeHidden({ timeout: 8000 });
    }
    await page.getByRole('button', { name: 'Abandonar partida y volver al menú', exact: true }).click();
    await expect(page.locator('#pantalla-inicio')).toBeVisible();
    await expect(page.locator('#pantalla-espera')).toBeHidden();
    await expect(page.locator('#tactical-screen')).toBeHidden();
    await expect(page.locator('#match-countdown')).toBeHidden();
    await expect(page.locator('#leave-match')).toBeHidden();
    expect(await page.evaluate(() => network.id)).toBe(identity);
    if (mode !== 'solo') {
      await expect(guest.locator('#pantalla-inicio')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Volver a la partida', exact: true })).toBeEnabled();
      await expect(page.locator('#match-difficulty')).toBeDisabled();
      await page.waitForFunction(() => !jugadores[network.id]?.unido);
      expect(await guest.evaluate(() => gameStarted && currentRoom.activa && currentRoom.jugadores.length === 1)).toBe(true);
      await page.getByRole('button', { name: 'Volver a la partida', exact: true }).click();
      await expect(page.locator('#pantalla-inicio')).toBeHidden();
      await page.waitForFunction(() => gameStarted && currentRoom.jugadores.length === 2);
      if (mode === 'puzzles') await expect(page.locator('#tactical-screen')).toBeVisible();
      expect(await page.evaluate(() => network.id)).toBe(identity);
      await page.locator('#leave-match').click();
      await expect(page.locator('#pantalla-inicio')).toBeVisible();
      await guest.locator('#leave-match').click();
      await expect(guest.locator('#pantalla-inicio')).toBeVisible();
    }
    await expect(page.locator('#jugar-button')).toBeEnabled();
    await expect(page.locator('#match-difficulty')).toHaveValue('dificil');
  }
  await page.locator('[data-mode="clasico"]').click();
  await page.locator('#jugar-button').click();
  await expect(page.locator('#pantalla-espera')).toBeVisible();
  await expect(guest.locator('#jugar-button')).toBeEnabled();
  await guest.locator('#jugar-button').click();
  await expect(page.locator('#room-players li')).toHaveCount(2);
  await page.locator('#leave-match').click();
  await expect(page.locator('#pantalla-inicio')).toBeVisible();
  await expect(guest.locator('#pantalla-espera')).toBeVisible();
  await expect(guest.locator('#room-players li')).toHaveCount(1);
  await expect(guest.locator('#start-match')).toBeVisible();
  await guest.locator('#leave-match').click();
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await guest.close();
  expect(errors).toEqual([]);
});
