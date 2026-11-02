(function (root) {
  class NetworkMetrics {
    constructor() { this.sequence = 0; this.reset(0); }
    reset(now) {
      this.pending = new Map();
      this.results = [];
      this.rtt = null;
      this.up = 0; this.down = 0;
      this.lastSample = now;
      this.upload = null; this.download = null;
    }
    count(direction, type, data) {
      this[direction] += new TextEncoder().encode(JSON.stringify({ type, data })).length;
    }
    probe(now) {
      const seq = ++this.sequence;
      this.pending.set(seq, now);
      return { seq };
    }
    expire(now) {
      for (const [seq, sent] of this.pending) {
        if (now - sent < 3000) continue;
        this.pending.delete(seq);
        this.record(false);
      }
    }
    record(received) {
      this.results.push(received);
      if (this.results.length > 30) this.results.shift();
    }
    reply(seq, now) {
      this.expire(now);
      if (!this.pending.has(seq)) return;
      this.rtt = now - this.pending.get(seq);
      this.pending.delete(seq);
      this.record(true);
    }
    sample(now) {
      this.expire(now);
      const elapsed = (now - this.lastSample) / 1000;
      if (elapsed >= 1) {
        this.upload = this.up / elapsed / 1024;
        this.download = this.down / elapsed / 1024;
        this.up = 0; this.down = 0; this.lastSample = now;
      }
      return { ping: this.results.at(-1) === false ? null : this.rtt,
        lost: this.results.filter(value => !value).length, total: this.results.length,
        upload: this.upload, download: this.download };
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = NetworkMetrics;
  else root.NetworkMetrics = NetworkMetrics;
}(typeof window !== 'undefined' ? window : globalThis));
