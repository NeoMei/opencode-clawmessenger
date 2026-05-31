import { ConfigManager } from './core/config.js';
import { SessionManager } from './core/session-manager.js';
import { MessageHandler } from './core/message-handler.js';
import { RongCloudClient } from './rongcloud/client.js';
import { OpenCodeClient, checkOpencodeStatus } from './opencode/client.js';
import { EventHandler } from './opencode/event-handler.js';
import { createLogger } from './core/logger.js';
import { startStatusWriter } from './core/daemon.js';
import { getOrRegisterToken, loadAutoConfig, generateNodeId } from './core/auto-register.js';
import { encryptQR } from './core/qr-crypto.js';
import type { ClawMessengerConfig } from './core/types.js';
import { hostname } from 'os';

const log = createLogger('standalone');

export interface StartStandaloneOptions {
  configPath?: string;
  autoServe?: boolean;
}

export async function generateBindQR(nodeName?: string): Promise<{ nodeId: string; qrData: string }> {
  let nodeId = (await loadAutoConfig())?.nodeId;
  if (!nodeId) {
    nodeId = generateNodeId();
  }

  const name = nodeName || (await loadAutoConfig())?.nodeName || hostname();
  const bindData = JSON.stringify({ type: 'bind_openclaw', node_id: nodeId, name, timestamp: Date.now() });
  const encrypted = encryptQR(bindData);

  return { nodeId, qrData: encrypted };
}

