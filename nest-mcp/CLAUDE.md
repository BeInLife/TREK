# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this package is

`@trek/nest-mcp` — decorator-driven MCP tool/resource/prompt registration for NestJS, a workspace package of the TREK monorepo (see the repo-root `CLAUDE.md` for monorepo-wide context). Domains declare MCP entries as decorated methods on ordinary Nest providers; a discovery-backed registry collects them at boot and attaches them, filtered by a host-defined access policy, onto each per-session `McpServer`.

Two invariants shape everything here:

- **Extraction-clean**: imports nothing from `@trek/server` or `@trek/shared`; peer-depends only on `@nestjs/common`, `@nestjs/core`, `@modelcontextprotocol/sdk`, and `zod`. Do not add TREK-specific imports or semantics.
- **No scope semantics of its own**: `access: { group, mode }` markers are opaque here; their meaning comes entirely from the host's `accessPolicy` passed to `McpModule.forRoot(...)`. Host-specific behavior (TREK's scope rules, canned permission errors) belongs in `server/`, not here.

## Commands

From the repo root (or drop `--workspace=nest-mcp` when running inside this directory):

```bash
npm run build --workspace=nest-mcp        # tsc -p tsconfig.build.json → dist/ (CJS + d.ts)
npm run typecheck --workspace=nest-mcp    # tsc --noEmit (covers src + tests)
npm run test --workspace=nest-mcp         # vitest run
npm run test:coverage --workspace=nest-mcp  # istanbul coverage, 80% thresholds on src/**
npm run lint:check --workspace=nest-mcp   # eslint (lint runs with --fix)
```

Single test file / single test (from `nest-mcp/`):

```bash
npx vitest run tests/registry.test.ts
npx vitest run -t "name of the test"
```

Build order matters at the monorepo level: root `build`/`dev` build `shared` → `nest-mcp` → `server` → `client`, because `server` consumes this package's `dist/`. After changing this package, rebuild it before running server tests that exercise the Nest MCP layer.

## Architecture

Source is small and flat (`src/`, one concern per file):

- **`metadata.ts`** — package-private metadata store: a `WeakSet`/`WeakMap` keyed by class constructor, deliberately **not** reflect-metadata (no polyfill import-order hazards; works in bare vitest workers and `createTestRegistry` without a Nest app). `getEntry` walks the constructor prototype chain so inherited decorated methods resolve on subclasses.
- **`decorators.ts`** — `@McpController()` (implies `@Injectable()`; discovery scans only marked classes) plus `@Tool` / `@Resource` / `@ResourceTemplate` / `@Prompt`, which just record entries into the metadata store.
- **`registry.ts`** — `McpRegistry`, a plain no-DI class holding decorated entries bound to provider instances. `attach(server, ctx, opts?)` registers each entry passing its access check onto a per-session `McpServer`, normalizing SDK callback shapes so handlers always receive `ctx` as the last argument (the SDK `extra` slot) and tools always receive `(args, ctx)` even with no `inputSchema`. `opts.onInvoke` (see `McpAttachOptions`) fires with `{ kind, name }` immediately before every attached handler runs — the host's observability seam (TREK's tool-call audit trail); it must not throw, and nest-mcp does not catch. `validate()` fails fast on duplicate names (fixed resources: duplicate URIs) and on declarative `access` without a configured policy.
- **`mcp-registry.service.ts`** — `McpRegistryService`, the DI subclass: on `onModuleInit` it scans providers via Nest's `DiscoveryService`/`MetadataScanner`, dedupes by instance (a provider can be wrapped once per module listing it), registers them, then runs `validate()` so misconfiguration breaks app boot rather than MCP session creation.
- **`mcp.module.ts`** — `McpModule.forRoot({ accessPolicy })`, a global dynamic module exporting the registry service.
- **`testing.ts`** — `createTestRegistry(instances, options)`: builds and validates a registry from hand-constructed controller instances, no Nest app.
- **`helpers.ts`** — handler-side result helpers (`ok`, `errorResult`, `demoDenied`) and the six `TOOL_ANNOTATIONS_*` presets.
- **`types.ts`** — options types and the empty `McpContext` interface, which hosts augment via `declare module '@trek/nest-mcp'`.

Access evaluation order in `allowed()`: `when` gate first, then `access` (predicate bypasses the policy; declarative goes through it; omitted `access` = always registered). Preserve this order — hosts rely on `when` for addon toggles so scope markers stay declarative.

Everything public is re-exported through `src/index.ts`; new exports go there.

## Testing setup quirks

- Vitest uses the **SWC transform** (`unplugin-swc` in `vitest.config.ts`) because esbuild doesn't emit decorator metadata — without it, type-based Nest DI in tests breaks silently.
- Coverage uses the **istanbul** provider (v8 under-reports on decorator output), thresholds 80% across the board on `src/**`.
- `tests/setup.ts` imports `reflect-metadata` for `@nestjs/testing` only — the package's own decorators/registry deliberately don't need it. Keep it that way.
- `tests/harness.ts` provides `createAttachHarness` (real `McpServer` + `Client` over an `InMemoryTransport`) and `asCtx` for the test context shape. Prefer exercising behavior through a real client round-trip rather than poking registry internals.

## MCP SDK exports-map workaround

The SDK's `exports` map uses extension-less wildcard targets that TypeScript and Vite cannot resolve. Both `tsconfig.json` (`paths`) and `vitest.config.ts` (`resolve.alias`) redirect deep imports (`server/mcp`, `client/index`, `inMemory`, `types`) to the CJS dist files under the **repo-root** `node_modules` (packages are hoisted). If you add a new deep SDK import, add it to **both** files or typecheck/tests will fail with unresolvable-module errors.
