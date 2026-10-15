(() => {
  // real event types we touch
  const windowLevel = ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focus'];
  const clipboardFullscreen = [
    'copy', 'paste', 'cut',
    'fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange',
  ];
  const elementLevel = ['contextmenu', 'copy', 'paste', 'cut', 'keydown'];
  const ALL_TYPES = [...new Set([...windowLevel, ...clipboardFullscreen, ...elementLevel])];

  // event type -> toggle key (several types can share one toggle)
  const GROUPS = {
    visibilitychange: 'visibility',
    webkitvisibilitychange: 'visibility',
    blur: 'blur',
    focus: 'focus',
    contextmenu: 'contextmenu',
    copy: 'copy',
    paste: 'paste',
    cut: 'cut',
    keydown: 'keydown',
    fullscreenchange: 'fullscreen',
    webkitfullscreenchange: 'fullscreen',
    mozfullscreenchange: 'fullscreen',
    MSFullscreenChange: 'fullscreen',
  };
  const TOGGLE_KEYS = [...new Set(Object.values(GROUPS))];

  let enabled = Object.fromEntries(TOGGLE_KEYS.map((k) => [k, true])); // default all on
  const isOn = (type) => !!enabled[GROUPS[type]];

  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__suppressor) {
      enabled = e.data.enabled; // full map replace, keyed by TOGGLE_KEYS
    }
  });

  // ---- 1. Spoofed getters, gated by the 'visibility' / 'focus' group ----
  const defToggleable = (obj, prop, spoofGetter, controllingType) => {
    const origDesc = Object.getOwnPropertyDescriptor(obj, prop);
    const origGetter = origDesc && origDesc.get;
    try {
      Object.defineProperty(obj, prop, {
        get() {
          return isOn(controllingType) ? spoofGetter.call(this) : (origGetter ? origGetter.call(this) : undefined);
        },
        configurable: true,
      });
    } catch (e) {}
  };

  defToggleable(Document.prototype, 'hidden', () => false, 'visibilitychange');
  defToggleable(Document.prototype, 'visibilityState', () => 'visible', 'visibilitychange');
  defToggleable(Document.prototype, 'webkitHidden', () => false, 'visibilitychange');
  defToggleable(Document.prototype, 'webkitVisibilityState', () => 'visible', 'visibilitychange');

  const origHasFocus = Document.prototype.hasFocus;
  try {
    Object.defineProperty(Document.prototype, 'hasFocus', {
      value: function () {
        return isOn('focus') ? true : origHasFocus.call(this);
      },
      configurable: true,
      writable: true,
    });
  } catch (e) {}

  // ---- 2. Per-type stop handlers (gated via group) ----
  const guardedStop = (event) => {
    if (!isOn(event.type)) return;
    if (event.target === window || event.target === document) {
      event.stopImmediatePropagation();
    }
  };
  const guardedSuppressAlways = (event) => {
    if (!isOn(event.type)) return;
    event.stopImmediatePropagation();
  };

  windowLevel.forEach((type) => {
    window.addEventListener(type, guardedStop, true);
    document.addEventListener(type, guardedStop, true);
  });
  clipboardFullscreen.forEach((type) => {
    window.addEventListener(type, guardedSuppressAlways, true);
    document.addEventListener(type, guardedSuppressAlways, true);
  });

  // ---- 3. Wrapped addEventListener/removeEventListener, gated per group ----
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;
  const wrapMap = new WeakMap();

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if ((this === window || this === document) && ALL_TYPES.includes(type) && typeof listener === 'function') {
      const wrapped = function (event) {
        if (isOn(type)) return;
        return listener.apply(this, arguments);
      };
      let byType = wrapMap.get(this);
      if (!byType) { byType = new Map(); wrapMap.set(this, byType); }
      let byListener = byType.get(type);
      if (!byListener) { byListener = new Map(); byType.set(type, byListener); }
      byListener.set(listener, wrapped);
      return origAdd.call(this, type, wrapped, options);
    }
    return origAdd.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const byType = wrapMap.get(this);
    const byListener = byType && byType.get(type);
    const wrapped = byListener && byListener.get(listener);
    if (wrapped) {
      byListener.delete(listener);
      return origRemove.call(this, type, wrapped, options);
    }
    return origRemove.call(this, type, listener, options);
  };

  // ---- 4. onX handler properties ----
  const makeOnXToggleable = (obj, prop) => {
    const type = prop.slice(2);
    const store = new WeakMap();
    try {
      Object.defineProperty(obj, prop, {
        get() { return store.get(this) || null; },
        set(fn) {
          const prev = store.get(this);
          if (prev) this.removeEventListener(type, prev);
          store.set(this, fn);
          if (typeof fn === 'function') this.addEventListener(type, fn);
        },
        configurable: true,
      });
    } catch (e) {}
  };

  ['onblur', 'onfocus', 'oncontextmenu', 'oncopy', 'onpaste', 'oncut', 'onkeydown']
    .forEach((prop) => makeOnXToggleable(window, prop));
  ['onvisibilitychange', 'oncontextmenu', 'oncopy', 'onpaste', 'oncut', 'onkeydown', 'onfullscreenchange', 'onwebkitfullscreenchange']
    .forEach((prop) => makeOnXToggleable(Document.prototype, prop));
})();