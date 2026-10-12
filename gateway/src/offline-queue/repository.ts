import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { MAX_FRAME_BYTES, type AnnouncedTool } from '@agent-gateway/protocol';
import { LinkCallError } from '../link/registry.js';

export const QUEUE_CONFIG = Object.freeze({
  perOwner: 20,
  global: 500,
  receipts: 1000,
  ttlMs: 7 * 86400000,
  retainMs: 7 * 86400000,
  batch: 5,
  cleanupMs: 60000,
});
export interface QueueOwner {
  worldId: string;
  userId: string;
  agentId: string;
}
export type QueueState =
  'queued' | 'claimed' | 'pending' | 'approved' | 'denied' | 'expired' | 'unknown';
export interface QueueRow {
  id: string;
  world_id: string;
  user_id: string;
  agent_id: string;
  session_id: string;
  tool: string;
  definition: string;
  args: string;
  args_hash: string;
  created_at: number;
  expires_at: number;
  state: QueueState;
  connection_id: string | null;
  result: string | null;
  resolved_at: number | null;
}
const ownerArgs = (o: QueueOwner) => [o.worldId, o.userId, o.agentId];
const scope = 'world_id=? AND user_id=? AND agent_id=?';
export function createQueueRepository(db: DatabaseSync) {
  const tx = <T>(run: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = run();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  const cleanup = (now: number) =>
    tx(() => {
      db.prepare(
        "UPDATE queued_calls SET state='expired',resolved_at=? WHERE state='queued' AND expires_at<=?",
      ).run(now, now);
      db.prepare(
        "UPDATE queued_calls SET state='unknown',result='Queue deadline elapsed after delivery; reconcile before retrying',resolved_at=? WHERE state IN ('claimed','pending') AND expires_at<=?",
      ).run(now, now);
      db.prepare(
        "DELETE FROM queued_calls WHERE state NOT IN ('queued','claimed','pending') AND resolved_at<?",
      ).run(now - QUEUE_CONFIG.retainMs);
    });
  return {
    cleanup,
    recover(now: number) {
      db.prepare(
        "UPDATE queued_calls SET state='unknown',resolved_at=? WHERE state IN ('claimed','pending')",
      ).run(now);
      cleanup(now);
    },
    catalog(o: QueueOwner): readonly AnnouncedTool[] | undefined {
      const r = db
        .prepare(`SELECT tools FROM queued_catalogs WHERE ${scope}`)
        .get(...ownerArgs(o)) as { tools: string } | undefined;
      return r ? JSON.parse(r.tools) : undefined;
    },
    setCatalog(o: QueueOwner, tools: readonly AnnouncedTool[] | undefined) {
      if (!tools) {
        db.prepare(`DELETE FROM queued_catalogs WHERE ${scope}`).run(...ownerArgs(o));
        return;
      }
      db.prepare(
        'INSERT INTO queued_catalogs VALUES(?,?,?,?) ON CONFLICT(world_id,user_id,agent_id) DO UPDATE SET tools=excluded.tools',
      ).run(...ownerArgs(o), JSON.stringify(tools));
    },
    enqueue(
      o: QueueOwner,
      sessionId: string,
      definition: AnnouncedTool,
      args: Record<string, unknown>,
      now: number,
    ): QueueRow {
      const encoded = JSON.stringify(args),
        def = JSON.stringify(definition);
      if (
        Buffer.byteLength(
          JSON.stringify({
            type: 'queuedCalls',
            calls: [
              {
                id: 'x'.repeat(32),
                sessionId,
                tool: definition.name,
                definition,
                args,
                expiresAt: now + QUEUE_CONFIG.ttlMs,
              },
            ],
          }),
        ) > MAX_FRAME_BYTES
      )
        throw new LinkCallError('INVALID_ARGS', 'Queued call exceeds frame limit');
      cleanup(now);
      return tx(() => {
        const count = (sql: string, values: string[] = []) =>
          Number((db.prepare(sql).get(...values) as { n: number }).n);
        if (
          count(
            `SELECT COUNT(*) n FROM queued_calls WHERE ${scope} AND state IN ('queued','claimed','pending')`,
            ownerArgs(o),
          ) >= QUEUE_CONFIG.perOwner ||
          count(
            "SELECT COUNT(*) n FROM queued_calls WHERE state IN ('queued','claimed','pending')",
          ) >= QUEUE_CONFIG.global ||
          count('SELECT COUNT(*) n FROM queued_calls') >= QUEUE_CONFIG.receipts
        )
          throw new LinkCallError('RATE_LIMITED', 'Offline queue capacity reached');
        const id = randomBytes(24).toString('base64url');
        db.prepare(
          'INSERT INTO queued_calls(id,world_id,user_id,agent_id,session_id,tool,definition,args,args_hash,created_at,expires_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
          id,
          ...ownerArgs(o),
          sessionId,
          definition.name,
          def,
          encoded,
          createHash('sha256').update(encoded).digest('hex'),
          now,
          now + QUEUE_CONFIG.ttlMs,
          'queued',
        );
        return db.prepare('SELECT * FROM queued_calls WHERE id=?').get(id) as unknown as QueueRow;
      });
    },
    get(o: QueueOwner, id: string): QueueRow | undefined {
      return db
        .prepare(`SELECT * FROM queued_calls WHERE ${scope} AND id=?`)
        .get(...ownerArgs(o), id) as unknown as QueueRow | undefined;
    },
    queued(o: QueueOwner, limit: number = QUEUE_CONFIG.batch): QueueRow[] {
      return db
        .prepare(
          `SELECT * FROM queued_calls WHERE ${scope} AND state='queued' ORDER BY created_at,id LIMIT ?`,
        )
        .all(...ownerArgs(o), Math.min(QUEUE_CONFIG.perOwner, limit)) as unknown as QueueRow[];
    },
    claim(o: QueueOwner, id: string, connectionId: string): boolean {
      return (
        Number(
          db
            .prepare(
              `UPDATE queued_calls SET state='claimed',connection_id=? WHERE ${scope} AND id=? AND state='queued'`,
            )
            .run(connectionId, ...ownerArgs(o), id).changes,
        ) === 1
      );
    },
    reject(o: QueueOwner, id: string, now: number) {
      db.prepare(
        `UPDATE queued_calls SET state='denied',result='Tool definition no longer matches queued intent',resolved_at=? WHERE ${scope} AND id=? AND state='queued'`,
      ).run(now, ...ownerArgs(o), id);
    },
    status(
      o: QueueOwner,
      id: string,
      connectionId: string,
      state: Exclude<QueueState, 'queued' | 'claimed'>,
      result: string,
      now: number,
    ): boolean {
      const row = db
        .prepare(`SELECT * FROM queued_calls WHERE ${scope} AND id=? AND connection_id=?`)
        .get(...ownerArgs(o), id, connectionId) as unknown as QueueRow | undefined;
      if (!row) return false;
      if (!['claimed', 'pending'].includes(row.state)) return true; // A reordered/duplicate reply cannot rewrite a terminal receipt.
      if (now >= row.expires_at && (state === 'approved' || state === 'pending')) {
        db.prepare("UPDATE queued_calls SET state='unknown',resolved_at=? WHERE id=?").run(now, id);
        return true;
      }
      return (
        Number(
          db
            .prepare(
              `UPDATE queued_calls SET state=?,result=?,resolved_at=? WHERE ${scope} AND id=? AND connection_id=? AND state IN ('claimed','pending')`,
            )
            .run(
              state,
              result.slice(0, 4000),
              state === 'pending' ? null : now,
              ...ownerArgs(o),
              id,
              connectionId,
            ).changes,
        ) === 1
      );
    },
    disconnected(connectionId: string, now: number) {
      db.prepare(
        "UPDATE queued_calls SET state='unknown',resolved_at=? WHERE connection_id=? AND state IN ('claimed','pending')",
      ).run(now, connectionId);
    },
  };
}
export type QueueRepository = ReturnType<typeof createQueueRepository>;
