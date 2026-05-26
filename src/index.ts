/**
 * opencode-rongyun — 魂器融云连接器
 *
 * 通过融云 IM SDK 与 OpenCode Agent 通信。
 * 用户发送消息到融云 → 桥接到 opencode serve → AI 回复 → 发回融云。
 */

export { RongyunClient } from './rongyun/client.js';
export { MessageHandler } from './core/message-handler.js';
export { OpenCodeClient } from './opencode/client.js';
export { ConfigManager } from './core/config.js';
