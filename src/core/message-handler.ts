/**
 * MessageHandler — ClawMessenger ↔ OpenCode 流式消息桥接
 *
 * 融云消息 → OpenCode SSE 流式 → 融云 RC:StreamMsg 流式回传
 */

import { RongyunClient, MessageHandler as IRongyunHandler, RongyunMessage, ConversationType } from '../rongyun/client.js';
import { OpenCodeClient } from '../opencode/client.js';
import { RongCloudServerAPI } from '../rongyun/server-api.js';
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
  private rongApi: RongCloudServerAPI;
  private clawSender?: ClawMessageSender;

  constructor(
    private config: RongyunConfig,
    rongyunClient: RongyunClient,
    senderOrLog?: ClawMessageSender | Console,
    private log?: Console
  ) {
    this.client = rongyunClient;
    this.opencode = new OpenCodeClient(config.opencodeUrl);
    this.rongApi = new RongCloudServerAPI(config.appKey, config.appSecret, log || (senderOrLog as Console));
    if (senderOrLog && 'buildMessage' in (senderOrLog as any)) {
      this.clawSender = senderOrLog as ClawMessageSender;
      this.log = undefined; // senderOrLog was the sender, 4th param is log
    }
  }

  async onConnected(_userId: string): Promise<void> {
    this.log?.info('[Handler] ClawMessenger 已连接');
  }

  async onDisconnected(_code: number): Promise<void> {
    this.log?.warn('[Handler] ClawMessenger 已断开');
  }

  async onMediaMessage(msg: RongyunMessage): Promise<void> {
    const chatId = msg.targetId;
    const chatType = msg.conversationType === ConversationType.GROUP ? 'group' : 'p2p';
    const media = msg.mediaInfo;
    if (!media?.fileUrl) return;

    this.log?.info(`[Handler] [${chatType}] media: ${media.type}, url=${media.fileUrl}`);

    // 将媒体 URL 作为文件路径传给 OpenCode
    const text = `[用户发送了一个${media.type === 'image' ? '图片' : '文件'}]\n文件URL: ${media.fileUrl}\n文件名: ${media.fileName || 'unknown'}\n大小: ${media.fileSize || 0} bytes`;
    // 复用文本消息处理
    msg.textContent = text;
    await this.onTextMessage(msg);
  }

  async onTextMessage(msg: RongyunMessage): Promise<void> {
    const chatId = msg.targetId;
    const chatType = msg.conversationType === ConversationType.GROUP ? 'group' : 'p2p';
    const senderId = msg.senderUserId;
    const text = msg.textContent || '';

    // ── 协议消息处理 ──
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}

    if (parsed?.type === 'bind_openclaw_push') {
      // App 扫码后推送融云凭证到服务端
      this.log?.info('[Handler] 收到凭证推送: ' + (parsed.app_key || '?'));
      this.config.appKey = parsed.app_key || this.config.appKey;
      this.config.appSecret = parsed.app_secret || this.config.appSecret;
      this.config.token = parsed.token || this.config.token;
      this.config.accountId = parsed.account_id || parsed.node_id || this.config.accountId;
      // 保存到配置文件
      const { ConfigManager } = await import('../core/config.js');
      new ConfigManager().save(this.config);
      await this.client.sendText(msg.conversationType, chatId,
        JSON.stringify({ type: 'bind_ack', node_id: parsed.node_id, status: 'ok' })
      );
      return;
    }

    if (senderId === this.config.accountId) return;  // 过滤自己的消息

    this.log?.info(`[Handler] [${chatType}] ${senderId}: ${text.slice(0, 80)}`);

    // 策略检查
    if (chatType === 'group') {
      if (this.config.groupPolicy === 'disabled') return;
      if (this.config.groupPolicy === 'mention') {
        const prefix = this.config.mentionPrefix || 'claw_';
        if (!text.includes(`@${prefix}`)) return;
      }
    }
    if (chatType === 'p2p' && this.config.p2pPolicy === 'disabled') return;

    // 已读回执
    this.client.sendReadReceipt(msg).catch(() => {});

    try {
      let session = this.sessions.get(chatId);
      if (!session) {
        const s = await this.opencode.createSession(`ClawMessenger ${chatType} ${chatId}`);
        session = { id: s.id, chatId, status: 'idle' };
        this.sessions.set(chatId, session);
        this.clawSender?.notifySessionCreated(s.id).catch(() => {});
      }

      session.status = 'busy';
      const context = CONTEXT_PREFIX
        .replace('{chatId}', chatId)
        .replace('{chatType}', chatType);

      const streamId = `stream_${Date.now()}_${chatId.slice(0, 8)}`;
      let seq = 0;
      let messageUID = '';
      let fullText = '';

      await this.opencode.sendPromptStream(
        session.id,
        context + text,
        // onChunk: OpenCode 流式增量 → 融云流式消息
        async (delta: string, chunkSeq: number) => {
          seq++;
          fullText += delta;

          const isFirst = seq === 1;
          const isLast = false; // 不知道是不是最后，后面用 onDone 标记

          if (chatType === 'p2p') {
            const uid = await this.rongApi.streamPrivate({
              fromUserId: this.config.accountId,
              toUserId: chatId,
              content: fullText,
              streamId,
              isFirstChunk: isFirst,
              isLastChunk: isLast,
              seq,
              messageUID: messageUID || undefined,
            });
            // 首次获取 messageUID 用于后续更新
            if (isFirst && uid) messageUID = uid as any;
          } else {
            this.rongApi.streamGroup({
              fromUserId: this.config.accountId,
              toGroupId: chatId,
              content: fullText,
              streamId,
              isFirstChunk: isFirst,
              isLastChunk: isLast,
              seq,
              messageUID: messageUID || undefined,
            });
          }
        },
        // onError
        async (err: Error) => {
          this.log?.error(`[Handler] AI 错误: ${err.message}`);
          // 发送错误信息
          this.client.sendText(msg.conversationType, chatId, '❌ ' + err.message).catch(() => {});
          session.status = 'idle';
        }
      );

      // AI 回复完成 → 发送 final chunk
      if (fullText) {
        seq++;
        if (chatType === 'p2p') {
          await this.rongApi.streamPrivate({
            fromUserId: this.config.accountId,
            toUserId: chatId,
            content: fullText,
            streamId,
            isFirstChunk: false,
            isLastChunk: true,
            seq,
            messageUID: messageUID || undefined,
          });
        } else {
          await this.rongApi.streamGroup({
            fromUserId: this.config.accountId,
            toGroupId: chatId,
            content: fullText,
            streamId,
            isFirstChunk: false,
            isLastChunk: true,
            seq,
            messageUID: messageUID || undefined,
          });
        }
      }

      session.status = 'idle';
    } catch (err: any) {
      this.log?.error(`[Handler] 异常: ${err.message}`);
      const session = this.sessions.get(chatId);
      if (session) session.status = 'idle';
    }
  }
}
