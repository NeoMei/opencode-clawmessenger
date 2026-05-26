/**
 * ClawMessenger 协议消息发送器
 * 封装与 guardserver 的消息交互
 */

import { RongyunClient, ConversationType } from '../rongyun/client.js';
import { getMacAddress } from './mac-address.js';
import { generateSecret } from './auth.js';
import type { ClawProtocolMessage } from './message-types.js';

export class ClawMessageSender {
  private serverImId = 'guardserver';

  constructor(
    private client: RongyunClient,
    private config: { accountId: string; secretKey?: string },
    private log?: Console
  ) {}

  buildMessage(
    msgType: string,
    content: string | object,
    requestId = ''
  ): ClawProtocolMessage {
    const mac = getMacAddress();
    const secret = generateSecret(mac, this.config.secretKey || 'secret_key');

    return {
      msg_type: msgType,
      source_im_id: this.config.accountId,
      destination_im_id: this.serverImId,
      mac,
      secret,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      request_id: requestId || '',
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  async sendProtocolMessage(
    msgType: string,
    content: string | object,
    requestId = ''
  ): Promise<boolean> {
    try {
      const payload = this.buildMessage(msgType, content, requestId);
      await this.client.sendText(
        ConversationType.PRIVATE,
        this.serverImId,
        JSON.stringify(payload)
      );
      return true;
    } catch (err) {
      this.log?.error(`[ClawSender] 发送失败: ${err}`);
      return false;
    }
  }

  /** 发送设备状态报告 */
  async reportStatus(status: string): Promise<boolean> {
    return this.sendProtocolMessage('device_status_report', {
      status,
      timestamp: Date.now(),
    });
  }

  /** 发送聊天消息 */
  async sendChatMessage(text: string): Promise<boolean> {
    return this.sendProtocolMessage('chat_message', { text });
  }

  /** 通知 session 已创建 */
  async notifySessionCreated(sessionId: string): Promise<boolean> {
    return this.sendProtocolMessage('opencode_session_created', {
      session_id: sessionId,
    });
  }
}
