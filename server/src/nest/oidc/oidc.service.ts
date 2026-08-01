import { Injectable, OnModuleDestroy } from '@nestjs/common';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { readEnv, getAppUrl } from '../../app-config';
import { JWT_SECRET, SESSION_DURATION_SECONDS } from '../../config';
import { User } from '../../types';
import { decrypt_api_key } from '../../services/apiKeyCrypto';
import { joinTripAsMember } from '../../services/tripMembership';
import { setAuthCookie } from '../../services/cookie';
import { AuthService } from '../auth/auth.service';
import { DatabaseService } from '../database/database.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OidcDiscoveryDoc {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri?: string;
  issuer?: string;
  _issuer?: string;
}

export interface OidcTokenResponse {
  access_token?: string;
  id_token?: string;
  token_type?: string;
}

export interface OidcUserInfo {
  sub: string;
  email?: string;
  // Standard OIDC claim. Some IdPs send it as the string "true"/"false".
  email_verified?: boolean | string;
  name?: string;
  preferred_username?: string;
  // Standard OIDC profile claim: URL of the user's profile picture.
  picture?: string;
  groups?: string[];
  roles?: string[];
  [key: string]: unknown;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  displayName: string;
  discoveryUrl: string | null;
}

// ---------------------------------------------------------------------------
// Constants / TTLs
// ---------------------------------------------------------------------------

const AUTH_CODE_TTL = 60000;          // 1 minute
const AUTH_CODE_CLEANUP = 30000;      // 30 seconds
const STATE_TTL = 5 * 60 * 1000;     // 5 minutes
const STATE_CLEANUP = 60 * 1000;      // 1 minute
const DISCOVERY_TTL = 60 * 60 * 1000; // 1 hour

// 5 minute JWKS cache — short enough to pick up key rotation within a
// reasonable window, long enough that normal login flow doesn't fetch
// JWKS on every callback.
const JWKS_TTL_MS = 5 * 60 * 1000;
type JwksEntry = { keys: Array<Record<string, unknown>>; fetchedAt: number };

// ---------------------------------------------------------------------------
// Module-private pure helpers
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

// Sanitize the OIDC `picture` claim before we store it as the avatar. Only https
// URLs are usable: the app's CSP allows https image sources but not http, and we
// render the value directly. Non-strings, non-https and oversized values (e.g. a
// large data: URI) are ignored so a user payload never carries junk. #1399
function safeOidcPicture(picture: unknown): string | null {
  if (typeof picture !== 'string') return null;
  const url = picture.trim();
  if (!url || url.length > 1024) return null;
  return /^https:\/\//i.test(url) ? url : null;
}

/**
 * DI-native OIDC service — the legacy services/oidcService.ts folded in whole
 * (pure relocation): PKCE state, discovery, the strict id_token/JWKS
 * verification, user provisioning and the auth-code hand-off, all over the
 * injected DatabaseService, with the resolveAuthToggles bridge import replaced
 * by the injected AuthService.
 *
 * The legacy module-level state (pending-state / auth-code maps and their two
 * sweep intervals, the discovery cache, the JWKS cache) lives on the instance:
 * nothing outside the container consumes this domain, so no bridge needs to
 * share it. The sweepers start in the constructor (legacy started them at
 * import) and are cleared in onModuleDestroy.
 */
@Injectable()
export class OidcService implements OnModuleDestroy {
  // -------------------------------------------------------------------------
  // State management – pending OIDC states
  // -------------------------------------------------------------------------

  private readonly pendingStates = new Map<string, { createdAt: number; redirectUri: string; inviteToken?: string; codeVerifier: string }>();

  // -------------------------------------------------------------------------
  // Auth code management – short-lived codes exchanged for JWT
  // -------------------------------------------------------------------------

  private readonly authCodes = new Map<string, { token: string; created: number }>();

  // Discovery document cache (1 h TTL)
  private discoveryCache: OidcDiscoveryDoc | null = null;
  private discoveryCacheTime = 0;

  private readonly jwksCache = new Map<string, JwksEntry>();

