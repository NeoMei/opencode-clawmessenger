/**
 * opencode-clawmessenger — 魂器融云连接器
 *
 * 通过融云 IM SDK 与 OpenCode Agent 通信。
 * 用户发送消息到融云 → 桥接到 opencode serve → AI 回复 → 发回融云。
 */

export { RongyunClient, ConversationType } from './rongyun/client.js';
export type { RongyunMessage, MessageHandler as IMessageHandler } from './rongyun/client.js';
export { RongyunMessageHandler } from './core/message-handler.js';
export { OpenCodeClient } from './opencode/client.js';
export { ConfigManager } from './core/config.js';
export type { RongyunConfig } from './core/config.js';
export { ClawMessageSender } from './modules/message-sender.js';
export * from './modules/message-types.js';
export { getMacAddress } from './modules/mac-address.js';
export { generateSecret, verifySecret } from './modules/auth.js';
