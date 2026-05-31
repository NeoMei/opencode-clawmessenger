import { exec } from 'child_process';
import { createLogger } from './logger.js';

const log = createLogger('HookManager');

export interface HookConfig {
  onSessionCreated?: string;
  onSessionIdle?: string;
}

export class HookManager {
  private hooks: HookConfig;
  private projectDir: string;

  constructor(hooks: HookConfig, projectDir: string) {
    this.hooks = hooks;
    this.projectDir = projectDir;
  }

  async run(event: 'onSessionCreated' | 'onSessionIdle', context: Record<string, string>): Promise<void> {
    const script = this.hooks[event];
    if (!script) return;

    log.info({ event, script }, 'Running hook');
    try {
      await new Promise<void>((resolve, reject) => {
        const child = exec(script, {
          cwd: this.projectDir,
          env: { ...process.env, ...context },
          timeout: 30_000,
        }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (err) {
      log.error({ err, event, script }, 'Hook failed');
    }
  }
}
