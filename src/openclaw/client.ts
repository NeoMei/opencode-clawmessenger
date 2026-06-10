import { spawn } from 'child_process';
import net from 'net';
import os from 'os';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { createLogger } from '../core/logger.js';

const log = createLogger('OpenClawClient');

const DEFAULT_GATEWAY_PORT = 18789;

function getRealHomeDir(): string {
  const envHome = process.env.CLAW_SERVICE_HOME || process.env.USERPROFILE || process.env.HOME;
  if (envHome && !envHome.includes('systemprofile')) {
    return envHome;
  }
  const homeDir = os.homedir();
  if (!homeDir.includes('systemprofile')) {
    return homeDir;
  }
  const usersDir = 'C:\\Users';
  if (fs.existsSync(usersDir)) {
    const entries = fs.readdirSync(usersDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !['Public', 'Default', 'All Users', 'Default User'].includes(entry.name)) {
        const candidate = path.join(usersDir, entry.name);
        if (fs.existsSync(path.join(candidate, '.openclaw'))) {
          return candidate;
        }
      }
    }
  }
  return homeDir;
}

function getOpenClawEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const realHome = getRealHomeDir();
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const systemHome = os.homedir();

  env.USERPROFILE = realHome;
  env.HOME = realHome;

  if (process.platform === 'win32') {
    const match = realHome.match(/^([A-Za-z]:)(.*)$/);
    if (match) {
      env.HOMEDRIVE = match[1];
      env.HOMEPATH = match[2];
    }

    const fixPath = (originalPath?: string): string | null => {
      if (!originalPath) return null;
      const lowerOriginal = originalPath.toLowerCase();
      const lowerSystemHome = systemHome.toLowerCase();
      if (lowerOriginal.includes(lowerSystemHome)) {
        const idx = lowerOriginal.indexOf(lowerSystemHome);
        return originalPath.substring(0, idx) + realHome + originalPath.substring(idx + systemHome.length);
      }
      return null;
    };

    if (baseEnv.APPDATA) {
      const fixed = fixPath(baseEnv.APPDATA);
      if (fixed) env.APPDATA = fixed;
    }
    if (!env.APPDATA) {
      env.APPDATA = path.join(realHome, 'AppData', 'Roaming');
    }

    if (baseEnv.LOCALAPPDATA) {
      const fixed = fixPath(baseEnv.LOCALAPPDATA);
      if (fixed) env.LOCALAPPDATA = fixed;
    }
    if (!env.LOCALAPPDATA) {
      env.LOCALAPPDATA = path.join(realHome, 'AppData', 'Local');
    }
  }

  return env;
}

function getGatewayToken(): string | null {
  const homeDir = getRealHomeDir();
  const possibleFiles = [
    path.join(homeDir, '.openclaw', 'openclaw.json'),
    path.join(homeDir, '.openclaw', 'config.json'),
    path.join(homeDir, '.openclaw', 'tools.json'),
    path.join(homeDir, '.openclaw', 'settings.json'),
  ];

  for (const filePath of possibleFiles) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const config = JSON.parse(content) as Record<string, unknown>;
        const token = (config.gatewayToken as string | undefined)
          || ((config.gateway as Record<string, unknown>)?.auth as Record<string, unknown>)?.token as string | undefined
          || (config.token as string | undefined)
          || (config.apiKey as string | undefined)
          || (config.api_key as string | undefined)
          || (config.password as string | undefined);
        if (token) return String(token);
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(3000);
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.connect(port, '127.0.0.1');
  });
}

