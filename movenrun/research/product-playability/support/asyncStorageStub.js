// In-memory AsyncStorage for plain-Node tests. See nodeShims.ts.
const memory = globalThis.__asyncStorage || new Map();
const api = {
  getItem: async (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: async (k, v) => { memory.set(k, String(v)); },
  removeItem: async (k) => { memory.delete(k); },
  clear: async () => { memory.clear(); },
  getAllKeys: async () => [...memory.keys()],
  multiGet: async (keys) => keys.map((k) => [k, memory.has(k) ? memory.get(k) : null]),
  multiSet: async (pairs) => { for (const [k, v] of pairs) memory.set(k, String(v)); },
  multiRemove: async (keys) => { for (const k of keys) memory.delete(k); },
};
module.exports = api;
module.exports.default = api;
