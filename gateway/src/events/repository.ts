import type { DatabaseSync } from 'node:sqlite';
import {
  AgentEvent,
  GatewayGap,
  BufferedEvent,
  EVENT_BUFFER_CONFIG,
  type EventReadOutput,
} from '@agent-gateway/protocol';
export interface EventOwner {
  worldId: string;
  userId: string;
  agentId: string;
}
export type StoredEvent = BufferedEvent['event'];
export interface OfflineEventPolicy {
  enabled: boolean;
  retentionDays: number;
}
export interface EventRepository {
  policy(worldId: string): OfflineEventPolicy;
  setPolicy(worldId: string, policy: OfflineEventPolicy): void;
  readAllowed(owner: EventOwner): boolean;
  setReadAllowed(owner: EventOwner, allowed: boolean): void;
  purge(worldId: string): number;
  retain(now: number): number;
  append(owner: EventOwner, event: StoredEvent, receivedAt: number): BufferedEvent;
  read(owner: EventOwner, after: number | undefined, limit: number): EventReadOutput;
  history(
    owner: EventOwner,
    since: number,
    types: readonly string[] | undefined,
    limit: number,
  ): EventReadOutput;
  hasStream(owner: EventOwner): boolean;
  ensureStream(owner: EventOwner): boolean;
}
export class EventCursorError extends Error {}
/** Owns SQL operations; the raw database never escapes the Store. */
export function createEventRepository(db: DatabaseSync): EventRepository {
  const args = (o: EventOwner) => [o.worldId, o.userId, o.agentId];
  const latest = db.prepare('SELECT next_cursor FROM event_streams WHERE world_id=? AND user_id=?');
  const decode = (rows: Array<{ cursor: number; payload: string }>) =>
    rows.map((r) => BufferedEvent.parse({ cursor: r.cursor, event: JSON.parse(r.payload) }));
  const checkedLimit = (limit: number) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new EventCursorError('Invalid event limit');
  };
  const remove = (where: string, values: (string | number)[]) => {
    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO event_evictions(world_id,user_id,agent_id,last_evicted)
        SELECT world_id,user_id,agent_id,MAX(cursor) FROM event_rows WHERE ${where}
        GROUP BY world_id,user_id,agent_id ON CONFLICT(world_id,user_id,agent_id)
        DO UPDATE SET last_evicted=MAX(last_evicted,excluded.last_evicted)`,
      ).run(...values);
      const count = Number(
        db.prepare(`DELETE FROM event_rows WHERE ${where}`).run(...values).changes,
      );
      db.exec('COMMIT');
      return count;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  return {
    policy(worldId) {
      const row = db
        .prepare('SELECT enabled,retention_days FROM event_policies WHERE world_id=?')
        .get(worldId);
      return row
        ? { enabled: row.enabled === 1, retentionDays: Number(row.retention_days) }
        : { enabled: false, retentionDays: 14 };
    },
    setPolicy(worldId, policy) {
      if (
        !worldId ||
        worldId.length > 100 ||
        typeof policy.enabled !== 'boolean' ||
        !Number.isInteger(policy.retentionDays) ||
        policy.retentionDays < 1 ||
        policy.retentionDays > 365
      )
        throw Error('Invalid bounded offline event policy');
      db.prepare(
        `INSERT INTO event_policies(world_id,enabled,retention_days) VALUES (?,?,?)
        ON CONFLICT(world_id) DO UPDATE SET enabled=excluded.enabled,retention_days=excluded.retention_days`,
      ).run(worldId, policy.enabled ? 1 : 0, policy.retentionDays);
    },
    readAllowed(o) {
      return (
        db
          .prepare(
            'SELECT allowed FROM event_read_permissions WHERE world_id=? AND user_id=? AND agent_id=?',
          )
          .get(...args(o))?.allowed === 1
      );
    },
    setReadAllowed(o, allowed) {
      db.prepare(
        `INSERT INTO event_read_permissions(world_id,user_id,agent_id,allowed) VALUES (?,?,?,?)
        ON CONFLICT(world_id,user_id,agent_id) DO UPDATE SET allowed=excluded.allowed`,
      ).run(...args(o), allowed === true ? 1 : 0);
    },
    purge(worldId) {
      return remove('world_id=?', [worldId]);
    },
    retain(now) {
      if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid retention clock');
      return remove(
        `received_at < ? - 86400000 * COALESCE((SELECT retention_days FROM event_policies WHERE event_policies.world_id=event_rows.world_id),14)`,
        [now],
      );
    },
    ensureStream(o) {
      return (
        Number(
          db
            .prepare('INSERT OR IGNORE INTO event_streams(world_id,user_id) VALUES (?,?)')
            .run(o.worldId, o.userId).changes,
        ) === 0
      );
    },
    hasStream(o) {
      return !!latest.get(o.worldId, o.userId);
    },
    append(o, event, receivedAt) {
      const parsed =
        event.type === 'gap' && !('seq' in event)
          ? GatewayGap.parse(event)
          : AgentEvent.parse(event);
      if (parsed.userId !== o.userId || !Number.isSafeInteger(receivedAt) || receivedAt < 0)
        throw new Error('Invalid authenticated event');
      const payload = JSON.stringify(parsed);
      db.exec('BEGIN');
      try {
        db.prepare('INSERT OR IGNORE INTO event_streams(world_id,user_id) VALUES (?,?)').run(
          o.worldId,
          o.userId,
        );
        const cursor = (latest.get(o.worldId, o.userId) as { next_cursor: number }).next_cursor;
        if (!Number.isSafeInteger(cursor) || cursor >= Number.MAX_SAFE_INTEGER)
          throw new EventCursorError('Event cursor exhausted');
        db.prepare(
          'INSERT INTO event_rows(world_id,user_id,agent_id,cursor,received_at,event_type,payload) VALUES (?,?,?,?,?,?,?)',
        ).run(...args(o), cursor, receivedAt, parsed.type, payload);
        db.prepare('UPDATE event_streams SET next_cursor=? WHERE world_id=? AND user_id=?').run(
          cursor + 1,
          o.worldId,
          o.userId,
        );
        db.prepare(
          'INSERT INTO event_evictions(world_id,user_id,agent_id,last_evicted) SELECT world_id,user_id,agent_id,MAX(cursor) FROM event_rows WHERE world_id=? AND user_id=? AND cursor<=? GROUP BY world_id,user_id,agent_id ON CONFLICT(world_id,user_id,agent_id) DO UPDATE SET last_evicted=MAX(last_evicted,excluded.last_evicted)',
        ).run(o.worldId, o.userId, cursor - EVENT_BUFFER_CONFIG.EVENT_BUFFER_SIZE);
        db.prepare('DELETE FROM event_rows WHERE world_id=? AND user_id=? AND cursor<=?').run(
          o.worldId,
          o.userId,
          cursor - EVENT_BUFFER_CONFIG.EVENT_BUFFER_SIZE,
        );
        db.exec('COMMIT');
        return { cursor, event: parsed };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    read(o, after, limit) {
      checkedLimit(limit);
      const last =
        ((latest.get(o.worldId, o.userId) as { next_cursor: number } | undefined)?.next_cursor ??
          1) - 1;
      if (after !== undefined && (!Number.isSafeInteger(after) || after < 0 || after > last))
        throw new EventCursorError('Invalid or future event cursor');
      const floor = (
        db
          .prepare(
            'SELECT MIN(cursor) AS floor FROM event_rows WHERE world_id=? AND user_id=? AND agent_id=?',
          )
          .get(...args(o)) as { floor: number | null }
      ).floor;
      const evicted = (
        db
          .prepare(
            'SELECT last_evicted FROM event_evictions WHERE world_id=? AND user_id=? AND agent_id=?',
          )
          .get(...args(o)) as { last_evicted: number } | undefined
      )?.last_evicted;
      const events = decode(
        db
          .prepare(
            'SELECT cursor,payload FROM event_rows WHERE world_id=? AND user_id=? AND agent_id=? AND cursor>? ORDER BY cursor LIMIT ?',
          )
          .all(...args(o), after ?? 0, limit) as Array<{ cursor: number; payload: string }>,
      );
      const gap = after !== undefined && evicted !== undefined && after < evicted;
      return {
        events,
        nextAfter: events.at(-1)?.cursor ?? (gap ? evicted : (after ?? 0)),
        ...(gap ? { cursorGap: { after, firstAvailable: floor ?? evicted + 1 } } : {}),
      };
    },
    history(o, since, types, limit) {
      checkedLimit(limit);
      if (!Number.isSafeInteger(since) || since < 0 || (types && types.length > 32))
        throw new EventCursorError('Invalid history filter');
      const filter = types
        ? ` AND event_type IN (${types.map(() => '?').join(',') || 'NULL'})`
        : '';
      const events = decode(
        db
          .prepare(
            'SELECT cursor,payload FROM event_rows WHERE world_id=? AND user_id=? AND agent_id=? AND received_at>=?' +
              filter +
              ' ORDER BY cursor LIMIT ?',
          )
          .all(...args(o), since, ...(types ?? []), limit) as Array<{
          cursor: number;
          payload: string;
        }>,
      );
      const retained = this.read(o, 0, 1);
      return {
        events,
        nextAfter: events.at(-1)?.cursor ?? retained.nextAfter,
        ...(retained.cursorGap ? { cursorGap: retained.cursorGap } : {}),
      };
    },
  };
}
