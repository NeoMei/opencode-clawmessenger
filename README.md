# OpenCode ClawMessenger

[![npm version](https://img.shields.io/npm/v/@neomei/opencode-clawmessenger.svg)](https://www.npmjs.com/package/@neomei/opencode-clawmessenger)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> OpenCode ClawMessenger 是一个 TypeScript 桥接插件，连接 [RongCloud IM（融云/虾说）](https://www.rongcloud.cn/) 与 [OpenCode](https://opencode.ai/) 会话 API。它接收来自融云的聊天消息，转发给 OpenCode 处理，并将流式响应实时推回给用户。

## 目录

- [核心特性](#核心特性)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
  - [前置要求](#前置要求)
  - [方式一：npm 全局安装（推荐）](#方式一npm-全局安装推荐)
  - [方式二：源码安装](#方式二源码安装)
  - [方式三：Docker 运行](#方式三docker-运行)
- [初始化配置](#初始化配置)
- [CLI 命令文档](#cli-命令文档)
- [Linux 生产部署](#linux-生产部署)
  - [systemd 服务](#systemd-服务)
  - [自动安装脚本](#自动安装脚本)
  - [手动安装](#手动安装)
  - [日志查看](#日志查看)
- [环境变量](#环境变量)
- [配置优先级](#配置优先级)
- [插件模式](#插件模式)
- [开发指南](#开发指南)
- [故障排查](#故障排查)
- [NPM 包使用](#npm-包使用)
- [GitHub Release 使用](#github-release-使用)
- [许可证](#许可证)

## 核心特性

- **双模式运行**：既支持作为 OpenCode 插件加载，也支持作为独立守护进程运行
- **流式消息推送**：OpenCode SSE 响应通过融云 `RC:StreamMsg` 实时推送给前端
- **消息已读回执**：支持 V5/V2/旧版已读回执 API，单聊和群聊均兼容
- **设备管理协议**：支持远程设备状态查询、启动/停止/重启、配置修复等 P2P 命令
- **自动注册**：首次运行 `setup` 自动向 ClawMessenger 服务器注册节点并生成二维码
- **二维码加密**：与小程序共享 XOR + Base64 加密算法，保证扫码绑定安全
- **结构化日志**：基于 Pino 的日志输出，支持文件和控制台双输出

## 架构概览

```
src/
  types/plugin.ts        OpenCode 插件接口
  plugin.ts              插件模式入口
  standalone.ts          独立守护进程入口
  cli.ts                 Commander CLI
  index.ts               库导出
  core/
    types.ts             配置和消息类型定义
    config.ts            Zod 配置管理器
    logger.ts            Pino 结构化日志
    session-manager.ts   chatId→sessionId 映射持久化
    message-handler.ts   消息分发和已读回执
    dedup.ts             消息去重
    daemon.ts            PID/心跳守护
    hook-manager.ts      生命周期钩子
    auto-register.ts     节点注册（7 天 token）
    qr-crypto.ts         二维码加密
    mac-address.ts       跨平台 MAC 地址获取
  rongcloud/
    env-polyfill.ts      浏览器 polyfill（必须在 SDK 前导入）
    client.ts            融云 IM 客户端
    server-api.ts        融云服务端 REST API
  opencode/
    client.ts            OpenCode SDK 包装器
    event-handler.ts     SSE 事件流处理
  websocket/
    client.ts            直接 WebSocket 客户端
    server-client.ts     服务端中转 WebSocket
bin/
  opencode-clawmessenger      CLI 入口
scripts/
  install.sh             Linux 自动安装脚本
  uninstall.sh           Linux 卸载脚本
  opencode-clawmessenger.service   systemd 服务模板
```

## 快速开始

### 前置要求

- **Node.js** >= 18.0.0
- **操作系统**：Windows / macOS / Linux（推荐 Linux + systemd 生产环境）
- **OpenCode Server**：本地或远程可访问的 OpenCode 服务
- **融云账号**：用于 IM 消息收发（通过 ClawMessenger 服务器自动注册）

### 方式一：npm 全局安装（推荐）

```bash
# 安装
npm install -g @neomei/opencode-clawmessenger@latest

# 初始化（生成二维码，手机 App 扫码绑定）
opencode-clawmessenger setup

# 前台运行（调试）
opencode-clawmessenger start

# 或作为守护进程运行
opencode-clawmessenger start --daemon
```

### 方式二：源码安装

```bash
# 克隆仓库
git clone https://github.com/neomei/opencode-clawmessenger.git
cd opencode-clawmessenger

# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 初始化
node dist/cli.js setup

# 运行
node dist/cli.js start
```

### 方式三：Docker 运行

```bash
# 构建镜像
docker build -t opencode-clawmessenger .

# 运行（挂载配置目录）
docker run -d \
  --name clawmessenger \
  -v ~/.config/opencode:/root/.config/opencode \
  -e CLAW_OPENCODE_URL=http://host.docker.internal:19876 \
  opencode-clawmessenger
```

## 初始化配置

运行 `opencode-clawmessenger setup` 后，脚本会：

1. 向 ClawMessenger 注册服务器注册节点
2. 生成融云 Token 和节点 ID
3. 保存配置到 `~/.config/opencode/clawmessenger.json`
4. 在终端打印 ASCII 二维码

然后使用手机 App（虾说）扫描二维码完成绑定。

```bash
$ opencode-clawmessenger setup
opencode-clawmessenger Setup Wizard

Registering node: my-server...
Registration successful!
  Node ID: claw_abc123

========================================
  Scan QR Code with ClawMessenger App
========================================

[二维码图案]

Start the plugin: opencode-clawmessenger start
```

## CLI 命令文档

### `start` - 启动服务

```bash
opencode-clawmessenger start [options]
```

选项：

| 选项 | 说明 |
|------|------|
| `-c, --config <path>` | 指定配置文件路径 |
| `-u, --url <url>` | 指定 OpenCode 服务器 URL |
| `-d, --daemon` | 作为后台守护进程启动 |
| `-s, --serve` | 如果 OpenCode 未运行，自动启动 |

示例：

```bash
# 前台运行
opencode-clawmessenger start

# 后台守护进程
opencode-clawmessenger start --daemon

# 指定配置
opencode-clawmessenger start -c /path/to/config.json
```

### `stop` - 停止服务

```bash
opencode-clawmessenger stop
```

读取 PID 文件并向进程发送 `SIGTERM` 信号。

### `status` - 查看状态

```bash
opencode-clawmessenger status [options]
```

选项：

| 选项 | 说明 |
|------|------|
| `--json` | 以 JSON 格式输出 |

示例：

```bash
$ opencode-clawmessenger status
Plugin running
  PID:         12345
  Uptime:      2h 15m 30s
  OpenCode:    http://127.0.0.1:19876
  RongCloud:   connected
  Sessions:    3
```

### `logs` - 查看日志

```bash
opencode-clawmessenger logs [options]
```

选项：

| 选项 | 说明 |
|------|------|
| `-n, --lines <n>` | 显示最近 n 行（默认 50） |
| `-f, --follow` | 实时跟踪日志 |

示例：

```bash
# 最近 100 行
opencode-clawmessenger logs -n 100

# 实时跟踪
opencode-clawmessenger logs -f

# 搜索错误
opencode-clawmessenger logs -n 200 | grep ERROR
```

### `setup` - 初始化配置

```bash
opencode-clawmessenger setup
```

交互式向导，完成节点注册并打印绑定二维码。

## Linux 生产部署

### systemd 服务

项目提供完整的 systemd 服务模板：`scripts/opencode-clawmessenger.service`

### 自动安装脚本

**推荐方式**，一键完成 Node.js 检查、npm 安装、systemd 注册和启动：

```bash
# 使用 curl
curl -fsSL https://raw.githubusercontent.com/neomei/opencode-clawmessenger/main/scripts/install.sh | sudo bash

# 或使用 wget
wget -qO- https://raw.githubusercontent.com/neomei/opencode-clawmessenger/main/scripts/install.sh | sudo bash
```

安装完成后运行初始化：

```bash
# 使用安装时自动创建的运行用户
sudo -u $(whoami) opencode-clawmessenger setup

# 启动/停止/重启
sudo systemctl start opencode-clawmessenger
sudo systemctl stop opencode-clawmessenger
sudo systemctl restart opencode-clawmessenger

# 查看状态
sudo systemctl status opencode-clawmessenger

# 设置开机自启
sudo systemctl enable opencode-clawmessenger
```

### 手动安装

如果你希望完全手动控制：

```bash
# 1. 安装 Node.js（如未安装）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# 2. 全局安装 npm 包
sudo npm install -g @neomei/opencode-clawmessenger@latest

# 3. 确定 Node 和 CLI 路径
NODE_BIN=$(which node)
CLI_PATH=$(npm root -g)/@neomei/opencode-clawmessenger/bin/opencode-clawmessenger

# 4. 创建运行用户（可选但推荐）
sudo useradd -r -s /bin/false clawmessenger
sudo mkdir -p /home/clawmessenger/.config/opencode
sudo chown -R clawmessenger:clawmessenger /home/clawmessenger

# 5. 复制并编辑 systemd 服务文件
sudo cp scripts/opencode-clawmessenger.service /etc/systemd/system/
sudo sed -i "s|%USER%|clawmessenger|g" /etc/systemd/system/opencode-clawmessenger.service
sudo sed -i "s|%GROUP%|clawmessenger|g" /etc/systemd/system/opencode-clawmessenger.service
sudo sed -i "s|%HOME%|/home/clawmessenger|g" /etc/systemd/system/opencode-clawmessenger.service
sudo sed -i "s|%INSTALL_DIR%|/home/clawmessenger/.config/opencode|g" /etc/systemd/system/opencode-clawmessenger.service
sudo sed -i "s|%NODE_BIN%|$NODE_BIN|g" /etc/systemd/system/opencode-clawmessenger.service
sudo sed -i "s|%CLI_PATH%|$CLI_PATH|g" /etc/systemd/system/opencode-clawmessenger.service

# 6. 初始化配置
sudo -u clawmessenger opencode-clawmessenger setup

# 7. 启动服务
sudo systemctl daemon-reload
sudo systemctl enable --now opencode-clawmessenger
```

### 日志查看

使用 systemd journal：

```bash
# 实时跟踪
sudo journalctl -u opencode-clawmessenger -f

# 最近 100 条
sudo journalctl -u opencode-clawmessenger -n 100

# 今天的日志
sudo journalctl -u opencode-clawmessenger --since today

# 搜索错误
sudo journalctl -u opencode-clawmessenger -g "ERROR|error|失败"
```

应用日志文件位置：

```bash
# 默认路径
tail -f ~/.config/opencode/clawmessenger.log

# 或通过 CLI
opencode-clawmessenger logs -f
```

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `CLAW_TOKEN` | - | 融云 Token |
| `CLAW_ACCOUNT_ID` | - | 融云账号 ID |
| `CLAW_APP_KEY` | - | 融云 App Key |
| `CLAW_APP_SECRET` | - | 融云 App Secret |
| `DM_SERVER_URL` | `https://newsradar.dreamdt.cn/im` | ClawMessenger 注册服务器 |
| `CLAW_OPENCODE_URL` | `http://127.0.0.1:19876` | OpenCode 服务地址 |
| `CLAW_OPENCODE_DIR` | - | OpenCode 工作目录 |
| `OPENCODE_SERVER_PASSWORD` | - | OpenCode Basic Auth 密码 |
| `CLAW_SYSTEM_PROMPT` | - | 覆盖默认 system prompt |
| `CLAW_LOG_LEVEL` | `info` | 日志级别（trace/debug/info/warn/error） |
| `CLAW_LOG_FILE` | `~/.config/opencode/clawmessenger.log` | 日志文件路径 |
| `CLAW_CHAT_TIMEOUT` | `600` | 聊天超时时间（秒） |
| `DEBUG` | - | 遗留调试开关 |

在 systemd 中使用：

```ini
[Service]
Environment="CLAW_LOG_LEVEL=debug"
Environment="CLAW_OPENCODE_URL=http://127.0.0.1:19876"
```

## 配置优先级

配置加载遵循以下优先级（高 → 低）：

1. **环境变量**（最高优先级）
2. **自动注册保存的配置**：`~/.claw-bridge/config.json`
3. **插件配置文件**：`~/.config/opencode/clawmessenger.json`

## 插件模式

如果你希望将 ClawMessenger 作为 OpenCode 插件使用，而非独立守护进程：

```typescript
// 在 OpenCode 插件入口中
import clawMessenger from '@neomei/opencode-clawmessenger/plugin';

export default {
  id: 'my-opencode-plugin',
  server: clawMessenger.server,
};
```

## 开发指南

```bash
# 安装依赖
npm install

# 开发模式（自动编译）
npm run dev

# 类型检查
npm run typecheck

# 构建
npm run build

# 本地运行
npm run start -- --daemon
```

### 项目脚本

| 脚本 | 说明 |
|------|------|
| `npm run build` | 编译 TypeScript 到 `dist/` |
| `npm run dev` | 开发模式自动编译 |
| `npm run start` | 运行 `dist/cli.js` |
| `npm run lint` | 类型检查（不生成文件） |
| `npm run typecheck` | 同 `lint` |

### 关键依赖版本

- `@rongcloud/imlib-next`: `5.36.6`
- `@opencode-ai/sdk`: `^1.0.0`
- `pino` / `pino-pretty`: `^9.0.0` / `^11.0.0`
- `commander`: `^12.0.0`
- `zod`: `^3.23.0`

## 故障排查

### 服务启动后立即退出

```bash
# 查看详细日志
journalctl -u opencode-clawmessenger -n 50 --no-pager
opencode-clawmessenger logs -n 100

# 常见问题
# 1. OpenCode 未运行
# 2. 配置文件中 token 过期
# 3. 端口冲突
```

### 融云连接失败

检查 `clawmessenger.json` 中的 `token` 和 `appKey`：

```bash
cat ~/.config/opencode/clawmessenger.json
```

重新运行 `setup` 生成新 token：

```bash
opencode-clawmessenger setup
```

### 消息收不到

1. 确认服务状态为 `connected`
2. 检查融云消息是否被过滤（查看日志中的 "忽略" 信息）
3. 确认 `RC:ReadNtf` 不影响业务

### 流式消息不更新

1. 确认前端 `enableReadV5: true`
2. 检查融云 SDK 版本 >= 5.30
3. 查看日志中 `seq` 是否从 1 开始递增

### 卸载

```bash
curl -fsSL https://raw.githubusercontent.com/neomei/opencode-clawmessenger/main/scripts/uninstall.sh | sudo bash
```

## NPM 包使用

### 作为库导入

```bash
npm install @neomei/opencode-clawmessenger
```

```typescript
import { createLogger } from '@neomei/opencode-clawmessenger';

const log = createLogger('MyApp');
log.info('Hello from ClawMessenger');
```

### 版本更新

```bash
# 全局安装更新
npm update -g @neomei/opencode-clawmessenger

# 或使用 @latest
npm install -g @neomei/opencode-clawmessenger@latest

# 查看版本
opencode-clawmessenger --version
```

## GitHub Release 使用

每次推送 `v*` 标签会自动触发 GitHub Actions 发布到 NPM：

```bash
# 1. 更新版本号
npm version patch   # 或 minor / major

# 2. 推送到 GitHub（带标签）
git push origin main --tags

# 3. GitHub Actions 会自动构建并发布到 NPM Registry
```

Release 流程：

1. 代码合并到 `main` 分支
2. 运行 `npm version <patch|minor|major>` 更新 `package.json` 并创建 Git tag
3. `git push origin main --tags`
4. GitHub Actions 触发 `publish.yml`
5. 自动运行 `npm ci` → `npm run build` → `npm publish --access public`

### 从 GitHub Release 直接安装

```bash
# 查看最新 release
curl -s https://api.github.com/repos/neomei/opencode-clawmessenger/releases/latest | grep tag_name

# 下载并安装特定版本
npm install -g @neomei/opencode-clawmessenger@0.3.0
```

## 许可证

[MIT](LICENSE) © neomei

---

**问题反馈**：请通过 [GitHub Issues](https://github.com/neomei/opencode-clawmessenger/issues) 提交问题或建议。