function ensureChatCompletionsConfig(): void {
  const realHome = getRealHomeDir();
  const openclawDir = path.join(realHome, '.openclaw');
  const configPath = path.join(openclawDir, 'openclaw.json');

  let settings: Record<string, unknown> = {};
  let existed = false;

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      settings = JSON.parse(content) as Record<string, unknown>;
      existed = true;
    }
  } catch {
    settings = {};
  }

  const gateway = (settings.gateway as Record<string, unknown>) || {};
  const http = (gateway.http as Record<string, unknown>) || {};
  const endpoints = (http.endpoints as Record<string, unknown>) || {};
  const chatCompletions = (endpoints.chatCompletions as Record<string, unknown>) || {};

  if (chatCompletions.enabled === true) {
    log.info('openclaw.json 中 chatCompletions 已启用');
    return;
  }

  (endpoints as Record<string, unknown>).chatCompletions = { enabled: true };
  (http as Record<string, unknown>).endpoints = endpoints;
  (gateway as Record<string, unknown>).http = http;
  settings.gateway = gateway;

  try {
    if (!fs.existsSync(openclawDir)) {
      fs.mkdirSync(openclawDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), 'utf-8');
    log.info(`已自动在 openclaw.json 中启用 chatCompletions (${existed ? '更新' : '新建'})`);
  } catch (err) {
    log.warn({ err }, '写入 openclaw.json 失败');
  }
}

function startOpenClawGateway(): Promise<boolean> {
  return new Promise((resolve) => {
    ensureChatCompletionsConfig();
    log.info('正在启动 OpenClaw gateway...');

    const child = spawn('openclaw', ['gateway'], {
      shell: true,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
      env: getOpenClawEnv(),
    });

    child.unref();

    let attempts = 0;
    const maxAttempts = 20;
    const interval = setInterval(async () => {
      attempts++;
      const gatewayRunning = await checkPort(DEFAULT_GATEWAY_PORT);
      if (gatewayRunning) {
        clearInterval(interval);
        log.info(`OpenClaw gateway 启动成功 (${DEFAULT_GATEWAY_PORT})`);
        resolve(true);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        log.warn('OpenClaw gateway 启动超时');
        resolve(false);
      }
    }, 1000);

    child.on('error', (err) => {
      log.error({ err }, '启动 gateway 失败');
      clearInterval(interval);
      resolve(false);
    });
  });
}

export interface OpenClawMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class OpenClawClient {
  static maxConcurrency = 2;
  static runningCount = 0;
  static waitQueue: Array<() => void> = [];
  static sessionLocks = new Map<string, Promise<void>>();
  static conversationHistory = new Map<string, OpenClawMessage[]>();
  static maxHistoryRounds = 50;
  static maxMessageLength = 2000;
  static activeRequests = new Map<string, AbortController>();

  private gatewayStarting = false;
  private gatewayStarted = false;
  private gatewayUrl: string;

  constructor(gatewayUrl = `http://127.0.0.1:${DEFAULT_GATEWAY_PORT}`) {
    this.gatewayUrl = gatewayUrl;
  }

  static async acquireSlot(): Promise<void> {
    if (OpenClawClient.runningCount < OpenClawClient.maxConcurrency) {
      OpenClawClient.runningCount++;
      return;
    }
    return new Promise((resolve) => OpenClawClient.waitQueue.push(resolve));
  }

  static releaseSlot(): void {
    OpenClawClient.runningCount--;
    if (OpenClawClient.waitQueue.length > 0) {
      const next = OpenClawClient.waitQueue.shift();
      OpenClawClient.runningCount++;
      next?.();
    }
  }

