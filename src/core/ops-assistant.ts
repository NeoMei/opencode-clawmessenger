import { spawn } from 'child_process';
import { createLogger } from './logger.js';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';

const log = createLogger('OpsAssistant');

export interface OpsAssistantConfig {
  directory: string;
  sessionFile?: string;
  timeout?: number;
  opencodeUrl?: string;
}

interface OpsSession {
  id: string;
  lastUsed: number;
}

export class OpsAssistantClient {
  private directory: string;
  private sessionFile: string;
  private timeout: number;
  private opencodeUrl: string;
  private sessions: Map<string, OpsSession> = new Map();
  private systemPrompt: string | null = null;
  private activeProcesses: Map<string, boolean> = new Map();
  private processQueue: Map<string, Array<{ message: string; resolve: (value: string) => void; reject: (reason: any) => void }>> = new Map();

  constructor(config: OpsAssistantConfig) {
    this.directory = config.directory;
    this.opencodeUrl = config.opencodeUrl || 'http://127.0.0.1:19877';
    this.timeout = config.timeout || 60000;
    this.sessionFile = config.sessionFile || join(homedir(), '.config', 'opencode', 'ops-assistant-sessions.json');
    this.systemPrompt = this.loadSystemPrompt();
    this.loadSessions();
  }

  private loadSystemPrompt(): string | null {
    const promptPath = join(this.directory, '.opencode', 'prompt.md');
    if (existsSync(promptPath)) {
      try {
        const content = readFileSync(promptPath, 'utf-8');
        if (content.trim().length > 0) {
          log.info({ path: promptPath, length: content.length }, 'Loaded ops system prompt');
          return content.trim();
        }
      } catch (err) {
        log.warn({ err, path: promptPath }, 'Failed to load ops system prompt');
      }
    }
    log.warn({ path: promptPath }, 'Ops system prompt not found');
    return null;
  }

  private loadSessions(): void {
    try {
      if (existsSync(this.sessionFile)) {
        const data = JSON.parse(readFileSync(this.sessionFile, 'utf-8'));
        if (data.sessions && typeof data.sessions === 'object') {
          for (const [key, value] of Object.entries(data.sessions)) {
            this.sessions.set(key, value as OpsSession);
          }
        }
        log.info({ count: this.sessions.size }, 'Loaded ops assistant sessions');
      }
    } catch (err) {
      log.warn({ err }, 'Failed to load ops sessions');
    }
  }

  private saveSessions(): void {
    try {
      const dir = dirname(this.sessionFile);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const data = { sessions: Object.fromEntries(this.sessions) };
      writeFileSync(this.sessionFile, JSON.stringify(data, null, 2));
    } catch (err) {
      log.warn({ err }, 'Failed to save ops sessions');
    }
  }

  async sendMessage(chatId: string, message: string): Promise<string> {
    // 如果该 chatId 正在处理中，加入队列等待
    if (this.activeProcesses.get(chatId)) {
      log.info({ chatId }, 'Ops assistant busy, queuing message');
      return new Promise((resolve, reject) => {
        if (!this.processQueue.has(chatId)) {
          this.processQueue.set(chatId, []);
        }
        // 排队请求设置 5 分钟超时（足够长）
        const timeoutId = setTimeout(() => {
          const queue = this.processQueue.get(chatId);
          if (queue) {
            const idx = queue.findIndex(item => item.resolve === resolve);
            if (idx > -1) queue.splice(idx, 1);
          }
          reject(new Error('Ops assistant queue timeout'));
        }, 300000);
        
        const wrappedResolve = (value: string) => {
          clearTimeout(timeoutId);
          resolve(value);
        };
        const wrappedReject = (reason: any) => {
          clearTimeout(timeoutId);
          reject(reason);
        };
        
        this.processQueue.get(chatId)!.push({ 
          message, 
          resolve: wrappedResolve, 
          reject: wrappedReject 
        });
      });
    }

    return this._doSendMessage(chatId, message);
  }

