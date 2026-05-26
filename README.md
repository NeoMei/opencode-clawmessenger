# opencode-rongyun

> 魂器融云连接器 — 通过融云 IM SDK 与 OpenCode Agent 通信

将 OpenCode AI Agent 接入融云即时通讯，在融云单聊/群聊中 @机器人 即可对话。

## 安装

```bash
npm install -g github:NeoMei/opencode-rongyun
```

## 配置

```bash
opencode-rongyun setup
```

按提示输入:
- **App Key** — 融云控制台获取
- **Token** — 融云用户 Token（通过融云服务端 API 生成）
- **Account ID** — 机器人在融云的 userId

## 启动

```bash
# 确保 opencode serve 已运行
opencode serve --port 19876

# 启动融云桥接
opencode-rongyun start
```

## 使用

- **单聊**: 直接给机器人发消息，自动回复
- **群聊**: @机器人 发消息，机器人回复

## 命令

| 命令 | 说明 |
|------|------|
| `opencode-rongyun setup` | 配置融云连接 |
| `opencode-rongyun start` | 启动桥接服务 |
| `opencode-rongyun doctor` | 检查连接状态 |

## License

MIT
