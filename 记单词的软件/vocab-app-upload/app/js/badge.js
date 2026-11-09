/**
 * badge.js — 桌面图标角标
 * ============================================================
 * 负责：在 App 桌面图标上显示待学习数量（红色数字角标）。
 *
 * iOS 16.4+ 的主屏幕 Web App 支持 navigator.setAppBadge()，
 * 低版本不支持时静默失败（App 内另有红点数字兜底，不影响使用）。
 *
 * 对外提供：updateBadge(count) 更新角标、clearBadge() 清除角标。
 */

import { setBadge, clearBadge } from './native-bridge.js';

// 更新角标数字（count=0 时清除）
export async function updateBadge(count) {
  if (count > 0) {
    await setBadge(count);
  } else {
    await clearBadge();
  }
}

// 清除角标
export async function clearAppBadge() {
  await clearBadge();
}
