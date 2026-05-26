/**
 * OpenCodeClient — OpenCode serve REST API 客户端
 * 支持流式响应捕获，用于将 AI 回复发回融云
 */

import { EventEmitter } from 'node:events';

interface OpenCodeEvent {
  type: string;
  properties: any;
}

export class OpenCodeClient {
  private events = new EventEmitter();

  constructor(private baseUrl: string) {}

  async createSession(title?: string): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || 'ClawMessenger Chat' }),
    });
    if (!res.ok) throw new Error(`创建 session 失败: HTTP ${res.status}`);
    return (await res.json()) as any;
  }

  /** 发送消息并流式接收回复，通过 callback 逐段返回文本 */
  async sendPrompt(
    sessionId: string,
    text: string,
    onText: (delta: string) => void,
    onDone: (fullText: string) => void,
    onError: (err: Error) => void
  ): Promise<string> {
    const parts: any[] = [{ type: 'text', text }];

    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = `发送消息失败: ${(err as any).name || res.status}`;
      onError(new Error(msg));
      return '';
    }

    const data = await res.json() as any;
    const info = data?.info;
    if (info?.error) {
      onError(new Error(info.error.data?.message || 'OpenCode 错误'));
      return '';
    }

    const messageId = info?.id;
    if (!messageId) {
      // 同步返回（slower models sometimes return text directly）
      const textParts = (data?.parts || [])
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text || '')
        .join('');
      if (textParts) {
        onDone(textParts);
        return textParts;
      }
      return '';
    }

    // 轮询获取流式回复
    let fullText = '';
    let lastText = '';
    let retries = 0;
    const maxRetries = 60; // 最多等 60 秒

    while (retries < maxRetries) {
      await sleep(1000);
      try {
        const partsRes = await fetch(
          `${this.baseUrl}/session/${sessionId}/message/${messageId}`,
          { headers: { Accept: 'application/json' } }
        );
        if (!partsRes.ok) { retries++; continue; }

        const partsData = await partsRes.json() as any;
        const textParts = (partsData?.parts || [])
          .filter((p: any) => p.type === 'text' && !p.synthetic)
          .map((p: any) => p.text || '');

        fullText = textParts.join('');

        if (fullText !== lastText) {
          const delta = fullText.slice(lastText.length);
          if (delta) onText(delta);
          lastText = fullText;
        }

        // 检查是否完成
        const finished = partsData?.parts?.some(
          (p: any) => p.type === 'step-finish' || p.type === 'error'
        );
        if (finished) {
          onDone(fullText);
          return fullText;
        }
      } catch {
        retries++;
      }
    }

    if (fullText) {
      onDone(fullText);
      return fullText;
    }
    return '';
  }

  async abortSession(sessionId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/session/${sessionId}/abort`, { method: 'POST' });
    } catch {}
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
