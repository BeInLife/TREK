import { readEnv } from '../../app-config';
import fs from 'fs';
import path from 'path';

/**
 * The server's rotating file logger — a plain, deliberately side-effectful
 * module, NOT an injectable. This is a documented parity exception to the
 * "importable without side effects" rule: index.ts lazy-requires it before any
 * Nest container exists (boot ordering), and tests/setup.ts relies on env
 * being read exactly once at first import (the LOG_LEVEL freeze below).
 */

// Frozen at import on purpose (legacy timing; tests/setup.ts sets it pre-import).
const LOG_LEVEL = (readEnv().app.logLevel || 'info').toLowerCase();
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES = 5;

const C = {
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  reset:   '\x1b[0m',
};

// ── File logger with rotation ─────────────────────────────────────────────

const logsDir = path.join(process.cwd(), 'data/logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
const logFilePath = path.join(logsDir, 'trek.log');

function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(logFilePath)) return;
    const stat = fs.statSync(logFilePath);
    if (stat.size < MAX_LOG_SIZE) return;

    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const src = i === 1 ? logFilePath : `${logFilePath}.${i - 1}`;
      const dst = `${logFilePath}.${i}`;
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }
  } catch {}
}

function writeToFile(line: string): void {
  try {
    rotateIfNeeded();
    fs.appendFileSync(logFilePath, line + '\n');
  } catch {}
}

// ── Public log helpers ────────────────────────────────────────────────────

function formatTs(): string {
  const tz = readEnv().app.tz || 'UTC';
  return new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
}

export function logInfo(msg: string): void {
  const ts = formatTs();
  console.log(`${C.blue}[INFO]${C.reset} ${ts} ${msg}`);
  writeToFile(`[INFO] ${ts} ${msg}`);
}

export function logDebug(msg: string): void {
  if (LOG_LEVEL !== 'debug') return;
  const ts = formatTs();
  console.log(`${C.cyan}[DEBUG]${C.reset} ${ts} ${msg}`);
  writeToFile(`[DEBUG] ${ts} ${msg}`);
}

export function logError(msg: string): void {
  const ts = formatTs();
  console.error(`${C.red}[ERROR]${C.reset} ${ts} ${msg}`);
  writeToFile(`[ERROR] ${ts} ${msg}`);
}

export function logWarn(msg: string): void {
  const ts = formatTs();
  console.warn(`${C.yellow}[WARN]${C.reset} ${ts} ${msg}`);
  writeToFile(`[WARN] ${ts} ${msg}`);
}

export { LOG_LEVEL };
