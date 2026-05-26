/**
 * 设备认证 — ClawMessenger 设备 secret 生成与验证
 */

import { createHash } from 'node:crypto';

export function generateSecret(mac: string, secretKey: string): string {
  return createHash('md5').update(mac + secretKey).digest('hex');
}

export function verifySecret(mac: string, secretKey: string, expectedSecret: string): boolean {
  return generateSecret(mac, secretKey) === expectedSecret;
}
