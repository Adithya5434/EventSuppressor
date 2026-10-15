const TOGGLE_KEYS = ['visibility', 'blur', 'focus', 'contextmenu', 'copy', 'paste', 'cut', 'keydown', 'fullscreen'];
const boxes = document.querySelectorAll('input[data-type]');

chrome.storage.local.get(TOGGLE_KEYS, (r) => {
  boxes.forEach((box) => {
    box.checked = r[box.dataset.type] !== false;
  });
});

boxes.forEach((box) => {
  box.addEventListener('change', () => {
    chrome.storage.local.set({ [box.dataset.type]: box.checked });
  });
});