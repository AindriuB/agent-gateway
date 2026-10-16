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
  result_failed: 0 | 1 | null;
  resolved_at: number | null;
  /** The module's approval id when this row mirrors a live approval (task 112). */
  approval_alias: string | null;
  /** The module's last report for the alias. */
  alias_report: 'pending' | 'approved' | 'denied' | 'expired' | null;
  /** Set when the requester's link closed; the row is then answered from here, not the module. */
  orphaned_at: number | null;
}
const ownerArgs = (o: QueueOwner) => [o.worldId, o.userId, o.agentId];
const scope = 'world_id=? AND user_id=? AND agent_id=?';
/** A mirrored approval whose requester's link is gone: still pending, attached to no connection. */
const ORPHAN =
  "approval_alias IS NOT NULL AND orphaned_at IS NOT NULL AND connection_id IS NULL AND state='pending'";
/** A mirrored approval still attached to a live requester connection. */
const LIVE_ALIAS = 'approval_alias IS NOT NULL AND orphaned_at IS NULL';
export const hashArgs = (encoded: string) => createHash('sha256').update(encoded).digest('hex');
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

  /**
   * The requester's link is gone: a mirrored approval last reported `pending` becomes an orphan
   * (still pending, no connection); one reported `approved` may have run, so it is `unknown`.
   * With no connection id this sweeps every live mirrored row (gateway start).
   */
  const orphanLive = (now: number, connectionId?: string) => {
    const by = connectionId === undefined ? '' : ' AND connection_id=?';
    const extra = connectionId === undefined ? [] : [connectionId];
    db.prepare(
      `UPDATE queued_calls SET state='unknown',resolved_at=COALESCE(resolved_at,?),orphaned_at=?,connection_id=NULL WHERE ${LIVE_ALIAS} AND state IN ('pending','unknown') AND alias_report='approved'${by}`,
    ).run(now, now, ...extra);
    db.prepare(
      `UPDATE queued_calls SET orphaned_at=?,connection_id=NULL WHERE ${LIVE_ALIAS} AND state='pending'${by}`,
    ).run(now, ...extra);
  };
  return {
    cleanup,
    orphanLive,
    recover(now: number) {
      db.prepare(
        `UPDATE queued_calls SET state='unknown',resolved_at=? WHERE state IN ('claimed','pending') AND NOT (${ORPHAN} AND alias_report='pending')`,
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
      resultFailed?: boolean,
    ): boolean {
      if (resultFailed !== undefined && (typeof resultFailed !== 'boolean' || state !== 'approved'))
        throw new LinkCallError('INVALID_ARGS', 'Invalid queued execution failure flag');
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
              `UPDATE queued_calls SET state=?,result=?,result_failed=?,resolved_at=? WHERE ${scope} AND id=? AND connection_id=? AND state IN ('claimed','pending')`,
            )
            .run(
              state,
              result.slice(0, 4000),
              resultFailed === undefined ? null : Number(resultFailed),
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
        `UPDATE queued_calls SET state='unknown',resolved_at=? WHERE connection_id=? AND state IN ('claimed','pending') AND NOT (${LIVE_ALIAS})`,
      ).run(now, connectionId);
      orphanLive(now, connectionId);
    },
    /** An orphan past its deadline is `expired` and is never replayed. */
    expireOrphans(now: number) {
      db.prepare(
        `UPDATE queued_calls SET state='expired',resolved_at=? WHERE ${ORPHAN} AND expires_at<=?`,
      ).run(now, now);
    },
    getByAlias(o: QueueOwner, alias: string): QueueRow | undefined {
      return db
        .prepare(`SELECT * FROM queued_calls WHERE ${scope} AND approval_alias=?`)
        .get(...ownerArgs(o), alias) as unknown as QueueRow | undefined;
    },
    /** An orphaned or requeued mirrored row for the same call, so an offline retry reuses it. */
    findOpenAlias(o: QueueOwner, tool: string, argsHash: string): QueueRow | undefined {
      return db
        .prepare(
          `SELECT * FROM queued_calls WHERE ${scope} AND tool=? AND args_hash=? AND approval_alias IS NOT NULL AND orphaned_at IS NOT NULL AND state IN ('pending','queued','claimed') ORDER BY created_at,id LIMIT 1`,
        )
        .get(...ownerArgs(o), tool, argsHash) as unknown as QueueRow | undefined;
    },
    /**
     * Mirror a live approval. A second call with the same alias returns the first row. `connectionId`
     * null records it already orphaned (the link closed while the call was returning).
     */
    insertAlias(
      o: QueueOwner,
      sessionId: string,
      definition: AnnouncedTool,
      args: Record<string, unknown>,
      alias: string,
      connectionId: string | null,
      now: number,
    ): QueueRow {
      const encoded = JSON.stringify(args);
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
      return tx(() => {
        const existing = db
          .prepare(`SELECT * FROM queued_calls WHERE ${scope} AND approval_alias=?`)
          .get(...ownerArgs(o), alias) as unknown as QueueRow | undefined;
        if (existing) return existing;
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
          "INSERT INTO queued_calls(id,world_id,user_id,agent_id,session_id,tool,definition,args,args_hash,created_at,expires_at,state,connection_id,approval_alias,alias_report,orphaned_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,'pending',?)",
        ).run(
          id,
          ...ownerArgs(o),
          sessionId,
          definition.name,
          JSON.stringify(definition),
          encoded,
          hashArgs(encoded),
          now,
          now + QUEUE_CONFIG.ttlMs,
          connectionId,
          alias,
          connectionId === null ? now : null,
        );
        return db.prepare('SELECT * FROM queued_calls WHERE id=?').get(id) as unknown as QueueRow;
      });
    },
    /** Record the module's report for an alias held by this owner on this live connection. */
    report(
      o: QueueOwner,
      connectionId: string,
      alias: string,
      state: 'pending' | 'approved' | 'denied' | 'expired',
      now: number,
    ): boolean {
      const where = `${scope} AND approval_alias=? AND connection_id=? AND state='pending' AND orphaned_at IS NULL AND alias_report='pending'`;
      const args = [...ownerArgs(o), alias, connectionId];
      // Approved, denied and expired all leave the live set at once. An approved row may have
      // run, so it is `unknown` (never requeued) and stops counting against the queue caps.
      const changes =
        state === 'pending'
          ? db.prepare(`UPDATE queued_calls SET alias_report=? WHERE ${where}`).run(state, ...args)
              .changes
          : db
              .prepare(
                `UPDATE queued_calls SET alias_report=?,state=?,resolved_at=? WHERE ${where}`,
              )
              .run(state, state === 'approved' ? 'unknown' : state, now, ...args).changes;
      return Number(changes) === 1;
    },
    /** The listed aliases this owner's connection holds live and still pending (task 112). */
    ownedAliases(o: QueueOwner, connectionId: string, ids: readonly string[]): string[] {
      if (!ids.length) return [];
      const marks = ids.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT approval_alias a FROM queued_calls WHERE ${scope} AND connection_id=? AND state='pending' AND orphaned_at IS NULL AND approval_alias IN (${marks})`,
        )
        .all(...ownerArgs(o), connectionId, ...ids) as unknown as { a: string }[];
      return rows.map((r) => r.a);
    },
    /** The listed aliases for which this owner has no row at all (never mirrored). */
    unknownAliases(o: QueueOwner, ids: readonly string[]): string[] {
      if (!ids.length) return [];
      const marks = ids.map(() => '?').join(',');
      const known = new Set(
        (
          db
            .prepare(
              `SELECT approval_alias a FROM queued_calls WHERE ${scope} AND approval_alias IN (${marks})`,
            )
            .all(...ownerArgs(o), ...ids) as unknown as { a: string }[]
        ).map((r) => r.a),
      );
      return ids.filter((id) => !known.has(id));
    },
    /** Apply a held report to a row that was inserted already orphaned. */
    reportOrphan(
      o: QueueOwner,
      alias: string,
      state: 'approved' | 'denied' | 'expired',
      now: number,
    ): boolean {
      return (
        Number(
          db
            .prepare(
              `UPDATE queued_calls SET alias_report=?,state=?,resolved_at=? WHERE ${scope} AND approval_alias=? AND ${ORPHAN} AND alias_report='pending'`,
            )
            .run(state, state === 'approved' ? 'unknown' : state, now, ...ownerArgs(o), alias)
            .changes,
        ) === 1
      );
    },
    /**
     * The owner's new capable connection sent its pending list. Mirrored rows without a live
     * connection come back to life if the module still holds them, and are requeued otherwise (the
     * module asks again). Rows being replayed (connection set, orphaned) are never touched.
     */
    reconcile(o: QueueOwner, connectionId: string, ids: ReadonlySet<string>, now: number) {
      tx(() => {
        const rows = db
          .prepare(
            `SELECT * FROM queued_calls WHERE ${scope} AND approval_alias IS NOT NULL AND state='pending' AND (orphaned_at IS NULL OR connection_id IS NULL) AND (connection_id IS NULL OR connection_id<>?)`,
          )
          .all(...ownerArgs(o), connectionId) as unknown as QueueRow[];
        for (const row of rows) {
          if (row.expires_at <= now) continue;
          if (row.alias_report === 'approved')
            db.prepare(
              "UPDATE queued_calls SET state='unknown',resolved_at=?,orphaned_at=?,connection_id=NULL WHERE id=?",
            ).run(now, row.orphaned_at ?? now, row.id);
          else if (ids.has(row.approval_alias!))
            db.prepare('UPDATE queued_calls SET connection_id=?,orphaned_at=NULL WHERE id=?').run(
              connectionId,
              row.id,
            );
          else
            db.prepare(
              "UPDATE queued_calls SET state='queued',connection_id=NULL,orphaned_at=? WHERE id=?",
            ).run(row.orphaned_at ?? now, row.id);
        }
      });
    },
  };
}
export type QueueRepository = ReturnType<typeof createQueueRepository>;
