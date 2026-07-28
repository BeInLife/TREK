// Filters *expected* noise off the test console so real failures stay visible
// in CI logs (a green run used to emit ~8k stderr lines, burying anything real).
// Scope is deliberately narrow: each pattern below is an artifact of the test
// environment, not of the code under test, and is matched on both the exact
// message head and the specific error. Everything else passes through verbatim
// — an unexpected migration failure or backfill error still prints.
//
// 1. `[migrations] Non-fatal migration step failed:` + `duplicate column
//    name: …` — test suites build a fresh :memory: DB via createTables()
//    (already-current schema) and then runMigrations() replays historical
//    steps against it; some suites additionally re-run migrations on purpose.
//    Unguarded ALTER TABLE steps collide with columns the current schema
//    already has (which column varies by suite). Production migrates
//    incrementally and never replays steps against a current schema; guarding
//    the steps in src/ would change production output, so the replay artifact
//    is filtered here instead. Non-duplicate-column step failures still print.
// 2. `[DB] Flight endpoint backfill failed:` + `Cannot find module
//    '../services/airportService'` — database.ts runs a boot-time backfill via
//    a bare CJS require() at module eval, which the vitest transform pipeline
//    cannot resolve (the compiled production dist can). Fires once in every
//    test file that evaluates the real database.ts (~60 files).

const MIGRATION_WARN_HEAD = '[migrations] Non-fatal migration step failed:';
const DUPLICATE_COLUMN = /duplicate column name: /;

const BACKFILL_ERROR_HEAD = '[DB] Flight endpoint backfill failed:';
const AIRPORT_MODULE_MISSING = /Cannot find module '\.\.\/services\/airportService'/;

const errorText = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

const realWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (args[0] === MIGRATION_WARN_HEAD && DUPLICATE_COLUMN.test(errorText(args[1]))) return;
  realWarn(...args);
};

const realError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (args[0] === BACKFILL_ERROR_HEAD && AIRPORT_MODULE_MISSING.test(errorText(args[1]))) return;
  realError(...args);
};
