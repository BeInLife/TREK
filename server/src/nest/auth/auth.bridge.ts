import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { PermissionsService } from '../permissions/permissions.service';
import { TripMembershipService } from '../trip-membership/trip-membership.service';
import { BudgetService } from '../budget/budget.service';
import { ExchangeRatesService } from '../budget/exchange-rates.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthService } from './auth.service';
import { TokenService } from '../tokens/token.service';
import { MailerService } from '../notifications/mailer/mailer.service';
import { UserCleanupService } from './user-cleanup.service';
import { WebauthnConfigService } from './webauthn-config.service';
import { User } from '../../types';
import { EphemeralTokenService } from './ephemeral-token.service';

/**
 * Non-Nest entry point for the auth domain — pinned by the MCP transport
 * (src/mcp/index.ts token verification), which platform.routes.ts mounts on
 * the Express app BEFORE app.init(), so the container is not available to it.
 * Inside the container, inject AuthService/TokenService instead. Delete this
 * file when the MCP/OAuth mount moves behind the container.
 *
 * Only two exports remain: verifyMcpToken lives on TokenService, but
 * verifyJwtToken is login identity and deliberately stays on AuthService
 * (see token.service.ts), so the whole AuthService collaborator graph below
 * exists to serve that one call. WebauthnConfigService and UserCleanupService
 * (with the BudgetService it injects) are constructed only because AuthService
 * takes them — nothing this file
 * exports reaches either one. The pending-MFA and reset-throttle maps are
 * module-scoped in auth.service.ts, so this instance and the container
 * singleton share one copy.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton (same pattern as permissions.bridge.ts).
 */
const dbs = new DatabaseService(db);
const permissions = new PermissionsService(dbs);
const auth = new AuthService(
  dbs,
  permissions,
  new TripMembershipService(dbs),
  new WebauthnConfigService(dbs),
  new UserCleanupService(dbs, new BudgetService(dbs, permissions, new ExchangeRatesService(), new RealtimeService())),
  new MailerService(dbs),
  new EphemeralTokenService(),
);

const tokens = new TokenService(dbs, new EphemeralTokenService());

export function verifyMcpToken(rawToken: string): User | null {
  return tokens.verifyMcpToken(rawToken);
}

export function verifyJwtToken(token: string): User | null {
  return auth.verifyJwtToken(token);
}
