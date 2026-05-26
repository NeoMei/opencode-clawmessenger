/**
 * RongyunClient — 融云 IM WebSocket 客户端
 *
 * 基于 @rongcloud/imlib-next SDK 封装：
 * 1. 初始化 SDK (appkey)
 * 2. 连接融云 (token 登录)
 * 3. 监听消息 (MESSAGES 事件)
 * 4. 发送消息 (sendMessage)
 */

import RongIMLibModule from '@rongcloud/imlib-next';

const RongIMLib = (RongIMLibModule as any).default || RongIMLibModule;

export interface RongyunMessage {
  messageType: string;
  messageUId: string;
  senderUserId: string;
  targetId: string;
  conversationType: number;
  sentTime: number;
  messageDirection: number;
  isOffLineMessage: boolean;
  content: any;
  /** 文本内容（已解析） */
  textContent?: string;
  /** 媒体文件信息 */
  mediaInfo?: {
    type: 'image' | 'file';
    /** 融云文件 URL */
    fileUrl: string;
    /** 文件名（仅文件消息） */
    fileName?: string;
    /** 文件大小（仅文件消息） */
    fileSize?: number;
  };
}

export interface MessageHandler {
  onTextMessage(msg: RongyunMessage): Promise<void>;
  onMediaMessage(msg: RongyunMessage): Promise<void>;
  onConnected(userId: string): Promise<void>;
  onDisconnected(code: number): void;
}

export const ConversationType = {
  PRIVATE: 1,
  GROUP: 3,
} as const;

export class RongyunClient {
  private handler: MessageHandler | null = null;
  private isConnected = false;
  private accountId: string;
  private processedMessageUIds = new Set<string>();
  private sentMessageUIds = new Set<string>();
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private onHeartbeat?: () => void;

  setHeartbeatHandler(handler: () => void): void {
    this.onHeartbeat = handler;
  }

