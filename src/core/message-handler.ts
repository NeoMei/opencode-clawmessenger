/**
 * MessageHandler — ClawMessenger ↔ OpenCode 消息桥接
 *
 * 接收融云消息 → 转发到 OpenCode → 流式接收 AI 回复 → 发回融云
 */

import { RongyunClient, MessageHandler as IRongyunHandler, RongyunMessage, ConversationType } from '../rongyun/client.js';
import { OpenCodeClient } from '../opencode/client.js';
import type { RongyunConfig } from './config.js';
import type { ClawMessageSender } from '../modules/message-sender.js';

interface Session {
  id: string;
  chatId: string;
  status: 'idle' | 'busy';
}

const CONTEXT_PREFIX =
  '[系统指令：请全程使用简体中文进行思考和推理，包括分析过程、工具调用说明和中间步骤。最终回答可以保持用户要求的语言。]\n\n' +
  '[系统上下文] 当前 ClawMessenger 对话ID: {chatId}\n' +
  '[系统上下文] 当前会话类型: {chatType}\n\n';

export class RongyunMessageHandler implements IRongyunHandler {
  private sessions = new Map<string, Session>();
  private client: RongyunClient;
  private opencode: OpenCodeClient;

  constructor(
    private config: RongyunConfig,
    rongyunClient: RongyunClient,
    private clawSender: ClawMessageSender,
    private log?: Console
  ) {
    this.client = rongyunClient;
    this.opencode = new OpenCodeClient(config.opencodeUrl);
  }

  async onConnected(_userId: string): Promise<void> {
    this.log?.info('[Handler] ClawMessenger 已连接');
  }

  onDisconnected(_code: number): void {
    this.log?.warn('[Handler] ClawMessenger 已断开');
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
    if (chatType === 'p2p' && this.config.p2pPolicy === 'disabled') return;

    // 发送已读回执
    this.client.sendReadReceipt(msg).catch(() => {});

    // 发送 "正在输入..." 状态
    this.client.sendText(msg.conversationType, chatId, '⏳').catch(() => {});

    try {
      // 获取或创建 OpenCode session
      let session = this.sessions.get(chatId);
      if (!session) {
        const s = await this.opencode.createSession(`ClawMessenger ${chatType} ${chatId}`);
        session = { id: s.id, chatId, status: 'idle' };
        this.sessions.set(chatId, session);
        // 通知 guardserver session 已创建
        this.clawSender.notifySessionCreated(s.id).catch(() => {});
      }

      session.status = 'busy';
      const context = CONTEXT_PREFIX
        .replace('{chatId}', chatId)
        .replace('{chatType}', chatType);

      // 发送到 OpenCode 并流式接收回复
      const sessionId = session.id;
      await this.opencode.sendPrompt(
        sessionId,
        context + text,
        // onText: 流式增量（融云不支持流式，所以攒着最后一起发）
        (_delta: string) => {},
        // onDone: AI 回复完成，发回融云
        async (fullText: string) => {
          if (fullText.trim()) {
            await this.sendReply(msg.conversationType, chatId, fullText);
          }
          session.status = 'idle';
        },
        // onError
        async (err: Error) => {
          this.log?.error(`[Handler] OpenCode 错误: ${err.message}`);
          await this.client.sendText(
            msg.conversationType, chatId,
            `❌ 处理失败: ${err.message}`
          );
          session.status = 'idle';
        }
      );
    } catch (err: any) {
      this.log?.error(`[Handler] 异常: ${err.message}`);
      const session = this.sessions.get(chatId);
      if (session) session.status = 'idle';
    }
  }

  /** 发送回复到融云，超长分段 */
  async sendReply(
    conversationType: number,
    targetId: string,
    text: string
  ): Promise<void> {
    const chunks = splitText(text, 2000);
    for (const chunk of chunks) {
      await this.client.sendText(conversationType, targetId, chunk);
      // 小延迟避免融云限流
      await sleep(100);
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
