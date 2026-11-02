(() => {
  const screen = document.getElementById('tactical-screen');
  const shop = document.getElementById('shop-area');
  let displayedPhase = null;
  const shopButtons = new Map();
  window.renderTactical = state => {
    window.tacticalState = state;
    const account = state?.players?.[network.id];
    const visible = gameStarted && !resultsPinned && account && ['instrucciones', 'puzzles', 'tienda'].includes(state.phase);
    screen.hidden = !visible;
    if (!visible) { displayedPhase = null; return; }
    document.getElementById('match-countdown').hidden = true;
    const intro = state.phase === 'instrucciones';
    const puzzles = intro || state.phase === 'puzzles';
    document.getElementById('training-intro').hidden = !intro;
    const count = intro && state.seconds > 3 ? 'PREPÁRATE' : String(state.seconds);
    const counter = document.getElementById('training-intro-count');
    if (counter.textContent !== count) counter.textContent = count;
    document.getElementById('training-intro-controls').textContent = document.body.classList.contains('mobile')
      ? 'Mantén pulsadas las flechas para moverte' : 'WASD para moverte';
    for (const button of document.querySelectorAll('[data-direction]')) button.disabled = intro;
    screen.classList.toggle('is-training', puzzles);
    document.getElementById('tactical-clock').textContent = intro ? 'INSTRUCCIONES' : `${state.seconds}s`;
    document.getElementById('tactical-step').textContent = puzzles ? '01 / CÁMARA DE ENERGÍA' : '02 / PREPARA TU ARSENAL';
    document.getElementById('tactical-title').textContent = puzzles ? 'Recoge energía. Prepara tu arsenal.' : 'Elige tu ventaja.';
    document.getElementById('tactical-instructions').textContent = puzzles
      ? 'Muévete con WASD o los botones. Acércate a la baliza iluminada: +5 créditos. La luz dura 6 s; dejarla pasar no te resta puntos.'
      : 'Compra antes de que termine el tiempo. Los créditos sin gastar desaparecen al comenzar el combate.';
    document.getElementById('tactical-credits').textContent = account.credits;
    document.getElementById('tactical-message').textContent = account.message;
    document.getElementById('puzzle-area').hidden = !puzzles;
    shop.hidden = puzzles;
    if (puzzles) {
      document.getElementById('puzzle-progress').textContent = account.solved + ' energías · Bonificación ' + (account.credits - 80) + ' / 100';
    } else {
      if (displayedPhase !== 'tienda') {
        shop.replaceChildren(); shopButtons.clear();
        for (const item of state.shop) {
          const card = document.createElement('article');
          const title = document.createElement('h3'); title.textContent = item.nombre;
          const text = document.createElement('p'); text.textContent = item.descripcion;
          const button = document.createElement('button'); button.type = 'button';
          button.addEventListener('click', () => network.send('comprarEquipo', { item: item.id }));
          card.append(title, text, button); shop.append(card); shopButtons.set(item.id, button);
        }
      }
      for (const item of state.shop) {
        const button = shopButtons.get(item.id);
        const count = account.purchases[item.id] || 0;
        const done = count >= (item.id === 'municion' ? 2 : 1);
        button.disabled = done || account.credits < item.precio;
        button.textContent = done ? 'Comprado' : `${item.precio} créditos${count ? ' · 1/2' : ''}`;
      }
    }
    displayedPhase = state.phase;
  };
})();