  startHeartbeat(intervalMs = 30000): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.log?.info('[RongyunClient] 心跳');
      this.onHeartbeat?.();
    }, intervalMs);
    this.log?.info(`[RongyunClient] 心跳已启动 (${intervalMs}ms)`);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  constructor(
    private config: { appKey: string; token: string; accountId: string; botUserId?: string },
    private log?: Console
  ) {
    this.accountId = config.botUserId || config.accountId;
  }

  async connect(handler: MessageHandler): Promise<boolean> {
    this.handler = handler;
    this.log?.info('[RongyunClient] 连接融云...');

    if (!RongIMLib || typeof RongIMLib.init !== 'function') {
      this.log?.error('[RongyunClient] SDK 未正确加载');
      return false;
    }

    // 初始化 SDK
    RongIMLib.init({ appkey: this.config.appKey });
    this.log?.info('[RongyunClient] SDK 已初始化');

    // 注册事件监听
    this.registerEvents();

    // 连接
    try {
      const result = await RongIMLib.connect(this.config.token);
      this.log?.info(`[RongyunClient] connect: code=${result.code}`);

      if (result.code === 0 || result.code === 200) {
        const userId = result.data?.userId || 'unknown';
        this.isConnected = true;
        this.log?.info(`[RongyunClient] 登录成功, userId: ${userId}`);
        await handler.onConnected(userId);
        return true;
      } else {
        this.log?.error(`[RongyunClient] 登录失败: code=${result.code}`);
        return false;
      }
    } catch (err: any) {
      this.log?.error(`[RongyunClient] 连接异常: ${err.message}`);
      return false;
    }
  }

  private registerEvents(): void {
    if (!RongIMLib.addEventListener) return;

    // 消息接收
    RongIMLib.addEventListener(
      RongIMLib.Events?.MESSAGES || 'MESSAGES',
      (event: any) => {
        event.messages?.forEach((msg: RongyunMessage) => {
          this.handleReceivedMessage(msg);
        });
      }
    );

    // 连接成功
    RongIMLib.addEventListener(
      RongIMLib.Events?.CONNECTED || 'CONNECTED',
      () => {
        this.isConnected = true;
        this.log?.info('[RongyunClient] 连接成功事件');
      }
    );

    // 断开连接
    RongIMLib.addEventListener(
      RongIMLib.Events?.DISCONNECT || 'DISCONNECT',
      (code: number) => {
        this.isConnected = false;
        this.log?.warn(`[RongyunClient] 断开连接: code=${code}`);
        this.handler?.onDisconnected(code);
      }
    );
  }

  private handleReceivedMessage(msg: RongyunMessage): void {
    // 过滤离线消息
    if (msg.isOffLineMessage) {
      this.log?.info('[RongyunClient] 离线消息，忽略');
      return;
    }

    // 过滤自己发送的消息
    if (msg.messageDirection === 1) return;
    if (msg.senderUserId === this.accountId) return;
    if (msg.messageUId && this.sentMessageUIds.has(msg.messageUId)) return;

    // 去重
    const dedupKey = msg.messageUId || `${msg.senderUserId}-${msg.sentTime}`;
    if (this.processedMessageUIds.has(dedupKey)) return;
    this.processedMessageUIds.add(dedupKey);
    if (this.processedMessageUIds.size > 1000) {
      this.processedMessageUIds.clear();
    }

    // 解析内容
    const msgType = msg.messageType;
    const isMedia = ['RC:ImgMsg', 'RC:SightMsg', 'RC:FileMsg', 'RC:HQVCMsg'].includes(msgType);

    if (isMedia) {
      // 媒体消息：提取文件 URL
      let parsed: any = {};
      try { parsed = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content; } catch {}
      msg.mediaInfo = {
        type: msgType === 'RC:ImgMsg' || msgType === 'RC:SightMsg' ? 'image' : 'file',
        fileUrl: parsed.fileUrl || parsed.content || parsed.remoteUrl || '',
        fileName: parsed.name || '',
        fileSize: parsed.size || 0,
      };
      msg.textContent = `[${msg.mediaInfo.type === 'image' ? '图片' : '文件'}: ${msg.mediaInfo.fileName || msg.mediaInfo.fileUrl}]`;
    } else {
      // 文本消息
      let textContent = '';
      try {
        if (typeof msg.content === 'string') {
          textContent = msg.content;
        } else if (msg.content?.content) {
          textContent = msg.content.content;
        } else if (msg.content?.text) {
          textContent = msg.content.text;
        }
      } catch {}
      msg.textContent = textContent;
    }

    this.log?.info(
      `[RongyunClient] 消息: sender=${msg.senderUserId}, type=${msg.conversationType}, ${isMedia ? 'media=' + msg.mediaInfo?.type : 'text="' + (msg.textContent || '').slice(0, 50) + '"'}`
    );

    if (isMedia) {
      this.handler?.onMediaMessage(msg);
    } else {
      this.handler?.onTextMessage(msg);
    }
  }

  /** 发送文本消息 */
  async sendText(
    conversationType: number,
    targetId: string,
    text: string
  ): Promise<{ messageUId?: string }> {
    if (!this.isConnected) {
      throw new Error('融云未连接');
    }

    const msg = new (RongIMLib as any).TextMessage({ content: text });
    const result = await (RongIMLib as any).sendMessage(
      conversationType,
      targetId,
      msg
    );

    // 记录已发送的消息 UID，防止回传
    if (result.data?.messageUId) {
      this.sentMessageUIds.add(result.data.messageUId);
      if (this.sentMessageUIds.size > 100) {
        this.sentMessageUIds.clear();
      }
    }

    this.log?.info(
      `[RongyunClient] 发送: target=${targetId}, text="${text.slice(0, 50)}"`
    );

    return result.data || {};
  }

  /** 发送已读回执 */
  async sendReadReceipt(msg: RongyunMessage): Promise<void> {
    try {
      if ((RongIMLib as any).sendReadReceiptMessage) {
        await (RongIMLib as any).sendReadReceiptMessage({
          conversationType: msg.conversationType,
          targetId: msg.targetId,
          timestamp: msg.sentTime,
        });
      }
    } catch {}
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (RongIMLib.disconnect) {
      RongIMLib.disconnect();
    }
    this.isConnected = false;
  }
}
