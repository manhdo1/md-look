/** Map-backed cache, most recently used last; the oldest entry is evicted past `max`. */
export class LruCache {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    const cached = this.map.get(key);
    if (cached) {
      this.map.delete(key);
      this.map.set(key, cached);
    }
    return cached;
  }

  set(key, value) {
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}