  private async _doSendMessage(chatId: string, message: string, isRetry: boolean = false): Promise<string> {
    this.activeProcesses.set(chatId, true);

    try {
      const result = await this._executeOpencode(chatId, message);
      
      // 处理队列中的下一条消息
      setImmediate(() => this._processQueue(chatId));
      
      return result;
    } catch (err: any) {
      log.warn({ chatId, err: err.message, isRetry }, 'Ops assistant failed');
      
      if (!isRetry) {
        // 清除可能损坏的 session，重试一次
        log.info({ chatId }, 'Clearing session and retrying');
        this.sessions.delete(chatId);
        this.saveSessions();
        
        try {
          const result = await this._executeOpencode(chatId, message);
          setImmediate(() => this._processQueue(chatId));
          return result;
        } catch (retryErr: any) {
          setImmediate(() => this._processQueue(chatId));
          throw retryErr;
        }
      }
      
      // 处理队列中的下一条消息
      setImmediate(() => this._processQueue(chatId));
      throw err;
    }
  }

  private async _processQueue(chatId: string): Promise<void> {
    const queue = this.processQueue.get(chatId);
    if (!queue || queue.length === 0) {
      this.activeProcesses.delete(chatId);
      return;
    }

    const next = queue.shift();
    if (!next) {
      this.activeProcesses.delete(chatId);
      return;
    }

    try {
      const result = await this._executeOpencode(chatId, next.message);
      next.resolve(result);
    } catch (err) {
      next.reject(err);
    } finally {
      // 继续处理队列
      setImmediate(() => this._processQueue(chatId));
    }
  }

  private async _executeOpencode(chatId: string, message: string): Promise<string> {
    const session = this.sessions.get(chatId);
    const args: string[] = [
      'run',
      '--dir', this.directory,
      '--format', 'json',
      '--dangerously-skip-permissions',
      '--attach', this.opencodeUrl,
    ];

    if (session) {
      args.push('--session', session.id, '--continue');
      log.info({ chatId, sessionId: session.id }, 'Continuing ops session');
    } else {
      log.info({ chatId }, 'Starting new ops session');
    }

    // 构建输入消息：system prompt + user message
    const inputLines: string[] = [];
    if (this.systemPrompt) {
      inputLines.push('[系统指令]');
      inputLines.push(this.systemPrompt);
      inputLines.push('');
    }
    inputLines.push('[用户消息]');
    inputLines.push(message);
    const input = inputLines.join('\n');

    return new Promise((resolve, reject) => {
      const texts: string[] = [];
      let currentSessionId: string | null = null;
      let stderr = '';
      let isCompleted = false;

      log.debug({ cmd: 'opencode', args: args.slice(0, 4), inputLength: input.length }, 'Spawning opencode run');

      const child = spawn('opencode', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });

      // 通过 stdin 发送消息
      child.stdin.write(input);
      child.stdin.end();

      const timeoutId = setTimeout(() => {
        if (isCompleted) return;
        isCompleted = true;
        
        log.warn({ chatId, timeout: this.timeout }, 'Ops assistant timeout, killing process');
        child.kill('SIGKILL');
        
        const response = texts.join('');
        if (response) {
          log.info({ chatId, responseLength: response.length }, 'Returning partial response after timeout');
          resolve(response);
        } else {
          reject(new Error('Ops assistant timeout'));
        }
      }, this.timeout);

      child.stdout.on('data', (data: Buffer) => {
        if (isCompleted) return;
        
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event.type === 'text' && event.part?.text) {
              texts.push(event.part.text);
            }
            if (event.sessionID && !currentSessionId) {
              currentSessionId = event.sessionID;
            }
          } catch {
            // Ignore non-JSON lines
          }
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        if (isCompleted) return;
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (isCompleted) return;
        isCompleted = true;
        clearTimeout(timeoutId);

        if (currentSessionId) {
          this.sessions.set(chatId, { id: currentSessionId, lastUsed: Date.now() });
          this.saveSessions();
          log.info({ chatId, sessionId: currentSessionId }, 'Ops session saved');
        }

        if (code !== 0 && code !== null) {
          log.warn({ code, stderr: stderr.slice(0, 500) }, 'opencode run exited with error');
        }

        const response = texts.join('');
        if (response) {
          resolve(response);
        } else if (stderr) {
          reject(new Error(`Ops assistant failed: ${stderr.slice(0, 200)}`));
        } else {
          reject(new Error('Ops assistant returned empty response'));
        }
      });

      child.on('error', (err) => {
        if (isCompleted) return;
        isCompleted = true;
        clearTimeout(timeoutId);
        reject(new Error(`Failed to spawn opencode: ${err.message}`));
      });
    });
  }

  clearSession(chatId: string): void {
    this.sessions.delete(chatId);
    this.saveSessions();
    log.info({ chatId }, 'Ops session cleared');
  }
}
