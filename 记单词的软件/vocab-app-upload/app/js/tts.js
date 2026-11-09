/**
 * tts.js — 朗读功能
 * ============================================================
 * 负责：把单词朗读出来。
 * 实际的「怎么发声」交给 native-bridge.js（浏览器或原生壳），
 * 本文件只管「读什么、用什么语言和语速」。
 *
 * iOS 的规矩：朗读必须由用户点击触发（不能自动读），
 * 所以朗读按钮都是用户点了才调用。
 *
 * 对外提供：speakWord() 朗读一个词、stopSpeak() 停止、isTTSAvailable() 检查。
 */

import { TTS_LANG, TTS_RATE } from './config.js';
import { speak, stopSpeak } from './native-bridge.js';

// 朗读一个单词（或短语）；onEnd 在读完/出错时回调
export function speakWord(word, onEnd) {
  speak(word, TTS_LANG, TTS_RATE, onEnd);
}

// 停止朗读
export function stopSpeakWord() {
  stopSpeak();
}

// 检查朗读功能是否可用（有些浏览器/系统可能没有语音引擎）
export function isTTSAvailable() {
  return typeof speechSynthesis !== 'undefined';
}
