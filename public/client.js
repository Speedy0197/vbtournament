(() => {
  const marker = document.querySelector('meta[name="scores-refresh"]');
  if (!marker) return;
  const interval = Number(marker.content) * 1000;
  if (!Number.isFinite(interval) || interval < 60000) return;
  let timer;
  function schedule() {
    clearTimeout(timer);
    if (!document.hidden) timer = setTimeout(() => window.location.reload(), interval);
  }
  document.addEventListener('visibilitychange', schedule);
  schedule();
})();

// Decode with an image element when ImageBitmap is unavailable (older browsers).
async function loadTeamIcon(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image, close: () => image.close() };
    } catch (_) { /* Try the browser's regular image decoder below. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('This image could not be opened. Try a different photo.'));
      image.src = url;
    });
    return { image, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

// Resize selected photos before upload so small team icons stay fast to load.
async function prepareTeamIcon(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image of 5 MiB or less.');
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, GIF, or WebP image.');
  }
  const decoded = await loadTeamIcon(file);
  const bitmap = decoded.image;
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    for (;;) {
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
      if (!blob) throw new Error('This browser could not prepare the image. Try a different photo.');
      if (blob.size <= 16 * 1024) return blob;
      if (canvas.width <= 1 && canvas.height <= 1) throw new Error('This image could not be resized.');
      canvas.width = Math.max(1, Math.floor(canvas.width / 2));
      canvas.height = Math.max(1, Math.floor(canvas.height / 2));
    }
  } finally {
    decoded.close();
  }
}

for (const input of document.querySelectorAll('input[data-icon-upload]')) {
  input.addEventListener('change', async () => {
    if (!input.files[0]) return;
    const status = document.getElementById('icon-upload-status');
    const controls = [...document.querySelectorAll('input, button')].map(element => ({ element, disabled: element.disabled }));
    for (const { element } of controls) element.disabled = true;
    status.textContent = 'Preparing team icon…';
    try {
      const blob = await prepareTeamIcon(input.files[0]);
      const body = new FormData();
      body.set('icon', blob, blob.type === 'image/webp' ? 'team.webp' : 'team.png');
      status.textContent = 'Saving team icon…';
      const response = await fetch(input.form.action, { method: 'POST', body });
      if (!response.ok) throw new Error('The icon could not be saved. Please try again.');
      window.location.assign(response.url);
    } catch (error) {
      status.textContent = error.message || 'The icon could not be saved. Please try again.';
      for (const { element, disabled } of controls) element.disabled = disabled;
      input.value = '';
    }
  });
}

const rosterForm = document.getElementById('roster-form');
const addTeam = document.getElementById('add-team');
if (rosterForm && addTeam) {
  const list = document.getElementById('team-roster');
  const template = document.getElementById('new-team-template');
  function updateRoster(dirty = false) {
    const rows = [...list.querySelectorAll('[data-roster-team]')];
    addTeam.disabled = rows.length >= 7;
    for (const remove of list.querySelectorAll('[data-remove-team]')) remove.disabled = rows.length <= 6;
    document.getElementById('save-roster').disabled = ![6,7].includes(rows.length);
    document.getElementById('roster-count').textContent = rows.length + ' teams. Generate with six or seven teams.';
    if (dirty) {
      rosterForm.dataset.dirty = 'true';
      for (const input of document.querySelectorAll('input[data-icon-upload]')) input.disabled = true;
      document.getElementById('icon-upload-status').textContent = 'Save roster changes before uploading logos.';
    }
  }
  addTeam.addEventListener('click', () => {
    if (list.querySelectorAll('[data-roster-team]').length >= 7) return;
    list.append(template.content.cloneNode(true));
    updateRoster(true);
    list.lastElementChild.querySelector('input[name="name"]').focus();
  });
  list.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-team]');
    if (!remove || list.querySelectorAll('[data-roster-team]').length <= 6) return;
    remove.closest('[data-roster-team]').remove();
    updateRoster(true);
  });
  list.addEventListener('input', event => {
    if (event.target.name === 'name') updateRoster(true);
  });
  updateRoster();
}
