(() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('outpost-settings')) || {}; } catch {}
  const volume = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  const ui = window.ArenaUI = {
    skin: GameAssets.skins.some((skin) => skin.id === saved.skin) ? saved.skin : 'pulse',
    name: typeof saved.name === 'string' ? saved.name.slice(0, 16) : '',
    limiteKills: [5, 10, 20, 30].includes(saved.limiteKills) ? saved.limiteKills : 10,
    duracion: [60, 120, 180, 300].includes(saved.duracion) ? saved.duracion : 120,
    cantidadBots: [0, 5, 11, 15, 20].includes(saved.cantidadBots) ? saved.cantidadBots : 11,
    dificultadBots: ['facil', 'normal', 'dificil'].includes(saved.dificultadBots) ? saved.dificultadBots : 'normal',
    mapa: ArenaMaps.valid(saved.mapa) ? saved.mapa : 'outpost',
    master: volume(saved.master, 0.65), effects: volume(saved.effects, 0.7), ambient: volume(saved.ambient, 0.25), muted: saved.muted === true,
    save() { try { localStorage.setItem('outpost-settings', JSON.stringify(this)); } catch {} },
  };
  const picker = document.getElementById('skin-picker');
  document.getElementById('skin-count').textContent = `${String(GameAssets.skins.length).padStart(2, '0')} / DISPONIBLES`;
  window.selectArenaMap = (id, persist = false) => {
    const map = ArenaMaps.catalog.find(map => map.id === id);
    if (!map) return;
    document.getElementById('match-map').value = id;
    document.getElementById('map-preview').dataset.map = id;
    document.getElementById('map-name').textContent = map.nombre;
    document.getElementById('map-description').textContent = map.descripcion;
    document.body.dataset.map = id;
    document.querySelector('.lobby-title .eyebrow').textContent = id === 'orbital' ? 'SECTOR 07 / ÓRBITA ALTA'
      : id === 'desierto' ? 'SECTOR 03 / DESIERTO ÁMBAR' : 'TEMPORADA 01 / TIERRA ABIERTA';
    document.querySelector('.lobby-footer > span:first-child').textContent = map.nombre.toUpperCase();
    if (persist) { ui.mapa = id; ui.save(); }
  };
  window.selectArenaMap(ui.mapa);
  document.getElementById('match-map').addEventListener('change', event => window.selectArenaMap(event.target.value, true));
  ui.modo = ['clasico', 'puzzles', 'equipos', 'solo'].includes(saved.modo) ? saved.modo : 'clasico';
  const tabs = [...document.querySelectorAll('[data-mode]')];
  window.selectArenaMode = (mode, persist = true) => {
    if (!['clasico', 'puzzles', 'equipos', 'solo'].includes(mode)) mode = 'clasico';
    ui.modo = mode;
    for (const tab of tabs) {
      const selected = tab.dataset.mode === mode;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) document.getElementById('arena-mode-panel').setAttribute('aria-labelledby', tab.id);
    }
    document.getElementById('mode-description').textContent = {
      clasico: 'Combate directo con reapariciones. Reúne a tus amigos y domina la arena.',
      puzzles: '60 s de balizas → 20 s de compras → combate. Gana créditos y elige tu equipo inicial.',
      equipos: 'Azul contra Rojo. Humanos y bots equilibrados, sin fuego amigo. Gana el equipo que alcance las bajas objetivo; al terminar el tiempo, gana quien tenga más.',
      solo: 'Arena clásica contra bots. La sala no admite otros jugadores; puedes elegir cuántos bots participan.',
    }[mode];
    document.querySelector('.match-tag').firstChild.textContent = mode === 'equipos' ? 'DUELO POR EQUIPOS ' : 'TODOS CONTRA TODOS ';
    if (persist) ui.save();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => window.selectArenaMode(tab.dataset.mode));
    tab.addEventListener('keydown', event => {
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!offset && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length];
      if (!next.disabled) { next.focus(); next.click(); }
    });
  });
  window.selectArenaMode(ui.modo, false);
  function selectSkin(id) {
    ui.skin = id;
    const skin = GameAssets.skins.find((candidate) => candidate.id === id);
    document.documentElement.style.setProperty('--operator-color', skin.color);
    document.getElementById('skin-preview').src = GameAssets.skinUrl(skin, true);
    document.getElementById('skin-preview').alt = skin.name;
    document.getElementById('skin-name').textContent = skin.name;
    document.getElementById('skin-role').textContent = skin.role;
    for (const button of picker.children) button.setAttribute('aria-pressed', String(button.dataset.skin === id));
    ui.save();
  }
  for (const skin of GameAssets.skins) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.skin = skin.id;
    button.title = `${skin.name} · ${skin.role}`;
    if (skin.theme) button.dataset.theme = skin.theme;
    button.setAttribute('aria-label', skin.name);
    const image = new Image(68, 68);
    image.alt = '';
    image.src = GameAssets.skinUrl(skin, true);
    button.append(image);
    button.addEventListener('click', () => selectSkin(skin.id));
    picker.append(button);
  }
  selectSkin(ui.skin);
  for (const [id, field] of [['match-kills', 'limiteKills'], ['match-duration', 'duracion'], ['match-bots', 'cantidadBots']]) {
    const select = document.getElementById(id);
    select.value = ui[field];
    select.addEventListener('change', () => { ui[field] = Number(select.value); ui.save(); });
  }
  const difficulty = document.getElementById('match-difficulty');
  difficulty.value = ui.dificultadBots;
  difficulty.addEventListener('change', () => { ui.dificultadBots = difficulty.value; ui.save(); });
  document.getElementById('nickname').value = ui.name;
  document.getElementById('nickname').addEventListener('input', (event) => { ui.name = event.target.value; ui.save(); });
  for (const channel of ['master', 'effects', 'ambient']) {
    const slider = document.getElementById(`volume-${channel}`);
    const output = document.getElementById(`value-${channel}`);
    slider.value = Math.round(ui[channel] * 100);
    output.value = `${slider.value}%`;
    slider.addEventListener('input', () => {
      ui[channel] = Number(slider.value) / 100;
      output.value = `${slider.value}%`;
      ui.save();
      window.dispatchEvent(new Event('audio-settings'));
    });
  }
  const mute = document.getElementById('mute-audio');
  mute.checked = ui.muted;
  mute.addEventListener('change', () => { ui.muted = mute.checked; ui.save(); window.dispatchEvent(new Event('audio-settings')); });
  const dialog = document.getElementById('sound-dialog');
  document.querySelectorAll('.settings-trigger').forEach((button) => button.addEventListener('click', () => dialog.showModal()));
  window.lucide?.createIcons();
})();
