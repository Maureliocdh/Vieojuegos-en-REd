const Buildings = require('../public/js/buildings');

class Navigation {
  constructor(obstacles, size = 6000, step = 100) {
    this.step = step;
    this.walls = obstacles.flatMap(object => Buildings.walls(object.puertas
      ? { ...object, puertas: object.puertas.map(door => ({ ...door, abierta: true })) } : object));
    this.nodes = new Map();
    for (let y = step / 2; y < size; y += step) {
      for (let x = step / 2; x < size; x += step) {
        if (this.clear(x, y)) this.nodes.set(`${x},${y}`, { x, y, neighbors: [] });
      }
    }
    for (const node of this.nodes.values()) {
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const next = this.nodes.get(`${node.x + dx},${node.y + dy}`);
        if (next && this.clear(node.x + dx / 2, node.y + dy / 2)) node.neighbors.push(next);
      }
    }
  }
  clear(x, y) {
    return !this.walls.some(wall => Math.hypot(
      x - Math.max(wall.x, Math.min(x, wall.x + wall.width)),
      y - Math.max(wall.y, Math.min(y, wall.y + wall.height))) < 26);
  }
  nearest(point) {
    let best = null, distance = this.step * 2;
    for (const node of this.nodes.values()) {
      const current = Math.hypot(node.x - point.x, node.y - point.y);
      if (current >= distance) continue;
      const samples = Math.ceil(current / 20);
      let reachable = true;
      for (let i = 0; i <= samples; i += 1) {
        const fraction = samples ? i / samples : 0;
        if (!this.clear(point.x + (node.x - point.x) * fraction, point.y + (node.y - point.y) * fraction)) {
          reachable = false;
          break;
        }
      }
      if (reachable) { best = node; distance = current; }
    }
    return best;
  }
  path(from, to) {
    const start = this.nearest(from), end = this.nearest(to);
    if (!start || !end) return [];
    const queue = [start], parents = new Map([[start, null]]);
    for (let i = 0; i < queue.length; i += 1) {
      const node = queue[i];
      if (node === end) {
        const path = [];
        for (let current = end; current; current = parents.get(current)) path.push({ x: current.x, y: current.y });
        return path.reverse();
      }
      for (const next of node.neighbors) {
        if (!parents.has(next)) { parents.set(next, node); queue.push(next); }
      }
    }
    return [];
  }
}

module.exports = { Navigation };