export async function startStandalone(options: StartStandaloneOptions = {}): Promise<void> {
  const { configPath, autoServe = false } = options;

  console.log('Starting OpenCode ClawMessenger Plugin (Standalone Mode)\n');
  console.log('  - RongCloud IM bridge to OpenCode');
  console.log('  - Auto-registration & heartbeat');
  console.log('  - Message deduplication & session persistence\n');

  const configManager = new ConfigManager(configPath);
  let config: ClawMessengerConfig;

  try {
    config = configManager.load();
  } catch {
    config = configManager.load();
  }

  if (!config.token) {
    log.info('Token missing, auto-registering...');
    const token = await getOrRegisterToken(config.serverUrl, undefined, log);
    if (!token) {
      console.error('自动注册失败，请运行: npx opencode-clawmessenger setup');
      process.exit(1);
    }
    config.token = token;
    config.accountId = (await loadAutoConfig())?.nodeId || generateNodeId();
    log.info('Auto-registration successful');
  }

  console.log(`  Account:   ${config.accountId}`);
  console.log(`  OpenCode:  ${config.opencodeUrl}`);
  console.log(`  Server:    ${config.serverUrl}\n`);

  const serverRunning = await checkOpencodeStatus(config.opencodeUrl, config.opencodePassword);
  if (!serverRunning && autoServe) {
    log.warn('OpenCode server not running; --serve auto-start is not yet implemented for clawmessenger');
  }
  if (!serverRunning) {
    const port = new URL(config.opencodeUrl).port || '19876';
    console.warn(`OpenCode server not running at ${config.opencodeUrl}`);
    console.warn(`  Start it: opencode serve --port ${port}\n`);
  }

  // 参考 opencode-feishu：directory 指向包含 .opencode/prompt.md 的目录
  // OpenCode 会自动加载该目录下的 prompt.md 作为 system prompt
  const soulFrameworkDir = '/home/neomei/文档/projects/agent-soul-framework';
  const opencodeDir = config.opencodeDir || soulFrameworkDir || process.cwd();
  
  const opencode = new OpenCodeClient({
    baseUrl: config.opencodeUrl,
    directory: opencodeDir,
    password: config.opencodePassword,
  });

  try {
    await opencode.listSessions();
    console.log('OpenCode connected\n');
  } catch (err) {
    log.error({ err, opencodeUrl: config.opencodeUrl }, 'Failed to connect to OpenCode');
    const port = new URL(config.opencodeUrl).port || '19876';
    console.error(`Failed to connect to OpenCode at ${config.opencodeUrl}`);
    console.error(`  Start it: opencode serve --port ${port}\n`);
    process.exit(1);
  }

  const sessionManager = new SessionManager(opencode);

  const rongClient = new RongCloudClient({
    appKey: config.appKey,
    token: config.token,
    accountId: config.accountId,
  }, log);

  const messageHandler = new MessageHandler(config, sessionManager, rongClient, opencode);

  let eventHandler: EventHandler | undefined;

  try {
    const eventStream = await opencode.subscribeGlobalEvents();
    eventHandler = new EventHandler(sessionManager, rongClient, opencode, config);
    eventHandler.start(eventStream).catch((err) => {
      log.error({ err }, 'Event stream error');
    });
    console.log('SSE event stream started\n');
  } catch (err) {
    log.warn({ err }, 'Failed to start event stream');
    console.warn('  Event streaming disabled\n');
  }

  const connected = await rongClient.connect((msg) => {
    messageHandler.handleMessage(msg).catch((err) => {
      log.error({ err }, 'Message handling failed');
    });
  });

  if (!connected) {
    console.error('Failed to connect to RongCloud');
    process.exit(1);
  }

  console.log('RongCloud connected\n');

  await registerNodeToServer(config, log);

  const serverHeartbeatInterval = setInterval(async () => {
    try {
      const isOnline = await checkOpencodeStatus(config.opencodeUrl, config.opencodePassword);
      log.debug({ opencodeOnline: isOnline }, 'Server heartbeat check');
      await registerNodeToServer(config, log);
    } catch (err: any) {
      log.warn({ err }, 'Server heartbeat failed');
    }
  }, 30_000);

  const rongcloudCheckInterval = setInterval(() => {
    if (!rongClient.isConnected) {
      log.warn('RongCloud disconnected, reconnecting...');
      rongClient.connect((msg) => {
        messageHandler.handleMessage(msg).catch((err) => {
          log.error({ err }, 'Message handling failed');
        });
      }).catch((err: any) => {
        log.error({ err }, 'Reconnect failed');
      });
    }
  }, 30_000);

  console.log('========================================');
  console.log('  OpenCode ClawMessenger Plugin Running  ');
  console.log('========================================');
  console.log(`  Mode:        Standalone`);
  console.log(`  OpenCode:    ${config.opencodeUrl}`);
  console.log(`  Directory:   ${config.opencodeDir || process.cwd()}`);
  console.log('========================================\n');
  console.log('Press Ctrl+C to stop\n');

  const startTime = Date.now();
  const stopStatusWriter = startStatusWriter(() => ({
    startedAt: startTime,
    opencodeUrl: config.opencodeUrl,
    rongcloudConnected: rongClient.isConnected,
    sessionCount: sessionManager.getAllSessions().length,
  }));

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);

    stopStatusWriter();
    clearInterval(serverHeartbeatInterval);
    clearInterval(rongcloudCheckInterval);

    if (eventHandler) eventHandler.stop();
    rongClient.disconnect();
    await sessionManager.cleanup();

    console.log('Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  setInterval(() => {}, 1000);
}

async function registerNodeToServer(config: ClawMessengerConfig, log: any): Promise<void> {
  try {
    const { serverUrl, accountId, opencodeUrl } = config;
    if (!serverUrl || !accountId) return;

    await fetch(`${serverUrl}/api/claw/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_id: accountId,
        name: config.nodeName || 'OpenCode Agent',
        mac_address: '00:00:00:00:00:00',
      }),
      signal: AbortSignal.timeout(10000),
    });

    const userId = process.env.CLAW_USER_ID || 'admin';
    await fetch(`${serverUrl}/im/api/saas/nodes/${accountId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        openclaw_url: opencodeUrl,
        deploy_status: 'online',
      }),
      signal: AbortSignal.timeout(10000),
    });

    log.debug('Node registered to server');
  } catch (error: any) {
    log.warn({ err: error }, 'Register node to server failed');
  }
}
