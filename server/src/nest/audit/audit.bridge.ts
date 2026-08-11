import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { AuditService } from './audit.service';

/**
 * Non-Nest entry point for the audit domain — pinned by the MCP/OAuth
 * transport (src/mcp/index.ts and oauthProvider.ts), which platform.routes.ts
 * mounts on the Express app BEFORE app.init(), so the container is not
 * available to it. Inside the container, inject AuditService instead; log*-only
 * consumers import audit-log.logger directly. Delete this file when the
 * MCP/OAuth mount moves behind the container.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton.
 */
const audit = new AuditService(new DatabaseService(db));

export function writeAudit(entry: Parameters<AuditService['writeAudit']>[0]): void {
  return audit.writeAudit(entry);
}

export { getClientIp } from './client-ip';
