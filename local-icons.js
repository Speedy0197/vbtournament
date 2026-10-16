const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = function localIcons(directory) {
  const ready = fs.mkdir(directory, { recursive: true });
  return {
    async clear() {
      await ready;
      for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    },
    async save(teamId, file) {
      await ready;
      const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
      const filename = `team-${teamId}${extensions[file.mimetype]}`;
      await fs.writeFile(path.join(directory, filename), file.buffer);
      return `/uploads/teams/${filename}?v=${Date.now()}`;
    },
  };
};
