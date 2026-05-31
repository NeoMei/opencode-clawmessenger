import { mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import pino, { type Logger } from 'pino';

const DEFAULT_LOG_PATH = join(homedir(), '.config', 'opencode', 'clawmessenger.log');
const level = process.env.CLAW_LOG_LEVEL?.toLowerCase() || 'info';
const logFile = process.env.CLAW_LOG_FILE || DEFAULT_LOG_PATH;

const logDir = dirname(logFile);
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

const targets: any[] = [
  { target: 'pino/file', level, options: { destination: logFile, mkdir: true } },
];

if (process.stderr.isTTY) {
  targets.push({
    target: 'pino-pretty',
    level,
    options: { destination: 2, colorize: true, singleLine: true, translateTime: 'HH:MM:ss' },
  });
}

const transport = pino.transport({ targets });
export const rootLogger: Logger = pino({ level, base: undefined }, transport);

export function createLogger(module: string, bindings: Record<string, unknown> = {}): Logger {
  return rootLogger.child({ module, ...bindings });
}

export type { Logger };
