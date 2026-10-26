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
  const groupOn = (groupKey) => !!enabled[groupKey];

  // Collect every "re-apply this when toggles change" function here.
  const reconcilers = [];

  // ---- 1. Getters that fully restore the native descriptor when off ----
  const makeToggleableGetter = (obj, prop, spoofGetter, controllingGroup) => {
    const origDesc = Object.getOwnPropertyDescriptor(obj, prop);
    if (!origDesc) return; // nothing to patch/restore

    let patched = false;

    const apply = () => {
      const shouldBeOn = groupOn(controllingGroup);
      if (shouldBeOn && !patched) {
        try {
          Object.defineProperty(obj, prop, {
            get: spoofGetter,
            configurable: true,
          });
          patched = true;
        } catch (e) {}
      } else if (!shouldBeOn && patched) {
        try {
          Object.defineProperty(obj, prop, origDesc);
          patched = false;
        } catch (e) {}
      }
    };

    reconcilers.push(apply);
    apply(); // initial state
  };

  makeToggleableGetter(Document.prototype, 'hidden', () => false, 'visibility');
  makeToggleableGetter(Document.prototype, 'visibilityState', () => 'visible', 'visibility');
  makeToggleableGetter(Document.prototype, 'webkitHidden', () => false, 'visibility');
  makeToggleableGetter(Document.prototype, 'webkitVisibilityState', () => 'visible', 'visibility');

  // hasFocus is a method, not an accessor — handle it the same way (value descriptor swap)
  (() => {
    const origDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hasFocus');
    if (!origDesc) return;
    const origFn = origDesc.value;
    let patched = false;

    const spoofedFn = function () { return true; };

    const apply = () => {
      const shouldBeOn = groupOn('focus');
      if (shouldBeOn && !patched) {
        try {
          Object.defineProperty(Document.prototype, 'hasFocus', {
            value: spoofedFn,
            configurable: true,
            writable: true,
          });
          patched = true;
        } catch (e) {}
      } else if (!shouldBeOn && patched) {
        try {
          Object.defineProperty(Document.prototype, 'hasFocus', origDesc);
          patched = false;
        } catch (e) {}
      }
    };

    reconcilers.push(apply);
    apply();
  })();

  // ---- 2. Per-type stop handlers (gated via group, cheap to leave attached) ----
  // These are harmless to leave listening — they no-op via isOn() when off,
  // and merely listening doesn't change toString()/native-code fingerprints.
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

  // ---- 3. addEventListener/removeEventListener: only patched while ANY toggle is on ----
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;
  const wrapMap = new WeakMap();

  const wrappedAdd = function (type, listener, options) {
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

  const wrappedRemove = function (type, listener, options) {
    const byType = wrapMap.get(this);
    const byListener = byType && byType.get(type);
    const wrapped = byListener && byListener.get(listener);
    if (wrapped) {
      byListener.delete(listener);
      return origRemove.call(this, type, wrapped, options);
    }
    return origRemove.call(this, type, listener, options);
  };

  let listenerPatchActive = false;
  const applyListenerPatch = () => {
    const anyOn = TOGGLE_KEYS.some((k) => enabled[k]);
    if (anyOn && !listenerPatchActive) {
      EventTarget.prototype.addEventListener = wrappedAdd;
      EventTarget.prototype.removeEventListener = wrappedRemove;
      listenerPatchActive = true;
    } else if (!anyOn && listenerPatchActive) {
      EventTarget.prototype.addEventListener = origAdd;
      EventTarget.prototype.removeEventListener = origRemove;
      listenerPatchActive = false;
    }
  };
  reconcilers.push(applyListenerPatch);
  applyListenerPatch();

  // ---- 4. onX handler properties: fully restore native descriptor when off ----
  const makeOnXToggleable = (obj, prop, controllingGroup) => {
    const type = prop.slice(2);
    const origDesc = Object.getOwnPropertyDescriptor(obj, prop);
    if (!origDesc) return;

    const store = new WeakMap();
    let patched = false;

    const customDesc = {
      get() { return store.get(this) || null; },
      set(fn) {
        const prev = store.get(this);
        if (prev) this.removeEventListener(type, prev);
        store.set(this, fn);
        if (typeof fn === 'function') this.addEventListener(type, fn);
      },
      configurable: true,
    };

    const apply = () => {
      const shouldBeOn = groupOn(controllingGroup);
      if (shouldBeOn && !patched) {
        try {
          Object.defineProperty(obj, prop, customDesc);
          patched = true;
        } catch (e) {}
      } else if (!shouldBeOn && patched) {
        try {
          Object.defineProperty(obj, prop, origDesc);
          patched = false;
        } catch (e) {}
      }
    };

    reconcilers.push(apply);
    apply();
  };

  makeOnXToggleable(window, 'onblur', 'blur');
  makeOnXToggleable(window, 'onfocus', 'focus');
  makeOnXToggleable(window, 'oncontextmenu', 'contextmenu');
  makeOnXToggleable(window, 'oncopy', 'copy');
  makeOnXToggleable(window, 'onpaste', 'paste');
  makeOnXToggleable(window, 'oncut', 'cut');
  makeOnXToggleable(window, 'onkeydown', 'keydown');

  makeOnXToggleable(Document.prototype, 'onvisibilitychange', 'visibility');
  makeOnXToggleable(Document.prototype, 'oncontextmenu', 'contextmenu');
  makeOnXToggleable(Document.prototype, 'oncopy', 'copy');
  makeOnXToggleable(Document.prototype, 'onpaste', 'paste');
  makeOnXToggleable(Document.prototype, 'oncut', 'cut');
  makeOnXToggleable(Document.prototype, 'onkeydown', 'keydown');
  makeOnXToggleable(Document.prototype, 'onfullscreenchange', 'fullscreen');
  makeOnXToggleable(Document.prototype, 'onwebkitfullscreenchange', 'fullscreen');

  // ---- 5. React to toggle updates from the content script ----
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__suppressor) {
      enabled = e.data.enabled; // full map replace, keyed by TOGGLE_KEYS
      reconcilers.forEach((fn) => fn());
    }
  });
})();