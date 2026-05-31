import { createLogger } from '../core/logger.js';
import type { RongCloudClient } from '../rongcloud/client.js';
import type { SessionManager } from '../core/session-manager.js';
import type { OpenCodeClient } from './client.js';
import { RongCloudServerAPI } from '../rongcloud/server-api.js';
import type { ClawMessengerConfig } from '../core/types.js';

const log = createLogger('EventHandler');

interface StreamState {
  messageUID: string;
  seq: number;
  lastContent: string;
  lastSentTime: number;
}

export class EventHandler {
  private sessionManager: SessionManager;
  private rongClient: RongCloudClient;
  private opencode: OpenCodeClient;
  private streamAPI: RongCloudServerAPI;
  private config: ClawMessengerConfig;
  private isRunning = false;
  private sentSessions = new Set<string>();
  private streamStates = new Map<string, StreamState>();

  constructor(
    sessionManager: SessionManager,
    rongClient: RongCloudClient,
    opencode: OpenCodeClient,
    config: ClawMessengerConfig,
  ) {
    this.sessionManager = sessionManager;
    this.rongClient = rongClient;
    this.opencode = opencode;
    this.config = config;
    this.streamAPI = new RongCloudServerAPI(config.appKey, config.appSecret || '');
  }

  async start(eventStream: { stream: AsyncGenerator<any, void, unknown> }): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    log.info('Event handler started');

    try {
      for await (const event of eventStream.stream) {
        if (!this.isRunning) break;
        await this.handleEvent(event);
      }
    } catch (err) {
      log.error({ err }, 'SSE stream error');
    } finally {
      this.isRunning = false;
    }
  }

  stop(): void {
    this.isRunning = false;
  }

  private async handleEvent(globalEvent: any): Promise<void> {
    try {
      const payload = globalEvent.payload || globalEvent;
      const props = payload.properties || payload;

      log.info({ type: payload.type, hasProperties: !!payload.properties }, 'SSE event received');

      switch (payload.type) {
        case 'session.idle':
          log.info({ sessionId: props.sessionID }, 'Session idle event');
          await this.handleSessionIdle(props);
          break;
        case 'message.part.updated':
          log.info({ sessionId: props.sessionID }, 'Message part updated event');
          await this.handleMessagePartUpdated(props);
          break;
        case 'message.updated':
          log.info({ sessionId: props.sessionID, messageKeys: Object.keys(props.message || {}) }, 'Message updated event');
          await this.handleMessageUpdated(props);
          break;
        case 'session.status':
          this.handleStatusChange(props);
          break;
        case 'session.error':
          await this.handleError(props);
          break;
        default:
          log.debug({ type: payload.type }, 'Unhandled event type');
      }
    } catch (err) {
      log.error({ err }, 'Error handling event');
    }
  }

  private async handleSessionIdle(properties: { sessionID: string }): Promise<void> {
    const sessionId = properties.sessionID;
    
    // 立即标记已处理，防止并发重复发送
    if (this.sentSessions.has(sessionId)) {
      log.debug({ sessionId }, 'Already sent reply for this session, skipping');
      return;
    }
    this.sentSessions.add(sessionId);
    
    // 清理流式状态（无论是否使用流式消息）
    const streamState = this.streamStates.get(sessionId);
    if (streamState) {
      this.streamStates.delete(sessionId);
    }
    
    log.info({ sessionId }, 'Handling session idle');
    
    const chatId = this.sessionManager.getChatIdBySession(sessionId);
    if (!chatId) {
      log.warn({ sessionId }, 'No chatId found for session');
      return;
    }

    const text = await this.opencode.fetchLastMessageText(sessionId);
    log.info({ sessionId, chatId, hasText: !!text }, 'Fetched last message');
    
    if (text) {
      const targetId = chatId.replace('claw-', '');
      log.info({ targetId, textLength: text.length }, 'Sending reply via normal message');
      await this.rongClient.sendMessage(targetId, text, 1);
      // sentSessions 已在函数开头添加
    }

    this.sessionManager.updateStatus(chatId, 'idle');
  }

  private async handleMessagePartUpdated(properties: { sessionID: string; message?: any }): Promise<void> {
    // 注：uniapp端chat页面只支持 messageType === 'text' 的消息
    // RC:StreamMsg 的消息类型不是 'text'，因此不会被渲染
    // 如需启用流式消息，需修改uniapp端支持 RC:StreamMsg
    // 当前实现：仅在 session.idle 时发送普通文本消息
    const sessionId = properties.sessionID;
    log.debug({ sessionId }, 'message.part.updated received (streaming disabled - uniapp does not support RC:StreamMsg)');
    
    // 可选：追踪流式进度但不发送
    const chatId = this.sessionManager.getChatIdBySession(sessionId);
    if (chatId) {
      const text = await this.opencode.fetchLastMessageText(sessionId);
      if (text) {
        log.debug({ sessionId, textLength: text.length }, 'Streaming progress tracked');
      }
    }
  }

  private async handleMessageUpdated(properties: { sessionID: string; message?: any }): Promise<void> {
    const sessionId = properties.sessionID;
    
    // message.updated 只用于追踪消息内容更新，不发送消息
    // 消息发送统一由 session.idle 处理，避免重复发送
    log.debug({ sessionId }, 'Message.updated received (content tracking only, not sending)');
    
    // 如果已经在流式发送中，忽略
    if (this.streamStates.has(sessionId)) {
      return;
    }
    
    // 如果已发送，忽略
    if (this.sentSessions.has(sessionId)) {
      return;
    }
    
    // 只记录消息内容更新，不发送
    const chatId = this.sessionManager.getChatIdBySession(sessionId);
    if (!chatId) {
      log.warn({ sessionId }, 'No chatId found for message.updated');
      return;
    }

    const session = this.sessionManager.getSession(chatId);
    if (!session || session.status !== 'busy') {
      return;
    }

    // 尝试从事件的 message 对象直接获取文本（仅用于日志记录）
    const msg = properties.message;
    if (msg) {
      const role = msg.info?.role || msg.role;
      if (role === 'assistant' || role === 'model') {
        if (msg.parts && msg.parts.length > 0) {
          const textPart = msg.parts.find((p: any) => p.type === 'text');
          if (textPart?.text) {
            log.debug({ sessionId, textLength: textPart.text.length }, 'AI response content updated');
          }
        }
      }
    }
  }

  private handleStatusChange(properties: { sessionID: string; status: { type: string } }): void {
    const chatId = this.sessionManager.getChatIdBySession(properties.sessionID);
    if (chatId && properties.status.type === 'busy') {
      this.sessionManager.updateStatus(chatId, 'busy');
      // Clear sentSessions to allow new replies in this session
      if (this.sentSessions.delete(properties.sessionID)) {
        log.debug({ sessionId: properties.sessionID }, 'Cleared sent flag for new message turn');
      }
    }
  }

  private async handleError(properties: { sessionID?: string; error: string }): Promise<void> {
    if (!properties.sessionID) return;
    const chatId = this.sessionManager.getChatIdBySession(properties.sessionID);
    if (!chatId) return;

    log.error({ sessionId: properties.sessionID, error: properties.error }, 'Session error');
    const targetId = chatId.replace('claw-', '');
    await this.rongClient.sendMessage(targetId, `AI 处理出错: ${properties.error}`, 1);
    this.sessionManager.updateStatus(chatId, 'idle');
  }
}
