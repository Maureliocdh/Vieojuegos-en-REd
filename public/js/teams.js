(function (root) {
  const catalog = {
    azul: { nombre: 'Azul', color: '#62bdff' },
    rojo: { nombre: 'Rojo', color: '#ff7979' },
  };
  const valid = team => typeof team === 'string' && Object.hasOwn(catalog, team);
  const same = (first, second) => valid(first?.equipo) && first.equipo === second?.equipo;
  function balance(players, random = Math.random) {
    const totals = { azul: 0, rojo: 0 };
    for (const bot of [false, true]) {
      const group = players.filter(player => Boolean(player.esBot) === bot);
      for (let i = group.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [group[i], group[j]] = [group[j], group[i]];
      }
      let next = totals.azul === totals.rojo ? (random() < 0.5 ? 'azul' : 'rojo')
        : totals.azul < totals.rojo ? 'azul' : 'rojo';
      for (const player of group) {
        player.equipo = next;
        totals[next] += 1;
        next = next === 'azul' ? 'rojo' : 'azul';
      }
    }
    return totals;
  }
  function winner(scores) {
    return scores.azul === scores.rojo ? null : scores.azul > scores.rojo ? 'azul' : 'rojo';
  }
  function canRevive(rescuer, target, walls) {
    if (!rescuer?.unido || rescuer.muerto || rescuer.abatido || !target?.unido || target.muerto
      || !target.abatido || !same(rescuer, target)) return false;
    const distance = Math.hypot(rescuer.x - target.x, rescuer.y - target.y);
    if (distance > 105) return false;
    const steps = Math.ceil(distance / 8);
    for (let i = 1; i < steps; i += 1) {
      const x = rescuer.x + (target.x - rescuer.x) * i / steps;
      const y = rescuer.y + (target.y - rescuer.y) * i / steps;
      if (walls.some(wall => x >= wall.x && x <= wall.x + wall.width && y >= wall.y && y <= wall.y + wall.height)) return false;
    }
    return true;
  }
  const api = { catalog, valid, same, balance, winner, canRevive };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaTeams = api;
}(typeof window !== 'undefined' ? window : globalThis));
