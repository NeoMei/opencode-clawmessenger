/**
 * RongCloudServerAPI — 融云服务端 REST API 客户端
 *
 * 直接调用融云服务端 API，支持：
 * - 发送流式消息 (RC:StreamMsg)
 * - 发送 typing 状态
 * - 签名认证 (App-Key + Nonce + Timestamp + SHA1 Signature)
 */

import { createHash } from 'node:crypto';

const API_HOSTS = ['api.rong-api.com', 'api-b.rong-api.com'];

export class RongCloudServerAPI {
  private hostIndex = 0;

  constructor(
    private appKey: string,
    private appSecret: string,
    private log?: Console
  ) {}

  private get host(): string {
    return API_HOSTS[this.hostIndex];
  }

  private switchHost(): boolean {
    if (this.hostIndex < API_HOSTS.length - 1) {
      this.hostIndex++;
      return true;
    }
    return false;
  }

  private generateSignature(): {
    nonce: string;
    timestamp: number;
    signature: string;
  } {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 18; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const timestamp = Date.now();
    const signature = createHash('sha1')
      .update(this.appSecret + nonce + timestamp)
      .digest('hex');
    return { nonce, timestamp, signature };
  }

  private getHeaders(): Record<string, string> {
    const sign = this.generateSignature();
    return {
      'App-Key': this.appKey,
      'Nonce': sign.nonce,
      'Timestamp': String(sign.timestamp),
      'Signature': sign.signature,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }

  async streamPrivate(params: {
    fromUserId: string;
    toUserId: string;
    content: string;
    streamId: string;
    isFirstChunk?: boolean;
    isLastChunk?: boolean;
    seq?: number;
    messageUID?: string;
  }): Promise<boolean> {
    const contentBody: any = {
      content: params.content,
      complete: params.isLastChunk ?? false,
      seq: params.seq ?? 1,
    };
    if (params.isFirstChunk) contentBody.type = 'markdown';
    if (!params.isFirstChunk && params.messageUID) contentBody.messageUID = params.messageUID;

    const data = new URLSearchParams({
      fromUserId: params.fromUserId,
      toUserId: params.toUserId,
      objectName: 'RC:StreamMsg',
      content: JSON.stringify(contentBody),
      isPersisted: '1',
      isCounted: params.isFirstChunk ? '1' : '0',
      disableUpdateLastMsg: params.isLastChunk ? '0' : '1',
    });

    return this.post('/v3/message/private/publish_stream.json', data.toString());
  }

  async streamGroup(params: {
    fromUserId: string;
    toGroupId: string;
    content: string;
    streamId: string;
    isFirstChunk?: boolean;
    isLastChunk?: boolean;
    seq?: number;
    messageUID?: string;
  }): Promise<boolean> {
    const contentBody: any = {
      content: params.content,
      complete: params.isLastChunk ?? false,
      seq: params.seq ?? 1,
    };
    if (params.isFirstChunk) contentBody.type = 'markdown';
    if (!params.isFirstChunk && params.messageUID) contentBody.messageUID = params.messageUID;

    const data = new URLSearchParams({
      fromUserId: params.fromUserId,
      toGroupId: params.toGroupId,
      objectName: 'RC:StreamMsg',
      content: JSON.stringify(contentBody),
      isPersisted: '1',
      isCounted: params.isFirstChunk ? '1' : '0',
      isIncludeSender: '1',
      disableUpdateLastMsg: params.isLastChunk ? '0' : '1',
    });

    return this.post('/v3/message/group/publish_stream.json', data.toString());
  }

  private async post(path: string, body: string): Promise<boolean> {
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(`https://${this.host}${path}`, {
          method: 'POST',
          headers: this.getHeaders(),
          body,
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const json = await res.json() as any;
          if (json.code === 200) return true;
          this.log?.warn(`[RongAPI] ${path}: code=${json.code}`);
          return false;
        }
        this.switchHost();
      } catch {
        if (!this.switchHost()) break;
      }
    }
    this.log?.error(`[RongAPI] ${path} 失败`);
    return false;
  }

  // ─── 文件上传 ──────────────────────────────────────────────

  /**
   * 上传文件到融云
   * POST /v3/file/upload.json  →  返回 fileUrl
   */
  async uploadFile(fileBuffer: Uint8Array, fileName: string): Promise<string | null> {
    const sign = this.generateSignature();
    const form = new FormData();
    form.append('file', new Blob([fileBuffer as any]), fileName);

    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(`https://${this.host}/v3/file/upload.json`, {
          method: 'POST',
          headers: {
            'App-Key': this.appKey,
            'Nonce': sign.nonce,
            'Timestamp': String(sign.timestamp),
            'Signature': sign.signature,
          },
          body: form,
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
          const json = await res.json() as any;
          if (json.code === 200) {
            this.log?.info(`[RongAPI] 文件上传成功: ${json.data?.fileUrl}`);
            return json.data?.fileUrl || null;
          }
        }
        this.switchHost();
      } catch {
        this.switchHost();
      }
    }
    return null;
  }

  // ─── 发送媒体消息 ──────────────────────────────────────────

  /** 发送图片消息 (RC:ImgMsg) */
  async sendImage(
    fromUserId: string,
    toUserId: string,
    imageUrl: string,
    conversationType: 1 | 3 = 1
  ): Promise<boolean> {
    return this.sendMediaMessage(
      fromUserId, toUserId, conversationType,
      'RC:ImgMsg', JSON.stringify({ content: imageUrl, extra: '' })
    );
  }

  /** 发送文件消息 (RC:FileMsg) */
  async sendFile(
    fromUserId: string,
    toUserId: string,
    fileUrl: string,
    fileName: string,
    fileSize: number,
    conversationType: 1 | 3 = 1
  ): Promise<boolean> {
    return this.sendMediaMessage(
      fromUserId, toUserId, conversationType,
      'RC:FileMsg', JSON.stringify({ name: fileName, size: fileSize, fileUrl })
    );
  }

  private async sendMediaMessage(
    fromUserId: string,
    toUserId: string,
    conversationType: 1 | 3,
    objectName: string,
    content: string
  ): Promise<boolean> {
    const isPrivate = conversationType === 1;
    const data = new URLSearchParams({
      fromUserId,
      [isPrivate ? 'toUserId' : 'toGroupId']: toUserId,
      objectName,
      content,
    });
    const path = isPrivate
      ? '/v3/message/private/publish.json'
      : '/v3/message/group/publish.json';
    return this.post(path, data.toString());
  }
}
