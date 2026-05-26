/**
 * MAC 地址获取 — ClawMessenger 设备标识
 */

import { networkInterfaces } from 'node:os';

export function getMacAddress(): string {
  const interfaces = networkInterfaces();
  for (const [, details] of Object.entries(interfaces)) {
    if (!details) continue;
    for (const iface of details) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac.replace(/:/g, '').toLowerCase();
      }
    }
  }
  // 回退：首个非零 MAC
  for (const [, details] of Object.entries(interfaces)) {
    if (!details) continue;
    for (const iface of details) {
      if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac.replace(/:/g, '').toLowerCase();
      }
    }
  }
  return '000000000000';
}