  private readonly stateSweeper: NodeJS.Timeout;
  private readonly codeSweeper: NodeJS.Timeout;

  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
  ) {
    this.stateSweeper = setInterval(() => {
      const now = Date.now();
      for (const [state, data] of this.pendingStates) {
        if (now - data.createdAt > STATE_TTL) this.pendingStates.delete(state);
      }
    }, STATE_CLEANUP);
    this.codeSweeper = setInterval(() => {
      const now = Date.now();
      for (const [code, entry] of this.authCodes) {
        if (now - entry.created > AUTH_CODE_TTL) this.authCodes.delete(code);
      }
    }, AUTH_CODE_CLEANUP);
  }

  onModuleDestroy(): void {
    clearInterval(this.stateSweeper);
    clearInterval(this.codeSweeper);
  }

  oidcLoginEnabled(): boolean { return this.auth.resolveAuthToggles().oidc_login; }

  getAppUrl() { return getAppUrl(); }

  setAuthCookie(res: Response, token: string, req: Request) { setAuthCookie(res, token, req); }

  // Creates the login state and a matching PKCE pair. The verifier stays server
  // side (in pendingStates); the S256 challenge goes to the provider so PKCE-
  // required setups (e.g. Pocket ID with PKCE = required) work.
  createState(redirectUri: string, inviteToken?: string): { state: string; codeChallenge: string } {
    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    this.pendingStates.set(state, { createdAt: Date.now(), redirectUri, inviteToken, codeVerifier });
    return { state, codeChallenge };
  }

  consumeState(state: string) {
    const pending = this.pendingStates.get(state);
    if (!pending) return null;
    this.pendingStates.delete(state);
    return pending;
  }

  createAuthCode(token: string): string {
    const { v4: uuidv4 } = require('uuid');
    const authCode: string = uuidv4();
    this.authCodes.set(authCode, { token, created: Date.now() });
    return authCode;
  }

  consumeAuthCode(code: string): { token: string } | { error: string } {
    const entry = this.authCodes.get(code);
    if (!entry) return { error: 'Invalid or expired code' };
    this.authCodes.delete(code);
    if (Date.now() - entry.created > AUTH_CODE_TTL) return { error: 'Code expired' };
    return { token: entry.token };
  }

  // -------------------------------------------------------------------------
  // OIDC configuration (env + DB)
  // -------------------------------------------------------------------------

  getOidcConfig(): OidcConfig | null {
    const get = (key: string) =>
      (this.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value || null;

    const oidcEnv = readEnv().oidc;
    const issuer = oidcEnv.issuer || get('oidc_issuer');
    const clientId = oidcEnv.clientId || get('oidc_client_id');
    const clientSecret = oidcEnv.clientSecret || decrypt_api_key(get('oidc_client_secret'));
    const displayName = oidcEnv.displayName || get('oidc_display_name') || 'SSO';
    const discoveryUrl = oidcEnv.discoveryUrl || get('oidc_discovery_url') || null;

    if (!issuer || !clientId || !clientSecret) return null;
    return { issuer: issuer.replace(/\/+$/, ''), clientId, clientSecret, displayName, discoveryUrl };
  }

  // -------------------------------------------------------------------------
  // Discovery document (cached, 1 h TTL)
  // -------------------------------------------------------------------------

  async discover(issuer: string, discoveryUrl?: string | null): Promise<OidcDiscoveryDoc> {
    const url = discoveryUrl || `${issuer}/.well-known/openid-configuration`;
    if (this.discoveryCache && Date.now() - this.discoveryCacheTime < DISCOVERY_TTL && this.discoveryCache._issuer === url) {
      return this.discoveryCache;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch OIDC discovery document');
    const doc = (await res.json()) as OidcDiscoveryDoc;
    // Validate that the discovery doc's issuer matches the operator-configured one.
    // When no custom discoveryUrl is set, a mismatch signals a MITM or misconfiguration
    // and we reject. When the operator explicitly overrides the discovery URL (e.g.
    // Authentik realm paths), the discovery doc's issuer is the canonical value —
    // trust it and warn rather than blocking login.
    const docIssuer = doc.issuer?.replace(/\/+$/, '') ?? '';
    if (docIssuer && docIssuer !== issuer) {
      if (discoveryUrl) {
        console.warn(
          `[OIDC] Discovery doc issuer "${doc.issuer}" differs from configured OIDC_ISSUER "${issuer}". ` +
          `Using discovery doc issuer for id_token verification (custom OIDC_DISCOVERY_URL is set).`,
        );
      } else {
        throw new Error(`OIDC discovery issuer mismatch: expected "${issuer}", got "${doc.issuer}"`);
      }
    }
    doc._issuer = url;
    this.discoveryCache = doc;
    this.discoveryCacheTime = Date.now();
    return doc;
  }

  // -------------------------------------------------------------------------
  // Role resolution via OIDC claims
  // -------------------------------------------------------------------------

  resolveOidcRole(userInfo: OidcUserInfo, isFirstUser: boolean): 'admin' | 'user' {
    if (isFirstUser) return 'admin';
    const adminValue = readEnv().oidc.adminValue;
    if (!adminValue) return 'user';
    const claimKey = readEnv().oidc.adminClaim;
    const claimData = userInfo[claimKey];
    if (Array.isArray(claimData)) {
      return claimData.some((v) => String(v) === adminValue) ? 'admin' : 'user';
    }
    if (typeof claimData === 'string') {
      return claimData === adminValue ? 'admin' : 'user';
    }
    return 'user';
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  frontendUrl(path: string): string {
    // Case-sensitive on purpose (legacy parity).
    const base = readEnv().app.nodeEnv === 'production' ? '' : 'http://localhost:5173';
    return base + path;
  }

  generateToken(user: { id: number }): string {
    // Embed the current password_version so an OIDC-issued session is invalidated
    // by a password change/reset exactly like a password-login session (the auth
    // middleware compares this `pv` against users.password_version).
    const pv = (this.db.prepare('SELECT password_version FROM users WHERE id = ?').get(user.id) as { password_version?: number } | undefined)?.password_version ?? 0;
    return jwt.sign({ id: user.id, pv }, JWT_SECRET, { expiresIn: SESSION_DURATION_SECONDS, algorithm: 'HS256' });
  }

  // -------------------------------------------------------------------------
  // Token exchange with OIDC provider
  // -------------------------------------------------------------------------

  async exchangeCodeForToken(
    doc: OidcDiscoveryDoc,
    code: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string,
    codeVerifier?: string,
  ): Promise<OidcTokenResponse & { _ok: boolean; _status: number }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (codeVerifier) body.set('code_verifier', codeVerifier);
    const tokenRes = await fetch(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokenData = (await tokenRes.json()) as OidcTokenResponse;
    return { ...tokenData, _ok: tokenRes.ok, _status: tokenRes.status };
  }

  // -------------------------------------------------------------------------
  // Fetch userinfo from OIDC provider
  // -------------------------------------------------------------------------

  async getUserInfo(userinfoEndpoint: string, accessToken: string): Promise<OidcUserInfo> {
    const res = await fetch(userinfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return (await res.json()) as OidcUserInfo;
  }

  // -------------------------------------------------------------------------
  // id_token verification (signature + iss + aud + exp)
  // -------------------------------------------------------------------------

  private async fetchJwks(jwksUri: string): Promise<Array<Record<string, unknown>>> {
    const cached = this.jwksCache.get(jwksUri);
    if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
    const res = await fetch(jwksUri);
    if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
    const json = (await res.json()) as { keys?: Array<Record<string, unknown>> };
    const keys = json.keys ?? [];
    this.jwksCache.set(jwksUri, { keys, fetchedAt: Date.now() });
    return keys;
  }

  /**
   * Verify an OIDC id_token end-to-end: signature against the provider's
   * JWKS, issuer match, audience match, and exp/nbf. Does NOT verify a
   * nonce — the server doesn't currently send one in the auth request;
   * when that's added, pass the expected nonce here and check `claims.nonce`.
   *
   * Returning the claims lets callers cross-check `sub` / `email` against
   * the userinfo response. A mismatch would mean the provider's userinfo
   * endpoint is speaking for a different subject than the id_token — a
   * classic IdP-side compromise signal worth refusing login over.
   */
  async verifyIdToken(
    idToken: string,
    doc: OidcDiscoveryDoc,
    clientId: string,
    expectedIssuer: string,
  ): Promise<{ ok: true; claims: Record<string, unknown> } | { ok: false; error: string }> {
    if (!doc.jwks_uri) return { ok: false, error: 'no_jwks_uri' };
    const parts = idToken.split('.');
    if (parts.length !== 3) return { ok: false, error: 'malformed_token' };

    let header: { kid?: string; alg?: string };
    try { header = JSON.parse(base64UrlDecode(parts[0]!).toString('utf8')); }
    catch { return { ok: false, error: 'bad_header' }; }

    const alg = header.alg;
    if (!alg || !/^(RS256|RS384|RS512|ES256|ES384|ES512|PS256|PS384|PS512)$/.test(alg)) {
      return { ok: false, error: 'unsupported_alg' };
    }

    let keys: Array<Record<string, unknown>>;
    try { keys = await this.fetchJwks(doc.jwks_uri); }
    catch (e) { return { ok: false, error: 'jwks_fetch_failed' }; }

    // When the token carries a `kid`, refuse to fall back to any other
    // key in the JWKS — a mismatch means the token was signed with a key
    // the provider no longer publishes, and we should reject rather than
    // mask the failure by trying another key.
    const jwk = header.kid
      ? keys.find((k) => k['kid'] === header.kid)
      : keys[0];
    if (!jwk) return { ok: false, error: 'no_matching_key' };

    let publicKey;
    try {
      // Node 16+ understands JWK directly; no PEM conversion library needed.
      // Node's crypto accepts a JWK object directly as `{ key, format: 'jwk' }`.
      // The type signature isn't strict on our TS config so we cast through any.
      publicKey = crypto.createPublicKey({ key: jwk as any, format: 'jwk' });
    } catch {
      return { ok: false, error: 'key_import_failed' };
    }

    let claims: Record<string, unknown>;
    try {
      const verified = jwt.verify(idToken, publicKey, {
        algorithms: [alg as jwt.Algorithm],
        audience: clientId,
      });
      claims = typeof verified === 'string' ? {} : (verified as Record<string, unknown>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'verify_failed';
      return { ok: false, error: `signature_or_claim_mismatch: ${msg}` };
    }

    // Normalize trailing slash before issuer comparison — some IdPs (e.g. Authentik)
    // include a trailing slash in the id_token iss claim.
    const tokenIssuer = typeof claims['iss'] === 'string' ? claims['iss'].replace(/\/+$/, '') : '';
    if (tokenIssuer !== expectedIssuer) {
      return { ok: false, error: `signature_or_claim_mismatch: jwt issuer invalid. expected: ${expectedIssuer}` };
    }

    return { ok: true, claims };
  }

  // -------------------------------------------------------------------------
  // Find or create user by OIDC sub / email
  // -------------------------------------------------------------------------

  findOrCreateUser(
    userInfo: OidcUserInfo,
    config: OidcConfig,
    inviteToken?: string,
  ): { user: User } | { error: string } {
    const email = userInfo.email!.trim().toLowerCase();
    const name = userInfo.name || userInfo.preferred_username || email.split('@')[0];
    const sub = userInfo.sub;
    const picture = safeOidcPicture(userInfo.picture);

    // Try to find existing user by sub, then by email
    let user = this.db.prepare('SELECT * FROM users WHERE oidc_sub = ? AND oidc_issuer = ?').get(sub, config.issuer) as User | undefined;
    if (!user) {
      // Never link/log-in to a guest (#1362) via its synthetic email.
      user = this.db.prepare('SELECT * FROM users WHERE LOWER(email) = ? AND COALESCE(is_guest, 0) = 0').get(email) as User | undefined;
    }

    if (user) {
      // Reaching here without an oidc_sub means we matched an existing local
      // account by email. Only auto-link the OIDC identity when the IdP asserts
      // the email is verified; an unverified email must not auto-link.
      if (!user.oidc_sub) {
        const emailVerified = userInfo.email_verified === true || userInfo.email_verified === 'true';
        if (!emailVerified) {
          return { error: 'email_not_verified' };
        }
        this.db.prepare('UPDATE users SET oidc_sub = ?, oidc_issuer = ? WHERE id = ?').run(sub, config.issuer, user.id);
      }
      // Update role based on OIDC claims on every login (if claim mapping is configured)
      if (readEnv().oidc.adminValue) {
        const newRole = this.resolveOidcRole(userInfo, false);
        if (user.role !== newRole) {
          // Never let the claim-based downgrade strip the last admin. The bootstrap
          // admin (first SSO user) usually doesn't carry the admin claim, so a forced
          // re-login — e.g. after a JWT-secret rotation — would otherwise demote it and
          // lock an OIDC-only instance out for good. #1274
          const demotingLastAdmin =
            user.role === 'admin' &&
            newRole !== 'admin' &&
            (this.db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as { count: number }).count <= 1;
          if (demotingLastAdmin) {
            console.warn(`[OIDC] Kept admin role for user ${user.id}: their OIDC claims map to '${newRole}', but they are the only admin — demoting would lock the instance out.`);
          } else {
            this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, user.id);
            user = { ...user, role: newRole } as User;
          }
        }
      }
      // Keep the avatar in sync with the OIDC picture, but never clobber a custom
      // upload: only fill it when empty or when the current value is itself an OIDC
      // picture URL, so the picture refreshes on each login without overriding an
      // uploaded one. #1399
      if (picture && picture !== user.avatar && (!user.avatar || /^https:\/\//i.test(user.avatar))) {
        this.db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(picture, user.id);
        user = { ...user, avatar: picture } as User;
      }
      return { user };
    }

    // --- New user registration ---
    const userCount = (this.db.prepare('SELECT COUNT(*) as count FROM users WHERE COALESCE(is_guest, 0) = 0').get() as { count: number }).count;
    const isFirstUser = userCount === 0;

    let validInvite: any = null;
    if (inviteToken) {
      validInvite = this.db.prepare('SELECT * FROM invite_tokens WHERE token = ?').get(inviteToken);
      if (validInvite) {
        if (validInvite.max_uses > 0 && validInvite.used_count >= validInvite.max_uses) validInvite = null;
        if (validInvite?.expires_at && new Date(validInvite.expires_at) < new Date()) validInvite = null;
      }
    }

    if (!isFirstUser && !validInvite) {
      const { oidc_registration } = this.auth.resolveAuthToggles();
      if (!oidc_registration) {
        return { error: 'registration_disabled' };
      }
    }

    const role = this.resolveOidcRole(userInfo, isFirstUser);
    const randomPass = crypto.randomBytes(32).toString('hex');
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(randomPass, 10);

    // Username: sanitize and avoid collisions. Keep dots — they are valid in
    // usernames (see the ^[a-zA-Z0-9_.-]+$ validation in authService) and common
    // in OIDC name claims like "first.last".
    let username = name.replace(/[^a-zA-Z0-9_.-]/g, '').substring(0, 30) || 'user';
    const existing = this.db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
    if (existing) username = `${username}_${Date.now() % 10000}`;

    // Atomic registration: if an invite was presented, the increment IS
    // the capacity check — UPDATE matches zero rows the moment another
    // concurrent callback wins the last slot, and the transaction aborts
    // the user INSERT. Without this, two parallel OIDC callbacks could
    // both pass the earlier SELECT-based check and each create a user.
    const inviteRaceError = new Error('invite_exhausted');
    try {
      const result = this.db.transaction(() => {
        if (validInvite) {
          const updated = this.db.prepare(
            'UPDATE invite_tokens SET used_count = used_count + 1 WHERE id = ? AND (max_uses = 0 OR used_count < max_uses)',
          ).run(validInvite.id);
          if (updated.changes === 0) throw inviteRaceError;
        }
        const ins = this.db.prepare(
          'INSERT INTO users (username, email, password_hash, role, oidc_sub, oidc_issuer, avatar, first_seen_version, login_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
        ).run(username, email, hash, role, sub, config.issuer, picture, readEnv().app.appVersion || '0.0.0');
        // Trip-bound invite (#1402): auto-add the new SSO user to the trip inside the
        // same atomic step as the invite consume. Idempotent + owner-safe.
        if (validInvite?.trip_id) {
          joinTripAsMember(Number(validInvite.trip_id), Number(ins.lastInsertRowid), validInvite.created_by ?? null);
        }
        return ins;
      }) as { lastInsertRowid: number | bigint };
      user = { id: Number(result.lastInsertRowid), username, email, role, avatar: picture } as User;
      return { user };
    } catch (err) {
      if (err === inviteRaceError) {
        console.warn(`[OIDC] Invite token ${inviteToken?.slice(0, 8)}... exhausted — concurrent callback won the last slot`);
        return { error: 'registration_disabled' };
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Update last_login timestamp
  // -------------------------------------------------------------------------

  touchLastLogin(userId: number): void {
    this.db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?').run(userId);
  }
}
