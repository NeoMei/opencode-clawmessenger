/**
 * OpenCodeClient — OpenCode serve REST API 客户端
 *
 * 简化版，参照 opencode-feishu 的实现。
 */

export class OpenCodeClient {
  constructor(private baseUrl: string) {}

  async createSession(title?: string): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || 'Rongyun Chat' }),
    });
    if (!res.ok) throw new Error(`创建 session 失败: ${res.status}`);
    return (await res.json()) as any;
  }

  async sendPrompt(
    sessionId: string,
    text: string,
    systemInstruct?: string
  ): Promise<void> {
    const parts: any[] = [{ type: 'text', text }];
    if (systemInstruct) {
      parts.unshift({ type: 'text', text: systemInstruct, synthetic: true });
    }

    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`发送消息失败: ${(err as any).name || res.status}`);
    }
  }

  /** 获取 AI 流式回复 */
  async getReply(sessionId: string, messageId: string): Promise<string> {
    const res = await fetch(
      `${this.baseUrl}/session/${sessionId}/message/${messageId}`,
      { headers: { Accept: 'text/plain' } }
    );
    if (!res.ok) return '';
    return await res.text();
  }

  async abortSession(sessionId: string): Promise<void> {
    await fetch(`${this.baseUrl}/session/${sessionId}/abort`, { method: 'POST' });
  }
}
