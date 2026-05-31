import type { RongCloudMessage, ClawMessengerConfig } from './types.js';
import { RongyunMessageTypeEnum } from './types.js';
import { MessageDeduplicator } from './dedup.js';
import { SessionManager } from './session-manager.js';
import { RongCloudClient } from '../rongcloud/client.js';
import { OpenCodeClient, checkOpencodeStatus } from '../opencode/client.js';
import { createLogger } from './logger.js';

const log = createLogger('MessageHandler');

export class MessageHandler {
  private config: ClawMessengerConfig;
  private sessionManager: SessionManager;
  private rongClient: RongCloudClient;
  private opencode: OpenCodeClient;
  private dedup: MessageDeduplicator;

  constructor(
    config: ClawMessengerConfig,
    sessionManager: SessionManager,
    rongClient: RongCloudClient,
    opencode: OpenCodeClient,
  ) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.rongClient = rongClient;
    this.opencode = opencode;
    this.dedup = new MessageDeduplicator();
  }

  async handleMessage(msg: RongCloudMessage): Promise<void> {
    try {
      if (msg.messageUId && this.dedup.isDuplicate(msg.messageUId)) {
        log.debug({ messageUId: msg.messageUId }, 'Duplicate message filtered');
        return;
      }

      let msgContent: any;
      if (typeof msg.content === 'string') {
        try { msgContent = JSON.parse(msg.content); } catch { msgContent = { content: msg.content }; }
      } else if (msg.content && typeof msg.content === 'object') {
        msgContent = msg.content;
      } else {
        return;
      }

      let innerContent: any = {};
      if (msgContent.content && typeof msgContent.content === 'string') {
        try { innerContent = JSON.parse(msgContent.content); } catch { innerContent = { content: msgContent.content }; }
      }

      const customMsgType = msgContent.msg_type;
      const sourceImId = msgContent.source_im_id || msg.senderUserId;
      const requestId = msgContent.request_id;
      const merged = { ...msgContent, ...innerContent, request_id: requestId, source_im_id: sourceImId };

      switch (customMsgType || msg.messageType) {
        case RongyunMessageTypeEnum.CREATE_OPENCODE_SESSION:
        case 'create_opencode_session':
          await this.handleCreateOpencodeSession(merged, msg);
          return;

        case 'RC:TxtMsg':
        case 'TextMessage':
        case RongyunMessageTypeEnum.CHAT_MESSAGE:
        case 'chat_message':
          await this.handleChatMessage(merged, msg, customMsgType);
          return;

        case RongyunMessageTypeEnum.DEVICE_STATUS_REQUEST:
        case 'device_status_request':
          await this.handleDeviceStatusRequest(merged, msg);
          return;

        case RongyunMessageTypeEnum.DEVICE_CONTROL:
        case 'device_control':
          await this.handleDeviceControl(merged, msg);
          return;

        case 'command':
          await this.handleCommand(merged, msg);
          return;

        case RongyunMessageTypeEnum.DELETE_OPENCODE_SESSION:
        case 'delete_opencode_session':
          if (merged.session_id) {
            this.sessionManager.deleteSession(merged.session_id);
            await this.opencode.deleteSession(merged.session_id);
          }
          return;

        default:
          log.warn({ messageType: msg.messageType, customMsgType }, 'Unknown message type');
      }
    } catch (err) {
      log.error({ err }, '处理消息异常');
      try {
        await this.rongClient.sendMessage(
          msg.conversationType === 3 ? msg.targetId : msg.senderUserId,
          '处理失败，请稍后重试',
          msg.conversationType,
        );
      } catch {}
    }
  }

  private async handleChatMessage(data: any, msg: RongCloudMessage, originalMsgType?: string): Promise<void> {
    const sessionId = data?.session_id || `claw-${msg.senderUserId}`;

    let content = '';
    if (data?.content) {
      content = typeof data.content === 'string' ? data.content : (data.content.content || JSON.stringify(data.content));
    } else if (data?._raw_content) {
      content = typeof data._raw_content === 'string' ? data._raw_content : JSON.stringify(data._raw_content);
    }

    if (!content) {
      log.warn('Chat message content is empty');
      return;
    }

    log.info({ sessionId, contentLength: content.length }, 'Processing chat message');
    this.sessionManager.updateStatus(sessionId, 'busy');

    try {
      const session = await this.sessionManager.getOrCreateSession(sessionId, `ClawMessenger ${msg.senderUserId}`);
      const isChatMessage = originalMsgType === 'chat_message' || originalMsgType === RongyunMessageTypeEnum.CHAT_MESSAGE;

      // 使用异步模式，通过 SSE 事件流实时推送回复
      // OpenCode 会自动加载 directory 下的 .opencode/prompt.md 作为 system prompt
      await this.opencode.sendPromptAsync(session.id, content);
      log.info({ sessionId, opencodeSessionId: session.id }, 'promptAsync sent, streaming via SSE');
    } catch (err) {
      log.error({ err, sessionId }, '处理聊天消息失败');
      this.sessionManager.updateStatus(sessionId, 'idle');
      try {
        await this.rongClient.sendMessage(
          msg.conversationType === 3 ? msg.targetId : msg.senderUserId,
          '消息处理失败，请稍后重试',
          msg.conversationType,
        );
      } catch {}
    }
  }

  private async handleCreateOpencodeSession(data: any, msg: RongCloudMessage): Promise<void> {
    const targetId = data.source_im_id;
    const title = data.title || '新会话';

    try {
      const sessionId = `claw-${targetId}`;
      const session = await this.sessionManager.getOrCreateSession(sessionId, title);

      const response = {
        msg_type: RongyunMessageTypeEnum.OPENCODE_SESSION_CREATED,
        request_id: data.request_id,
        source_im_id: data.destination_im_id || msg.targetId,
        destination_im_id: targetId,
        content: JSON.stringify({ status: 'success', opencode_session_id: session.id, session_id: sessionId, title }),
        timestamp: Math.floor(Date.now() / 1000),
      };

      await this.rongClient.sendMessage(targetId, JSON.stringify(response), 1);
    } catch (err: any) {
      log.error({ err }, '创建 OpenCode 会话失败');
      const errorResponse = {
        msg_type: RongyunMessageTypeEnum.OPENCODE_SESSION_CREATED,
        request_id: data.request_id,
        source_im_id: data.destination_im_id || msg.targetId,
        destination_im_id: targetId,
        content: JSON.stringify({ status: 'error', message: err.message }),
        timestamp: Math.floor(Date.now() / 1000),
      };
      await this.rongClient.sendMessage(targetId, JSON.stringify(errorResponse), 1);
    }
  }

  private async handleDeviceStatusRequest(data: any, msg: RongCloudMessage): Promise<void> {
    const targetId = data.source_im_id;

    try {
      const opencodeOk = await checkOpencodeStatus(this.config.opencodeUrl, this.config.opencodePassword);
      const statusData = {
        open_claw_status: opencodeOk ? 1 : 0,
        status_message: opencodeOk ? '运行中' : '未运行',
        version: 'unknown',
        timestamp: Date.now(),
      };

      const report = {
        msg_type: RongyunMessageTypeEnum.DEVICE_STATUS_REPORT,
        request_id: data.request_id,
        source_im_id: this.config.accountId,
        destination_im_id: targetId,
        content: JSON.stringify(statusData),
        timestamp: Math.floor(Date.now() / 1000),
      };

      await this.rongClient.sendMessage(targetId, JSON.stringify(report), 1);
    } catch (err: any) {
      log.error({ err }, '设备状态查询异常');
    }
  }

  private async handleDeviceControl(data: any, msg: RongCloudMessage): Promise<void> {
    const targetId = data.source_im_id;
    const result = {
      msg_type: RongyunMessageTypeEnum.DEVICE_CONTROL_RESULT,
      request_id: data.request_id,
      command: data.command,
      status: 'success',
      message: `命令 ${data.command} 已接收`,
    };
    await this.rongClient.sendMessage(targetId, JSON.stringify(result), 1);
  }

  private async handleCommand(data: any, msg: RongCloudMessage): Promise<void> {
    const response = {
      msg_type: 'command_result',
      request_id: data.request_id,
      source_im_id: data.destination_im_id,
      destination_im_id: data.source_im_id,
      content: JSON.stringify({ status: 'received', command: data.command }),
      timestamp: Math.floor(Date.now() / 1000),
    };
    await this.rongClient.sendMessage(data.source_im_id, JSON.stringify(response), 1);
  }
}
