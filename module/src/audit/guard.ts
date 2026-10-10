/* eslint-disable @typescript-eslint/no-explicit-any */
import { AUDIT_JOURNAL_FLAG, AUDIT_NS } from './types.js';

/**
 * Is this document an audit journal, or something inside one? Any journal carrying the flag counts,
 * trusted or not: agents must not read or change the log, and a forged flagged journal gets no
 * exception. Dependency-free so the read tools' visibility rules can use it.
 */
export function isAuditDocument(doc: any): boolean {
  let d = doc;
  for (let i = 0; d && i < 6; i++) {
    if (d.flags?.[AUDIT_NS]?.[AUDIT_JOURNAL_FLAG] === true) return true;
    d = d.parent;
  }
  return false;
}

export class AuditProtectedError extends Error {
  constructor() {
    super('The audit log cannot be read or changed by tools');
    this.name = 'AuditProtectedError';
  }
}

/**
 * The write-side guard. Every write, delete or code tool that touches a document must call this
 * (directly, or through `ctx.snapshot`, which does) before changing it. Throws for the audit journal
 * and its pages.
 */
export function assertNotAudit(doc: any): void {
  if (isAuditDocument(doc)) throw new AuditProtectedError();
}
