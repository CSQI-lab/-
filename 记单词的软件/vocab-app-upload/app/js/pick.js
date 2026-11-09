/**
 * pick.js — 每日抽词
 * ============================================================
 * 负责：每天从词库里挑出 10 个词（数量由 config.DAILY_COUNT 决定）。
 *
 * 抽词规则（避免重复、循序渐进）：
 *   1. 排除最近 30 天已经推送过的词（不让短期重复）
 *   2. 排除正在复习周期内且未到期的词（避免和复习撞车）
 *   3. 牛津 3000 核心词优先
 *   4. 词频高的（更常见的）优先
 *   5. 取前 N 个
 *
 * 对外提供：pickDaily(today) 返回今日词列表、getTodayStr() 返回今天日期。
 * 改这里会影响到：每天推送哪些词。
 */

import { DAILY_COUNT, RECENT_EXCLUDE_DAYS, VOCAB_LEVELS, DEFAULT_LEVEL } from './config.js';
import { getAllWords, getAllDaily, getAllProgress } from './db.js';

// ============================================================
// 生成今日单词列表
// ============================================================
// levelId：词汇档位（'cet6' 等），不传就用默认档位
export async function pickDaily(today, levelId) {
  const level = VOCAB_LEVELS[levelId] || VOCAB_LEVELS[DEFAULT_LEVEL];
  const allWords = await getAllWords();
  const allDaily = await getAllDaily();
  const allProgress = await getAllProgress();

  // --- 第1步：收集近 30 天出现过的词，这些不再重复推送 ---
  const recentWords = new Set();
  const cutoff = subtractDays(today, RECENT_EXCLUDE_DAYS);  // 30 天前的日期
  for (const d of allDaily) {
    if (d.date >= cutoff) {           // 日期字符串比较：YYYY-MM-DD 格式可以直接比
      d.wordList.forEach(w => recentWords.add(w));
    }
  }

  // --- 第2步：排除正在复习周期内、未到期的词 ---
  for (const p of allProgress) {
    if (p.due > today) {              // 还没到复习日期的，不重复推送
      recentWords.add(p.word);
    }
  }

  // --- 第3步：按档位筛词（考试标签 + 词频区间） ---
  const candidates = allWords.filter(w =>
    !recentWords.has(w.word) && matchLevel(w, level)
  );

  // --- 第4步：档位内按词频从高到低（先学该档位里相对常用的） ---
  candidates.sort((a, b) => freqOf(a) - freqOf(b));

  // --- 第5步：取前 N 个，只返回单词字符串 ---
  return candidates.slice(0, DAILY_COUNT).map(w => w.word);
}

// 判断一个词是否符合当前难度档位
//   单词：词频落在 [minFrq, maxFrq]
//   短语：没有词频数据，按档位的 allowPhrase 决定收不收
function matchLevel(w, level) {
  // 档位如果配了考试标签，就先按标签筛（当前四档没配，纯按难度）
  if (level.tags && level.tags.length) {
    const tags = (w.tag || '').split(/\s+/);
    if (!level.tags.some(t => tags.includes(t))) return false;
  }
  if (w.isPhrase) return level.allowPhrase === true;

  const frq = freqOf(w);
  if (frq >= 999999) return false;             // 没有词频数据（多为生僻词）不收
  return frq >= level.minFrq && frq <= level.maxFrq;
}

// 取词频（0 表示没有数据，返回一个大数方便排最后 / 被过滤）
function freqOf(w) {
  return w.frq && w.frq > 0 ? w.frq : 999999;
}

// ============================================================
// 日期工具函数
// ============================================================

// 获取今天的日期字符串，格式 YYYY-MM-DD（用本地时区，不是 UTC）
export function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 日期减 n 天：'2026-11-08' 减 30 天 → '2026-10-09'
function subtractDays(dateStr, n) {
  return addDays(dateStr, -n);
}

// 日期加 n 天（n 可为负数）：返回 YYYY-MM-DD
export function addDays(dateStr, n) {
  const [y, m, dd] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, dd);   // 用本地时区构造，避免 UTC 偏移
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
