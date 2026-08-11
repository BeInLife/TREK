import { db } from '../../db/database';
import { AddonsService } from '../addons/addons.service';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { OauthService } from './oauth.service';

/**
 * Non-Nest entry point for the OAuth domain — down to its last consumer: the
 * MCP transport's token verification (src/mcp/index.ts), which
 * platform.routes.ts mounts on the Express app BEFORE app.init(), so
 * `app.get(OauthService)` is not available to it. The SDK provider adapter
 * moved behind the container (oauth-sdk.provider.ts) and dropped the other six
 * exports. Inside the container, inject OauthService instead. Delete this file
 * when the /mcp mount moves behind the container.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton, and getUserByAccessToken touches no
 * module-scoped state beyond it.
 */
const dbs = new DatabaseService(db);
const oauth = new OauthService(dbs, new AddonsService(dbs), new AuditService(dbs));

export function getUserByAccessToken(rawToken: string) {
  return oauth.getUserByAccessToken(rawToken);
}
