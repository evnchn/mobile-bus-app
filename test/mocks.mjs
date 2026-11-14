// In-memory stand-ins for the native modules stopAlarm.ts imports.
// State lives on globalThis so it survives a fresh import of the module
// (which is how a headless task run after process death sees the world).
const m = (globalThis.__alarm ??= { storage: new Map() });
export const reset = (over = {}) =>
  Object.assign(m, {
    os: "android", notif: "granted", bg: "granted", startThrows: false, startImpl: null, getDelay: 0, running: false,
    started: [], stopped: 0, notified: [], tasks: {}, ...over,
  });

export const TaskManager = { defineTask: (name, fn) => { m.tasks[name] = fn; } };
export const Notifications = {
  setNotificationHandler() {},
  requestPermissionsAsync: async () => ({ status: m.notif }),
  scheduleNotificationAsync: async (n) => { m.notified.push(n.content); },
};
export const Location = {
  Accuracy: { Balanced: 3 },
  getBackgroundPermissionsAsync: async () => ({ status: m.bg }),
  requestBackgroundPermissionsAsync: async () => ({ status: m.bg }),
  startLocationUpdatesAsync: async (_name, opts) => {
    if (m.startImpl) return m.startImpl(opts);
    if (m.startThrows) throw new Error("start failed");
    m.started.push(opts);
    m.running = true;
  },
  stopLocationUpdatesAsync: async () => { m.stopped++; m.running = false; },
  hasStartedLocationUpdatesAsync: async () => m.running,
};
export const ReactNative = { get Platform() { return { OS: m.os }; } };
export const AsyncAlertMod = { AsyncAlert: async () => {}, AsyncConsent: async () => true };
export const AsyncStorage = {
  getItem: async (k) => {
    const v = m.storage.has(k) ? m.storage.get(k) : null; // value as of the call
    await new Promise((r) => setTimeout(r, m.getDelay));
    return v;
  },
  setItem: async (k, v) => { m.storage.set(k, String(v)); },
  removeItem: async (k) => { m.storage.delete(k); },
};
