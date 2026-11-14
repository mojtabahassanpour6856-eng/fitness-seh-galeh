const STORAGE_KEY = 'seh.offline-continuity.v1';
const ALLOWED_VIEWS = new Set(['home']);

export function createOfflineContinuity({ storage }) {
  if (!storage || typeof storage.getItem !== 'function') {
    throw new TypeError('A Storage-compatible object is required');
  }

  function readMarker() {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (value?.version !== 1 || !ALLOWED_VIEWS.has(value.view)) return null;
      return { version: 1, view: value.view };
    } catch {
      return null;
    }
  }

  return {
    rememberSafeView(view) {
      if (!ALLOWED_VIEWS.has(view)) {
        throw new TypeError('Only an allow-listed non-sensitive shell view can be remembered');
      }
      // Deliberately persist no user ID, role, profile, token, trainee data or form payload.
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, view }));
    },

    getSafeView() {
      return readMarker()?.view ?? 'home';
    },

    clear() {
      storage.removeItem(STORAGE_KEY);
    },

    resolve({ online, verified }) {
      if (online && verified) return 'authenticated-online';
      if (online && !verified) return 'reauth-required';
      return readMarker() ? 'offline-limited' : 'offline-guest';
    }
  };
}

export const OFFLINE_CONTINUITY_STORAGE_KEY = STORAGE_KEY;