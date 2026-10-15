const TOGGLE_KEYS = ['visibility', 'blur', 'focus', 'contextmenu', 'copy', 'paste', 'cut', 'keydown', 'fullscreen'];
const relay = (enabled) => window.postMessage({ __suppressor: true, enabled }, '*');

const defaultsMerged = (stored) => {
  const map = {};
  TOGGLE_KEYS.forEach((k) => { map[k] = stored[k] !== false; }); // default true
  return map;
};

chrome.storage.local.get(TOGGLE_KEYS, (r) => relay(defaultsMerged(r)));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some((k) => TOGGLE_KEYS.includes(k))) {
    chrome.storage.local.get(TOGGLE_KEYS, (r) => relay(defaultsMerged(r)));
  }
});