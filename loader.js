const sync = (enabled) => {
  window.dispatchEvent(new CustomEvent('__suppressor_set_state', { detail: { enabled } }));
};

const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = () => {
  script.remove();
  chrome.storage.local.get(['enabled'], (r) => sync(r.enabled !== false));
};
(document.head || document.documentElement).appendChild(script);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'enabled' in changes) {
    sync(changes.enabled.newValue !== false);
  }
});