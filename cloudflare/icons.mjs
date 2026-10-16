import { Buffer } from 'node:buffer';

// D1 has a 2 MB row limit. Base64 avoids costly JSON arrays of individual bytes. Chunks preserve the app's 5 MiB upload limit.
const CHUNK_SIZE = 512 * 1024;
export function createIcons(database) {
  const stmt = (sql, ...args) => database.prepare(sql).bind(...args);
  return {
    async clear() {}, // Deleting teams cascades through icon metadata and chunks.
    async save(teamId, file) {
      const version = crypto.randomUUID();
      const url = `/uploads/teams/team-${teamId}?v=${version}`;
      const statements = [
        stmt('DELETE FROM team_icons WHERE team_id = ?', teamId),
        stmt('INSERT INTO team_icons (team_id, mime_type, version) VALUES (?, ?, ?)', teamId, file.mimetype, version),
      ];
      for (let offset = 0, index = 0; offset < file.buffer.length; offset += CHUNK_SIZE, index++) {
        const bytes = file.buffer.subarray(offset, offset + CHUNK_SIZE).toString('base64');
        statements.push(stmt('INSERT INTO icon_chunks (team_id, chunk_number, bytes) VALUES (?, ?, ?)', teamId, index, bytes));
      }
      statements.push(stmt('UPDATE teams SET icon_path = ? WHERE id = ?', url, teamId));
      await database.batch(statements);
      return url;
    },
    async get(filename, requestedVersion) {
      const match = /^team-(\d+)$/.exec(filename);
      if (!match) return null;
      const id = Number(match[1]);
      const results = await database.batch([
        stmt('SELECT mime_type, version FROM team_icons WHERE team_id = ?', id),
        stmt('SELECT bytes FROM icon_chunks WHERE team_id = ? ORDER BY chunk_number', id),
      ]);
      const metadata = results[0].results[0];
      if (!metadata || (requestedVersion && requestedVersion !== metadata.version)) return null;
      return {
        type: metadata.mime_type,
        bytes: Buffer.concat(results[1].results.map(row => Buffer.from(row.bytes, 'base64'))),
      };
    },
  };
}
