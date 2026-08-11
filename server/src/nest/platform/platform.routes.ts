import express, { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';

import { readEnv } from '../../app-config';
import { verifyJwtAndLoadUser } from '../auth/jwt-verify';
import { db } from '../../db/database';
import { mcpHandler } from '../../mcp';
import { trekOAuthProvider, trekClientsStore } from '../../mcp/oauthProvider';
import { isAddonEnabled } from '../addons/addons.bridge';
import { ADDON_IDS } from '../../addons';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register';

// Platform / transport routes extracted verbatim from createApp() (app.ts) so they can be
// mounted on either the legacy Express app or the NestJS Express instance (strangler A6/A8).
//
// IMPORTANT — path resolution: the original blocks lived in src/app.ts, where __dirname
// resolves to the directory of app.js (one level above the uploads/public anchor), so they
// used '../uploads/...' and '../public'. This file lives three levels deeper
// (src/nest/platform/), so __dirname is three levels deeper too. The relative prefixes are
// therefore '../../../uploads/...' and '../../../public' — which resolve to the EXACT same
// absolute paths as before. This is the only intentional change; everything else is byte-for-byte
// identical. (rootDir/outDir preserve the tree, so the offset holds in both source/test and
// compiled/dist execution — matching the other nest controllers that use '../../../uploads/...'.)

const UPLOADS_DIR = path.join(__dirname, '../../../uploads');
export const PUBLIC_DIR = path.join(__dirname, '../../../public');

/**
 * Static + guarded /uploads/* routes. Must be applied BEFORE the API route mounts
 * (identical to its original position near the top of createApp).
 */
export function applyPlatformUploads(app: express.Application): void {
  // Static: avatars, covers, and journey photos.
  //
  // Security model (audit SEC-M9): these paths are unauthenticated by
  // design. All filenames are server-chosen UUID v4 (see `uuid()` in
  // the multer storage config for avatars / covers / journey uploads),
  // which gives each asset >122 bits of namespace entropy — not
  // guessable via enumeration. An attacker would need to have already
  // seen the URL (email, shared journey, etc.) to request the file.
  //
  // Moving these behind auth would also break:
  //   - Unauthenticated trip-card rendering on public share links
  //   - Journey public-share pages (/public/journey/:token)
  //   - Email-embedded avatars
  //
  // The `/uploads/photos/...` route below is DIFFERENT: photo URLs are
  // not embedded in unauthenticated UI contexts, so that endpoint IS
  // gated (session JWT with pv, or a share token scoped to the photo's
  // trip).
  app.use('/uploads/avatars', express.static(path.join(UPLOADS_DIR, 'avatars')));
  app.use('/uploads/covers', express.static(path.join(UPLOADS_DIR, 'covers')));
  app.use('/uploads/journey', express.static(path.join(UPLOADS_DIR, 'journey')));
  app.use('/uploads/places', express.static(path.join(UPLOADS_DIR, 'places')));

  // Photos require either a valid logged-in session (via JWT with the
  // password_version gate) OR a share token that covers the SPECIFIC
  // photo's trip. Previously any share token for any trip could request
  // any photo filename by UUID — fine in practice because UUIDs are
  // unguessable, but the auth model was wrong.
  app.get('/uploads/photos/:filename', (req: Request, res: Response) => {
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(UPLOADS_DIR, 'photos', safeName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(UPLOADS_DIR, 'photos'))) {
      return res.status(403).send('Forbidden');
    }
    // existsSync here is cheap and avoids a sendFile error frame; kept
    // sync because the handler is already short-lived.
    if (!fs.existsSync(resolved)) return res.status(404).send('Not found');

    const authHeader = req.headers.authorization;
    const rawToken = (req.query.token as string) || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
    if (!rawToken) return res.status(401).send('Authentication required');

    // JWT session path (with pv check).
    const user = verifyJwtAndLoadUser(rawToken);
    if (user) return res.sendFile(resolved);

    // Share-token path: require the token to cover the exact trip the
    // photo belongs to. Expired tokens fall through to 401.
    const photo = db.prepare('SELECT trip_id FROM photos WHERE filename = ?').get(safeName) as { trip_id: number } | undefined;
    if (!photo) return res.status(401).send('Authentication required');

    const share = db.prepare(
        "SELECT trip_id FROM share_tokens WHERE token = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
    ).get(rawToken) as { trip_id: number } | undefined;
    if (!share || share.trip_id !== photo.trip_id) {
      return res.status(401).send('Authentication required');
    }
    res.sendFile(resolved);
  });

  // Block direct access to /uploads/files
  app.use('/uploads/files', (_req: Request, res: Response) => {
    res.status(401).send('Authentication required');
  });
}

/**
 * The OAuth SDK + /mcp transport mounts still living on the pre-init Express
 * layer. The rest of the former transport surface is behind the container now:
 * /api/health (FeaturesController), OAuth discovery (DiscoveryController + the
 * McpMetadataMiddleware bootstrap applies pre-init), and the /oauth/consent
 * COOP override (ConsentCoopMiddleware via PlatformModule.configure).
 */
export function applyPlatformTransport(app: express.Application): void {
  // OAuth 2.1 — public endpoints
  // Gate: 404 when MCP addon is disabled (M2 — prevents feature fingerprinting)
  const mcpAddonGate = (_req: Request, res: Response, next: NextFunction) => {
    if (!isAddonEnabled(ADDON_IDS.MCP)) return res.status(404).end();
    next();
  };

  // SDK authorize handler: validates OAuth params, calls provider.authorize() which redirects
  // to the SPA consent page at /oauth/consent
  app.use('/oauth/authorize', mcpAddonGate, authorizationHandler({ provider: trekOAuthProvider }));

  // SDK DCR handler: accepts registrations without scope (fixes issue #959 bug 2)
  app.use('/oauth/register', mcpAddonGate, clientRegistrationHandler({ clientsStore: trekClientsStore }));

  // MCP endpoint
  app.post('/mcp', mcpHandler);
  app.get('/mcp', mcpHandler);
  app.delete('/mcp', mcpHandler);
}

/**
 * Production SPA serving: the built client static assets + the index.html catch-all
 * for client-side routes. This is the LEGACY (plain Express 4) form — a real
 * `app.get(catch-all)` registered as the terminal handler. The NestJS bootstrap can
 * NOT use this (its router terminates unmatched requests with a 404 before any
 * post-init route runs, and Express 5's path-to-regexp rejects a bare '*'); it serves
 * the SPA via the SpaFallbackFilter instead. Both produce the identical result:
 * unmatched GET → index.html in production.
 */
export function applyPlatformSpa(app: express.Application): void {
  applyPlatformStatic(app);
  // Case-sensitive on purpose (legacy parity).
  if (readEnv().app.nodeEnv !== 'production') return;
  // /.*/ rather than '*' so the helper is Express-4 and Express-5 safe.
  app.get(/.*/, (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

/**
 * Production static serving of the built client (JS/CSS/assets). Split out from
 * applyPlatformSpa because the NestJS bootstrap needs the static files served
 * BEFORE its router (so a real asset request returns the file, not the SPA
 * index.html), while the index.html catch-all is handled separately (legacy:
 * app.get catch-all; Nest: SpaFallbackFilter). No-op outside production.
 */
export function applyPlatformStatic(app: express.Application): void {
  // Case-sensitive on purpose (legacy parity).
  if (readEnv().app.nodeEnv !== 'production') return;
  app.use(
    express.static(PUBLIC_DIR, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    }),
  );
}
