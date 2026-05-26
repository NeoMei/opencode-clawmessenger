import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.config', 'opencode');
const CONFIG_FILE = join(CONFIG_DIR, 'rongyun.json');

export interface RongyunConfig {
  appKey: string;
  token: string;
  accountId: string;
  /** 机器人用户在融云中的 userId，用于过滤自己发送的消息 */
  botUserId?: string;
  opencodeUrl: string;
  /** 单聊策略: 'open' | 'disabled' */
  p2pPolicy: 'open' | 'disabled';
  /** 群聊策略: 'open' | 'mention' | 'disabled' */
  groupPolicy: 'open' | 'mention' | 'disabled';
  /** 群聊 @ 提及的机器人账号前缀 */
  mentionPrefix?: string;
  /** 是否自动通过 opencode 工具权限 */
  autoApprove: boolean;
}

export const DEFAULT_CONFIG: Partial<RongyunConfig> = {
  opencodeUrl: 'http://localhost:19876',
  p2pPolicy: 'open',
  groupPolicy: 'mention',
  autoApprove: true,
};

export class ConfigManager {
  private config: RongyunConfig | null = null;

  load(): RongyunConfig {
    if (!existsSync(CONFIG_FILE)) {
      throw new Error(
        `融云配置文件不存在: ${CONFIG_FILE}\n` +
        '请运行: opencode-rongyun setup'
      );
    }
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    this.config = { ...DEFAULT_CONFIG, ...raw } as RongyunConfig;
    return this.config;
  }

  save(config: RongyunConfig): void {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }

  get(): RongyunConfig {
    if (!this.config) {
      this.config = this.load();
    }
    return this.config;
  }

  exists(): boolean {
    return existsSync(CONFIG_FILE);
  }
}
