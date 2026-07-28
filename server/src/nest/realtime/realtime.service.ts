import { Injectable } from '@nestjs/common';
import { broadcast, broadcastToUser } from '../../websocket';

/**
 * Injectable facade over the websocket module singleton (roadmap Phase 0 item 3).
 *
 * Migrated Nest services inject this instead of importing `broadcast`/
 * `broadcastToUser` module globals. The actual transport (rooms, auth,
 * heartbeat, rate limiting) stays in src/websocket.ts — a future
 * @WebSocketGateway swap happens behind this facade, invisibly.
 *
 * Both methods delegate to the live module exports *at call time* (same
 * pattern as DatabaseService.canAccessTrip): tests vi.mock src/websocket
 * per file, and the stubs must keep flowing through here. Never capture
 * the functions at construction, and never dereference an export the
 * method wasn't asked for — many test mocks provide `broadcast` only.
 *
 * The service is deliberately dependency-free so module-level bridge code
 * (todo.bridge.ts pattern) can construct it with a bare `new RealtimeService()`.
 */
@Injectable()
export class RealtimeService {
  /**
   * Broadcast an event to all sockets in a trip room. Mirrors the
   * websocket.ts signature exactly: `excludeSid` is the X-Socket-Id
   * echo-suppression contract (the originating client is skipped);
   * `onlyUserId` narrows delivery to one user's sockets (#858 private
   * packing items).
   *
   * Rest-spread keeps the caller's exact argument arity — dozens of test
   * mocks assert the precise call shape (3, 4 or 5 args), so the facade
   * must not pad omitted optionals with explicit `undefined`s.
   */
  broadcast(
    ...args: [
      tripId: number | string,
      eventType: string,
      payload: Record<string, unknown>,
      excludeSid?: number | string,
      onlyUserId?: number,
    ]
  ): void {
    broadcast(...args);
  }

  /** Send a message to all sockets of one user; the payload carries its own `type`. */
  broadcastToUser(
    ...args: [userId: number, payload: Record<string, unknown>, excludeSid?: number | string]
  ): void {
    broadcastToUser(...args);
  }
}
