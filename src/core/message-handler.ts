/**
 * MessageHandler — 融云 ↔ OpenCode 消息桥接
 */

import { RongyunClient, MessageHandler as IRongyunHandler, RongyunMessage, ConversationType } from '../rongyun/client.js';
import { OpenCodeClient } from '../opencode/client.js';
import type { RongyunConfig } from './config.js';

interface Session {
  id: string;
  chatId: string;
  status: 'idle' | 'busy';
}

const CONTEXT_PREFIX =
  '[系统指令：请全程使用简体中文进行思考和推理，包括分析过程、工具调用说明和中间步骤。最终回答可以保持用户要求的语言。]\n\n' +
  '[系统上下文] 当前融云对话ID: {chatId}\n' +
  '[系统上下文] 当前融云会话类型: {chatType}\n\n';

export class RongyunMessageHandler implements IRongyunHandler {
  private sessions = new Map<string, Session>();
  private client: RongyunClient;
  private opencode: OpenCodeClient;

  constructor(
    private config: RongyunConfig,
    rongyunClient: RongyunClient,
    private log?: Console
  ) {
    this.client = rongyunClient;
    this.opencode = new OpenCodeClient(config.opencodeUrl);
  }

  async onConnected(userId: string): Promise<void> {
    this.log?.info(`[Handler] 融云已连接, userId: ${userId}`);
  }

  onDisconnected(_code: number): void {
    this.log?.warn('[Handler] 融云已断开');
  }

  async onTextMessage(msg: RongyunMessage): Promise<void> {
    const chatId = msg.targetId;
    const chatType = msg.conversationType === ConversationType.GROUP ? 'group' : 'p2p';
    const senderId = msg.senderUserId;
    const text = msg.textContent || '';

    this.log?.info(`[Handler] [${chatType}] ${senderId}: ${text.slice(0, 80)}`);

    // 群聊策略检查
    if (chatType === 'group') {
      if (this.config.groupPolicy === 'disabled') return;
      if (this.config.groupPolicy === 'mention') {
        const prefix = this.config.mentionPrefix || 'claw_';
        if (!text.includes(`@${prefix}`)) return;
      }
    }

    // p2p 策略检查
    if (chatType === 'p2p' && this.config.p2pPolicy === 'disabled') return;

    // 获取或创建 session
    let session = this.sessions.get(chatId);
    if (!session || session.status === 'idle') {
      try {
        const s = await this.opencode.createSession(`Rongyun ${chatType} ${chatId}`);
        session = { id: s.id, chatId, status: 'busy' };
        this.sessions.set(chatId, session);
      } catch (err) {
        this.log?.error(`[Handler] 创建 session 失败: ${err}`);
        return;
      }
    }

    session.status = 'busy';

    // 构造上下文
    const context = CONTEXT_PREFIX
      .replace('{chatId}', chatId)
      .replace('{chatType}', chatType);

    // 发送已读回执
    this.client.sendReadReceipt(msg).catch(() => {});

    // 发送到 opencode
    try {
      await this.opencode.sendPrompt(session.id, context + text);
      this.log?.info(`[Handler] Prompt 已发送, session=${session.id}`);
    } catch (err) {
      this.log?.error(`[Handler] 发送 prompt 失败: ${err}`);
      await this.client.sendText(
        msg.conversationType,
        chatId,
        `❌ 处理失败: ${err}`
      );
    }

    session.status = 'idle';
  }

  /** 发送回复到融云 */
  async sendReply(
    conversationType: number,
    targetId: string,
    text: string
  ): Promise<void> {
    // 融云单条消息最长 2000 字，超过分段发送
    const chunks = splitText(text, 2000);
    for (const chunk of chunks) {
      await this.client.sendText(conversationType, targetId, chunk);
    }
  }
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}