  async ensureGatewayRunning(): Promise<boolean> {
    const gatewayRunning = await checkPort(DEFAULT_GATEWAY_PORT);
    if (gatewayRunning) {
      this.gatewayStarted = true;
      return true;
    }

    this.gatewayStarted = false;
    if (this.gatewayStarting) {
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await checkPort(DEFAULT_GATEWAY_PORT)) {
          this.gatewayStarted = true;
          return true;
        }
      }
      return false;
    }

    this.gatewayStarting = true;
    try {
      const started = await startOpenClawGateway();
      this.gatewayStarted = started;
      return started;
    } finally {
      this.gatewayStarting = false;
    }
  }

  private _getConversationHistory(fromUser: string): OpenClawMessage[] {
    return OpenClawClient.conversationHistory.get(fromUser) || [];
  }

  private _addToHistory(fromUser: string, role: OpenClawMessage['role'], content: string): void {
    let history = this._getConversationHistory(fromUser);
    const truncated = content.length > OpenClawClient.maxMessageLength
      ? content.substring(0, OpenClawClient.maxMessageLength) + '...'
      : content;
    history.push({ role, content: truncated });
    const maxMessages = OpenClawClient.maxHistoryRounds * 2;
    if (history.length > maxMessages) {
      history = history.slice(history.length - maxMessages);
    }
    OpenClawClient.conversationHistory.set(fromUser, history);
  }

  clearHistory(fromUser: string): void {
    OpenClawClient.conversationHistory.delete(fromUser);
  }

  private _buildMessagesWithHistory(fromUser: string, currentMessage: string): OpenClawMessage[] {
    const history = this._getConversationHistory(fromUser);
    return [...history, { role: 'user', content: currentMessage }];
  }

  cancelActiveRequest(fromUser: string): boolean {
    const active = OpenClawClient.activeRequests.get(fromUser);
    if (active) {
      log.info({ fromUser }, '取消用户活跃请求');
      active.abort();
      OpenClawClient.activeRequests.delete(fromUser);
      return true;
    }
    return false;
  }

  async chatStream(
    message: string,
    fromUser: string,
    onDelta: (delta: string) => void | Promise<void>,
    onDone: (fullText: string) => void | Promise<void>,
    onError?: (error: Error) => void | Promise<void>,
  ): Promise<void> {
    if (!message || !message.trim()) {
      onError?.(new Error('消息内容为空'));
      return;
    }

    const gatewayReady = await this.ensureGatewayRunning();
    if (!gatewayReady) {
      const err = new Error('OpenClaw gateway 启动失败');
      log.error(err.message);
      onError?.(err);
      return;
    }

    this.cancelActiveRequest(fromUser);

    log.info({ fromUser }, '准备 SSE 流式调用 OpenClaw');

    const gatewayToken = getGatewayToken();
    const sessionId = `clawmessenger-${fromUser}`;
    const messagesWithHistory = this._buildMessagesWithHistory(fromUser, message);

    const endpoints = [
      `${this.gatewayUrl}/v1/chat/completions`,
      `${this.gatewayUrl}/v1/responses`,
    ];

    for (let i = 0; i < endpoints.length; i++) {
      const apiUrl = endpoints[i];
      try {
        const fullText = await this._doChatStream(apiUrl, gatewayToken, sessionId, fromUser, messagesWithHistory, onDelta);
        this._addToHistory(fromUser, 'user', message);
        this._addToHistory(fromUser, 'assistant', fullText);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError' || err.message?.includes('aborted')) {
          log.info({ fromUser }, '请求被用户取消');
          return;
        }
        const is404 = err.response?.status === 404;
        const isLast = i === endpoints.length - 1;
        if (is404 && !isLast) {
          log.warn(`SSE 端点 ${apiUrl} 返回 404，尝试备用端点`);
          continue;
        }
        if (is404 && isLast) {
          log.error('所有 SSE 端点均返回 404。OpenClaw responses 端点未启用。');
          log.error('请检查 ~/.openclaw/openclaw.json 中是否包含: gateway.http.endpoints.responses.enabled = true');
        } else {
          log.error(`SSE 请求失败: ${err.message}`);
        }
        throw err;
      }
    }
  }

  private async _downloadImageAsBase64(imageUrl: string): Promise<{ base64: string; mediaType: string }> {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024,
    });
    const buffer = Buffer.from(response.data);
    const base64 = buffer.toString('base64');
    const mediaType = (response.headers['content-type'] as string) || 'image/jpeg';
    return { base64, mediaType };
  }

  private async _doChatStream(
    apiUrl: string,
    gatewayToken: string | null,
    sessionId: string,
    fromUser: string,
    messages: OpenClawMessage[],
    onDelta: (delta: string) => void | Promise<void>,
  ): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (gatewayToken) {
      headers.Authorization = `Bearer ${gatewayToken}`;
    }

    const lastMessage = messages[messages.length - 1];
    const messageContent = lastMessage?.content || '';
    const imageUrlMatch = messageContent.match(/\[图片\]\s*(https?:\/\/[^\s]+)/);

    let payload: Record<string, unknown>;

    if (imageUrlMatch) {
      const imageUrl = imageUrlMatch[1];
      const textContent = messageContent.replace(/\[图片\]\s*https?:\/\/[^\s]+/, '').trim();
      try {
        const imageData = await this._downloadImageAsBase64(imageUrl);
        const messagesWithImage = messages.slice(0, -1).concat([{
          role: 'user',
          content: [
            { type: 'text', text: textContent || '' },
            {
              type: 'image_url',
              image_url: { url: `data:${imageData.mediaType};base64,${imageData.base64}` },
            },
          ],
        } as unknown as OpenClawMessage]);
        payload = {
          model: 'openclaw',
          messages: messagesWithImage,
          stream: true,
          max_tokens: 2048,
        };
      } catch (err) {
        log.warn({ err: (err as Error).message }, '图片处理失败，回退到文本模式');
        payload = {
          model: 'openclaw',
          messages,
          stream: true,
          max_tokens: 2048,
        };
      }
    } else {
      payload = {
        model: 'openclaw',
        messages,
        stream: true,
        max_tokens: 2048,
      };
    }

    log.info({ apiUrl, payloadSummary: JSON.stringify(payload).substring(0, 200) }, 'SSE 请求');

    const abortController = new AbortController();
    OpenClawClient.activeRequests.set(fromUser, abortController);

    const response = await axios.post(apiUrl, payload, {
      headers,
      responseType: 'stream',
      timeout: 600000,
      signal: abortController.signal,
    });

    return new Promise((resolve, reject) => {
      let fullText = '';
      let buffer = '';
      let lastChunkData: unknown = null;
      let hasError = false;
      let errorMsg = '';

      response.data.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const dataStr = trimmed.slice(6).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr) as Record<string, unknown>;
            lastChunkData = data;

            if (data.error) {
              hasError = true;
              errorMsg = typeof data.error === 'string' ? data.error : ((data.error as Record<string, unknown>)?.message as string) || JSON.stringify(data.error);
              log.error({ error: errorMsg }, 'SSE chunk error');
              continue;
            }

            const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
            let delta: string | null = null;
            if (choice) {
              const deltaObj = choice.delta as Record<string, unknown> | undefined;
              delta = (deltaObj?.content as string | undefined)
                ?? (choice.message as Record<string, unknown>)?.content as string | undefined
                ?? (choice.text as string | undefined)
                ?? (deltaObj?.text as string | undefined)
                ?? (deltaObj?.reasoning_content as string | undefined)
                ?? null;
            }
            if (delta === null || delta === undefined) {
              delta = (data.content as string | undefined) ?? (data.delta as string | undefined) ?? (data.text as string | undefined) ?? null;
            }

            if (typeof delta === 'string' && delta.length > 0) {
              fullText += delta;
              Promise.resolve(onDelta(delta)).catch(reject);
            }
          } catch {
            // ignore parse error
          }
        }
      });

      response.data.on('end', async () => {
        OpenClawClient.activeRequests.delete(fromUser);
        log.info({ fullTextLength: fullText.length }, 'SSE 流结束');

        if (hasError) {
          reject(new Error(`OpenClaw SSE 错误: ${errorMsg}`));
          return;
        }

        if (fullText.length === 0) {
          const choices = (lastChunkData as Record<string, unknown> | undefined)?.choices as Array<Record<string, unknown>> | undefined;
          const message = choices?.[0]?.message as Record<string, unknown> | undefined;
          const lastContent = message?.content as string | undefined;
          if (typeof lastContent === 'string' && lastContent.length > 0) {
            fullText = lastContent;
          }
        }

        if (fullText.length === 0) {
          reject(new Error('OpenClaw SSE 返回空内容'));
          return;
        }

        try {
          await onDelta('');
          resolve(fullText);
        } catch (err) {
          reject(err);
        }
      });

      response.data.on('error', (err: Error) => {
        OpenClawClient.activeRequests.delete(fromUser);
        log.error({ err: err.message }, 'SSE 流错误');
        reject(err);
      });
    });
  }
}

export { getRealHomeDir, getOpenClawEnv, getGatewayToken, checkPort, ensureChatCompletionsConfig };
