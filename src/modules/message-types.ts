/**
 * ClawMessenger 消息类型枚举
 * 与桌面客户端保持一致
 */
export const ClawMessageType = {
  CLIENT_CONNECTED: 'client_connected',
  CLIENT_DISCONNECTED: 'client_disconnected',
  HEARTBEAT: 'heartbeat',
  HEARTBEAT_ACK: 'heartbeat_ack',
  COMMAND: 'command',
  COMMAND_RESULT: 'command_result',
  CHAT_MESSAGE: 'chat_message',
  CREATE_OPENCODE_SESSION: 'create_opencode_session',
  OPENCODE_SESSION_CREATED: 'opencode_session_created',
  DELETE_OPENCODE_SESSION: 'delete_opencode_session',
  DEVICE_CONTROL: 'device_control',
  DEVICE_CONTROL_RESULT: 'device_control_result',
  DEVICE_STATUS_REQUEST: 'device_status_request',
  DEVICE_STATUS_REPORT: 'device_status_report',
  DASHBOARD_REPORT: 'dashboard_report',
} as const;

export type ClawMessageType = (typeof ClawMessageType)[keyof typeof ClawMessageType];

export interface ClawProtocolMessage {
  msg_type: string;
  source_im_id: string;
  destination_im_id: string;
  mac: string;
  secret: string;
  content: string;
  request_id: string;
  timestamp: number;
}
