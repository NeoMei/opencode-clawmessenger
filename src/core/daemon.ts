import { writeFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

export const PID_FILE = join(homedir(), '.config', 'opencode', 'clawmessenger.pid');
export const STATUS_FILE = join(homedir(), '.config', 'opencode', 'clawmessenger.status');
export const HEARTBEAT_STALE_AFTER_MS = 60_000;

export interface StatusSnapshot {
  startedAt: number;
  opencodeUrl: string;
  rongcloudConnected: boolean;
  sessionCount: number;
}

export function spawnDaemon(args: string[]): void {
  const child = spawn(process.argv[0], [process.argv[1], ...args.filter(a => a !== '--daemon')], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CLAW_DAEMONIZED: '1' },
  });
  child.unref();
}

export function writePid(pid: number): void {
  const dir = dirname(PID_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PID_FILE, String(pid));
}

export function readPid(): number | null {
  try {
    return parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
  } catch { return null; }
}

export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function writeStatus(snap: StatusSnapshot): void {
  const dir = dirname(STATUS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATUS_FILE, JSON.stringify(snap));
}

export function readStatus(): StatusSnapshot | null {
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf-8'));
  } catch { return null; }
}

export function statusFileAgeMs(): number | null {
  try {
    const stat = require('fs').statSync(STATUS_FILE);
    return Date.now() - stat.mtimeMs;
  } catch { return null; }
}

export function startStatusWriter(getState: () => StatusSnapshot): () => void {
  const interval = setInterval(() => {
    try { writeStatus(getState()); } catch {}
  }, 10_000);
  return () => clearInterval(interval);
}

export function cleanupPid(): void {
  try { unlinkSync(PID_FILE); } catch {}
}
