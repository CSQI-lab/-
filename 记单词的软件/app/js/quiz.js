/**
 * quiz.js — 考核出题
 * ============================================================
 * 负责：按题型生成题目。
 *
 * 重要变更：现在**不再自动判对错**。
 *   输入答案提交后，界面会同时给出「正确英文」和「中文释义」，
 *   由你自己看一遍、点「对了」或「错了」。
 *   这样做的好处是：中文释义说法很多、拼写差一两个字母也不一定算错，
 *   机器判断容易冤；自己判断最准。
 *
 * 两种题型（在 config.QUIZ_MODES 里登记）：
 *   en2zh — 看英文，写中文
 *   zh2en — 看中文，写英文（中译英）
 *
 * 以后想加新题型（如听音选词、四选一）：
 *   1. 在 QUIZ_REGISTRY 里加一项 { id, label, generate }
 *   2. 在 config.js 的 QUIZ_MODES 里加上该 id
 *   复习流程、成绩单都不用改。
 *
 * 对外提供：generateQuiz() 出题、getQuizModes() 列题型。
 */

import { QUIZ_MODES } from './config.js';

// ============================================================
// 题型登记表
// ============================================================
const QUIZ_REGISTRY = {

  // --- 看英文写中文 ---
  en2zh: {
    id: 'en2zh',
    label: '看英文写中文',
    generate(wordObj) {
      return {
        type: 'en2zh',
        prompt: wordObj.word,            // 题面：英文
        answerEn: wordObj.word,          // 参考答案：英文
        answerZh: wordObj.translation,   // 参考答案：中文
        placeholder: '输入中文意思…',
      };
    },
  },

  // --- 看中文写英文（中译英）---
  zh2en: {
    id: 'zh2en',
    label: '看中文写英文',
    generate(wordObj) {
      return {
        type: 'zh2en',
        prompt: wordObj.translation,     // 题面：中文意思
        answerEn: wordObj.word,          // 参考答案：英文
        answerZh: wordObj.translation,   // 参考答案：中文
        placeholder: '输入对应的英文…',
      };
    },
  },
};

// ============================================================
// 对外函数
// ============================================================

// 随机出一道题：每题独立抛硬币，两种题型都可能出。
// 不做"两种各占一半"的均衡处理 —— 可能连着出好几道同一种，这是刻意的。
// 重新开一轮时会重新随机。
export function generateQuiz(wordObj) {
  const mode = QUIZ_MODES[Math.floor(Math.random() * QUIZ_MODES.length)];
  return QUIZ_REGISTRY[mode].generate(wordObj);
}

// 列出所有可用题型
export function getQuizModes() {
  return QUIZ_MODES.map(id => ({ id, label: QUIZ_REGISTRY[id]?.label || id }));
}
