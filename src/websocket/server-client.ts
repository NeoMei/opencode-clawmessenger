import WebSocket from 'ws';
import type { Logger } from '../core/logger.js';

export class ServerWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private nodeId: string;
  private nodeName: string;
  private opencodeUrl: string;
  private log: Logger;
  private reconnectInterval = 30000;
  private heartbeatInterval = 30000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isConnected = false;

  constructor(url: string, nodeId: string, nodeName: string, opencodeUrl: string, log: Logger) {
    this.url = url;
    this.nodeId = nodeId;
    this.nodeName = nodeName;
    this.opencodeUrl = opencodeUrl;
    this.log = log;
  }

  connect(): void {
    try {
      this.log.info({ url: this.url }, 'Connecting server WebSocket');
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.send({
          type: 'register',
          node_info: {
            node_id: this.nodeId,
            hostname: this.nodeName,
            local_url: this.opencodeUrl,
            platform: process.platform,
          },
        });
        this.startHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.log.info({ type: message.type }, 'Server message received');
          
          // 响应服务端 ping 消息
          if (message.type === 'ping') {
            this.send({ type: 'pong', node_id: this.nodeId, timestamp: new Date().toISOString() });
          }
        } catch {
          this.log.warn('Non-JSON server message');
        }
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      });

      this.ws.on('error', (err: Error) => {
        this.log.error({ err }, 'Server WebSocket error');
        this.isConnected = false;
      });
    } catch (err: any) {
      this.log.error({ err }, 'Server WebSocket connect failed');
      this.scheduleReconnect();
    }
  }

  private send(data: any): void {
    if (this.ws && this.isConnected) {
      try { this.ws.send(JSON.stringify(data)); } catch {}
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat', node_id: this.nodeId, timestamp: new Date().toISOString() });
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectInterval);
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.isConnected = false;
  }
}
