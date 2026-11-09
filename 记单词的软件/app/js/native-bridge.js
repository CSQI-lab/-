/**
 * native-bridge.js — 能力接口层（可替换的桥接层）
 * ============================================================
 * 把所有「依赖系统/平台能力」的操作统一封装在这里：
 *   朗读、角标、文件下载、文件选择、（未来的）通知……
 *
 * 现在这层走浏览器自带能力（Web Speech / Badging API / <a download>）。
 * 以后如果套上 iOS 原生壳（WKWebView），只替换这一个文件，
 * 改成调用 window.webkit.messageHandlers.native 即可，
 * 其他业务代码（tts.js / badge.js / backup.js）一行都不用动。
 *
 * 对外提供：speak / stopSpeak / setBadge / clearBadge / downloadFile / pickFile / isNative。
 */

// 探测当前是否运行在原生壳里（WKWebView 会注入 window.webkit.messageHandlers.native）
export const isNative =
  typeof window.webkit !== 'undefined' &&
  window.webkit.messageHandlers &&
  !!window.webkit.messageHandlers.native;

// 给原生壳发消息的统一出口
function postToNative(cmd, data = {}) {
  if (isNative) {
    window.webkit.messageHandlers.native.postMessage({ cmd, ...data });
  }
}

// ============================================================
// 朗读
// ============================================================

// onEnd：朗读结束后的回调（界面用来停止播放动画）
export function speak(text, lang = 'en-US', rate = 0.9, onEnd) {
  if (isNative) {
    // 原生壳：交给 AVSpeechSynthesizer（在 Swift 端实现）
    postToNative('speak', { text, lang, rate });
    if (onEnd) setTimeout(onEnd, 1200);   // 原生壳暂用定时兜底
  } else if (typeof speechSynthesis !== 'undefined') {
    // 浏览器：用 Web Speech API
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = rate;
    if (onEnd) {
      u.onend = onEnd;
      u.onerror = onEnd;   // 出错也要收掉动画，避免一直闪
    }
    speechSynthesis.cancel();   // 先停掉正在读的，避免叠音
    speechSynthesis.speak(u);
  } else if (onEnd) {
    onEnd();
  }
}

export function stopSpeak() {
  if (isNative) {
    postToNative('stopSpeak');
  } else if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel();
  }
}

// ============================================================
// 桌面图标角标
// ============================================================

export async function setBadge(count) {
  if (isNative) {
    postToNative('setBadge', { count });
  } else if (navigator.setAppBadge) {
    // iOS 16.4+ 的主屏幕 Web App 支持
    try { await navigator.setAppBadge(count); } catch (e) { /* 静默失败 */ }
  }
  // 不支持时静默失败（UI 层另有 App 内红点数字兜底）
}

export async function clearBadge() {
  if (isNative) {
    postToNative('clearBadge');
  } else if (navigator.clearAppBadge) {
    try { await navigator.clearAppBadge(); } catch (e) { /* 静默失败 */ }
  }
}

// ============================================================
// 文件下载（导出备份用）
// ============================================================

export function downloadFile(filename, content, mimeType = 'application/json') {
  // 浏览器：用 Blob + 临时 <a> 标签触发下载
  // iOS Safari 会提示存到「文件」App
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);  // 释放内存
}

// ============================================================
// 文件选择（导入备份用）→ 返回用户选中的 File 对象，或 null
// ============================================================

export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      resolve(input.files[0] || null);
    };
    // 注意：如果用户点了取消， onchange 不会触发，Promise 不会 resolve
    // 这是浏览器限制，无法完美处理。UI 层可加超时提示。
    input.click();
  });
}
