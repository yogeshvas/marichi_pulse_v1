import { db } from '../db.js';

export function audit(user, action, entity, entityId, meta) {
  db.prepare('INSERT INTO audit (user_id, user_name, action, entity, entity_id, meta) VALUES (?,?,?,?,?,?)')
    .run(user?.id ?? null, user?.name ?? 'system', action, entity ?? null, entityId != null ? String(entityId) : null, meta ? JSON.stringify(meta) : null);
}
