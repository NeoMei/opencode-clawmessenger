import './env-polyfill.js';
import * as RongIMLibModule from '@rongcloud/imlib-next';
import type { Logger } from '../core/logger.js';
import type { RongCloudMessage } from '../core/types.js';

const RongIMLib: any = RongIMLibModule;

export class RongCloudClient {
  private config: { appKey: string; token: string; accountId: string };
  private log: Logger;
  private _isConnected = false;
  private messageHandler?: (msg: RongCloudMessage) => void;
  private sentMessageUIds = new Set<string>();
  private CommandMessage: any;
  private ServiceChatMessage: any;
  private OpsChatMessage: any;
  private OpsChatResponseMessage: any;

  constructor(config: { appKey: string; token: string; accountId: string }, log: Logger) {
    this.config = config;
    this.log = log;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(handler: (msg: RongCloudMessage) => void): Promise<boolean> {
    this.messageHandler = handler;
    this.log.info('开始连接融云...');

    if (!RongIMLib || typeof RongIMLib.init !== 'function') {
      this.log.error('SDK 未正确加载');
      return false;
    }

    RongIMLib.init({ appkey: this.config.appKey });

    try {
      if (typeof RongIMLib.registerMessageType === 'function') {
        this.CommandMessage = RongIMLib.registerMessageType('command', false, false);
        this.ServiceChatMessage = RongIMLib.registerMessageType('service_chat', false, false);
        this.OpsChatMessage = RongIMLib.registerMessageType('ops_chat_message', false, false);
        this.OpsChatResponseMessage = RongIMLib.registerMessageType('ops_chat_response', false, false);
        this.log.info('自定义消息类型已注册 (command, service_chat, ops_chat_message, ops_chat_response)');
      }
    } catch (err: any) {
      this.log.warn({ err }, '注册自定义消息类型失败');
    }

    if (RongIMLib.addEventListener) {
      const eventName = RongIMLib.Events?.MESSAGES || 'MESSAGES';
      this.log.info({ eventName }, '注册消息监听器');
      RongIMLib.addEventListener(eventName, (event: any) => {
        this.log.info({ messageCount: event.messages?.length }, '融云消息事件触发');
        event.messages?.forEach((msg: RongCloudMessage) => {
          this.handleReceivedMessage(msg);
        });
      });

      RongIMLib.addEventListener(RongIMLib.Events?.CONNECTED || 'CONNECTED', () => {
        this.log.info('融云连接成功');
        this._isConnected = true;
      });

      RongIMLib.addEventListener(RongIMLib.Events?.DISCONNECT || 'DISCONNECT', (code: any) => {
        this.log.warn({ code }, '融云断开连接');
        this._isConnected = false;
      });
    }

    try {
      const result = await RongIMLib.connect(this.config.token);
      if (result.code === 0 || result.code === 200) {
        this.log.info({ userId: result.data?.userId }, '融云登录成功');
        this._isConnected = true;
        return true;
      } else {
        this.log.error({ code: result.code }, '融云登录失败');
        return false;
      }
    } catch (err: any) {
      this.log.error({ err }, '融云连接异常');
      return false;
    }
  }

  private handleReceivedMessage(message: RongCloudMessage): void {
    try {
      if (message.messageDirection === 1) {
        this.log.info({ messageType: message.messageType, senderUserId: message.senderUserId }, '忽略自己发送的消息');
        return;
      }
      if (message.senderUserId === this.config.accountId) {
        this.log.info({ messageType: message.messageType, senderUserId: message.senderUserId }, '忽略同一账号消息');
        return;
      }
      if (message.messageUId && this.sentMessageUIds.has(message.messageUId)) {
        this.log.info({ messageType: message.messageType, messageUId: message.messageUId }, '忽略已发送消息');
        return;
      }
      if (message.isOffLineMessage) {
        this.log.info({ messageType: message.messageType, senderUserId: message.senderUserId }, '忽略离线消息');
        return;
      }

      this.log.info({
        messageType: message.messageType,
        senderUserId: message.senderUserId,
        conversationType: message.conversationType,
        messageDirection: message.messageDirection,
        isOffLineMessage: message.isOffLineMessage,
        hasContent: !!message.content,
        contentType: typeof message.content,
      }, '收到消息');

      Promise.resolve().then(() => {
        this.messageHandler?.(message);
      }).catch((err: any) => {
        this.log.error({ err }, '消息处理异常');
      });

      // 注：已读回执功能
      // uniapp端已禁用融云原生已读回执(enableReadReceipt: false)
      // 因此sendReadReceipt和clearUnreadStatus调用不会产生跨端效果
      // 如需已读状态，需在uniapp端开启enableReadReceipt或在后端自行维护
      if (message.messageUId && message.sentTime) {
        this.clearUnreadStatus(message.conversationType, message.senderUserId);
      }
    } catch (err: any) {
      this.log.error({ err }, 'handleReceivedMessage 异常');
    }
  }

  async sendMessage(targetId: string, content: string, conversationType: number = 1): Promise<void> {
    if (!this._isConnected) {
      this.log.warn('融云未连接，无法发送消息');
      throw new Error('RongCloud not connected');
    }

    try {
      let messageContent: any;
      let parsedContent: any = null;
      try { parsedContent = JSON.parse(content); } catch {}

      if (parsedContent && parsedContent.msg_type) {
        const msgType = parsedContent.msg_type;
        if (msgType === 'ops_chat_message' && this.OpsChatMessage) {
          messageContent = new this.OpsChatMessage(parsedContent);
        } else if (msgType === 'ops_chat_response' && this.OpsChatResponseMessage) {
          messageContent = new this.OpsChatResponseMessage(parsedContent);
        } else if (msgType === 'service_chat' && this.ServiceChatMessage) {
          messageContent = new this.ServiceChatMessage(parsedContent);
        } else if (this.CommandMessage) {
          messageContent = new this.CommandMessage(parsedContent);
        } else {
          messageContent = { messageName: msgType, content };
        }
      } else {
        const safeContent = content || '';
        if (RongIMLib.TextMessage) {
          messageContent = new RongIMLib.TextMessage({ content: safeContent });
        } else {
          messageContent = { messageName: 'RC:TxtMsg', content: safeContent };
        }
      }

      const result = await RongIMLib.sendMessage(
        { conversationType, targetId },
        messageContent,
        { needReceipt: true },
      );

      if (result.code === 0 && result.data?.messageUId) {
        this.sentMessageUIds.add(result.data.messageUId);
        if (this.sentMessageUIds.size > 100) {
          const first = this.sentMessageUIds.values().next().value;
          if (first) this.sentMessageUIds.delete(first);
        }
      } else if (result.code !== 0) {
        throw new Error(`RongCloud send failed: code=${result.code}, msg=${result.msg || 'unknown'}`);
      }

      this.log.info({ targetId }, '消息发送成功');
    } catch (err: any) {
      this.log.error({ err, targetId }, '消息发送失败');
      throw err;
    }
  }

  async sendReadReceipt(targetId: string, messageUId: string, timestamp: number): Promise<void> {
    if (!this._isConnected) {
      this.log.warn('融云未连接，跳过已读回执');
      return;
    }
    this.log.info({ targetId, messageUId, timestamp }, '准备发送已读回执');
    try {
      const result = await RongIMLib.sendReadReceiptMessage(targetId, messageUId, timestamp);
      this.log.info({ code: result.code, targetId, messageUId }, '已读回执发送结果');
      if (result.code === 0 || result.code === 200) {
        this.log.info({ targetId, messageUId }, '已读回执发送成功');
      } else {
        this.log.warn({ code: result.code, msg: result.msg, targetId, messageUId }, '已读回执发送失败');
      }
    } catch (err: any) {
      this.log.error({ err: err.message || err, targetId, messageUId }, '发送已读回执异常');
    }
  }

  async clearUnreadStatus(conversationType: number, targetId: string): Promise<void> {
    if (!this._isConnected) {
      this.log.warn('融云未连接，跳过清除未读数');
      return;
    }
    this.log.info({ conversationType, targetId }, '准备清除未读数');
    try {
      const result = await RongIMLib.clearMessagesUnreadStatus({
        conversationType,
        targetId,
      });
      this.log.info({ code: result.code, conversationType, targetId }, '清除未读数结果');
      if (result.code === 0 || result.code === 200) {
        this.log.info({ targetId, conversationType }, '未读数清除成功');
      } else {
        this.log.warn({ code: result.code, msg: result.msg, targetId, conversationType }, '清除未读数失败');
      }
    } catch (err: any) {
      this.log.error({ err: err.message || err, targetId, conversationType }, '清除未读数异常');
    }
  }

  disconnect(): void {
    if (RongIMLib && typeof RongIMLib.disconnect === 'function') {
      RongIMLib.disconnect();
    }
    this._isConnected = false;
    this.log.info('融云连接已断开');
  }
}
