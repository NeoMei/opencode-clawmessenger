/**
 * OpenCodeClient — OpenCode serve REST API 客户端
 *
 * 流式模式：通过 fetch + ReadableStream 实时获取 AI 回复增量
 */

export class OpenCodeClient {
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

  /** 发送消息并流式接收回复 */
  async sendPromptStream(
    sessionId: string,
    text: string,
    onChunk: (delta: string, seq: number) => void,
    onError: (err: Error) => void
  ): Promise<void> {
    const parts: any[] = [{ type: 'text', text }];

    // 请求流式响应
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({ parts, stream: true }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      onError(new Error(`OpenCode 错误: ${(err as any).name || res.status}`));
      return;
    }

    // 非流式响应 — 尝试 sync 模式
    if (!res.headers.get('content-type')?.includes('event-stream')) {
      const data = await res.json() as any;
      const textParts = (data?.parts || [])
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text || '')
        .join('');
      if (textParts) {
        // 模拟流式：500ms 间隔逐字发出
        for (let i = 0; i < textParts.length; i++) {
          onChunk(textParts[i], i + 1);
          if (i % 10 === 9) await sleep(100);
        }
      }
      return;
    }

    // SSE 流式解析
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let seq = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const textParts = (data.parts || [])
                .filter((p: any) => p.type === 'text')
                .map((p: any) => p.text || '');
              const delta = textParts.join('');
              if (delta) {
                seq++;
                onChunk(delta, seq);
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      onError(err);
    }
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
