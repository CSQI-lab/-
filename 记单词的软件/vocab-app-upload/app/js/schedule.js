/**
 * schedule.js — 艾宾浩斯复习调度
 * ============================================================
 * 负责：根据答题结果调整每个词的复习间隔，并决定本次考哪些词。
 *
 * 艾宾浩斯记忆曲线间隔（天数）：1 → 2 → 4 → 7 → 15 → 30
 *   答对一次 → 进入下一级（间隔变长）
 *   答错一次 → 回退一级（间隔变短）
 *   到达最高级（stage=5，间隔30天）= 基本掌握，定期保持
 *
 * 两种复习范围：
 *   - 'today' 今日单词复习：当天「确定」了几个词就考几题，全部考，只打乱顺序
 *   - 'all'   全部已学复习：从所有学过的词里按权重抽 REVIEW_QUIZ_COUNT 题
 *
 * 抽题权重（仅 'all' 模式，三个因素叠加，见 weightOf）：
 *   ① 艾宾浩斯：到期/超期越久权重越高，还没到期权重很低
 *   ② 全部正确率：历史正确率越低权重越高
 *   ③ 今日复习正确率：今天答错过的词，权重再放大
 *
 * 对外提供：recordAnswer() 记录答题、getTodayQueue() 取今日任务、
 *           pickReviewWords() 按权重抽本次要考的题。
 */

import { EBBINGHAUS_INTERVALS, REVIEW_QUIZ_COUNT, REVIEW_WEIGHTS } from './config.js';
import {
  getProgress, setProgress, getDueReview, getAllDaily, getAllProgress, getLearnedWordSet,
} from './db.js';
import { getTodayStr, addDays } from './pick.js';

// ============================================================
// 记录一次答题结果，更新该词的复习进度
// ============================================================
// 参数：word 单词, dir 方向('en2zh'|'zh2en'), ok 是否答对
export async function recordAnswer(word, dir, ok) {
  const today = getTodayStr();
  let p = await getProgress(word);

  if (!p) {
    // 第一次学这个词：从 stage 0 开始，1 天后复习
    p = {
      word,
      stage: 0,
      due: addDays(today, EBBINGHAUS_INTERVALS[0]),
      learnedAt: today,
      history: [],
    };
  }

  // 记录这次答题
  p.history.push({ date: today, dir, ok });

  // 调整 stage（等级）
  if (ok) {
    // 答对 → 前进一级（最高到 5，即 INTERVALS 的最后一个 index）
    p.stage = Math.min(p.stage + 1, EBBINGHAUS_INTERVALS.length - 1);
  } else {
    // 答错 → 后退一级（最低到 0）
    p.stage = Math.max(p.stage - 1, 0);
  }

  // 计算下次复习日期 = 今天 + 当前等级对应的间隔
  p.due = addDays(today, EBBINGHAUS_INTERVALS[p.stage]);

  // 保存
  await setProgress(p);
  return p;
}

// ============================================================
// 获取今日任务队列 = 待复习的词 + 今日新词
// ============================================================
export async function getTodayQueue(today) {
  // 1. 待复习：due <= today 的词
  const dueList = await getDueReview(today);

  // 2. 今日新词：从 daily 表找今天的记录
  const allDaily = await getAllDaily();
  const todayDaily = allDaily.find(d => d.date === today);
  const newWords = todayDaily ? todayDaily.wordList : [];

  // 3. 合并：先复习旧的，再学新的（符合记忆规律）
  return {
    review: dueList.map(p => p.word),   // 待复习的词列表
    newWords,                            // 今日新词列表
    all: [...dueList.map(p => p.word), ...newWords],  // 全部（复习+新词）
    reviewCount: dueList.length,
    newCount: newWords.length,
  };
}

// ============================================================
// 获取某个词的复习状态摘要（UI 展示用）
// ============================================================
export async function getWordStatus(word) {
  const p = await getProgress(word);
  if (!p) return { stage: -1, due: null, learned: false, totalReviews: 0, correctRate: 0 };

  const total = p.history.length;
  const correct = p.history.filter(h => h.ok).length;
  return {
    stage: p.stage,
    due: p.due,
    learned: true,
    totalReviews: total,
    correctRate: total > 0 ? Math.round(correct / total * 100) : 0,
  };
}

// ============================================================
// 按权重抽出本次要考的单词
// ============================================================
// 参数：
//   scope — 'today'（今天的词全考，学几个考几个）| 'all'（从所有已学词里抽 count 题）
//   count — 'all' 模式下出几道题（默认 REVIEW_QUIZ_COUNT = 10）；'today' 模式忽略它
// 返回：单词字符串数组
export async function pickReviewWords(scope, count = REVIEW_QUIZ_COUNT) {
  const today = getTodayStr();
  const allProgress = await getAllProgress();
  const progMap = new Map(allProgress.map(p => [p.word, p]));

  // --- 候选词 ---
  let candidates = [];
  if (scope === 'today') {
    const allDaily = await getAllDaily();
    const todayDaily = allDaily.find(d => d.date === today);
    candidates = todayDaily ? [...todayDaily.wordList] : [];
    // 今日复习：学了多少个就考多少个，不截断到 10 题。
    // 只把顺序打乱（每次重测顺序都不一样），权重抽样留给「全部已学复习」。
    return shuffle(candidates);
  } else {
    const learned = await getLearnedWordSet();
    candidates = [...learned];
  }
  if (candidates.length === 0) return [];

  // --- 今日每个词的答题表现（今天答错多的，权重更高）---
  const todayStats = new Map();
  for (const p of allProgress) {
    const todayRecords = (p.history || []).filter(h => h.date === today);
    if (todayRecords.length === 0) continue;
    todayStats.set(p.word, {
      total: todayRecords.length,
      ok: todayRecords.filter(h => h.ok).length,
    });
  }

  // --- 算权重 ---
  const weights = candidates.map(w => weightOf(progMap.get(w), todayStats.get(w), today));

  // --- 按权重不放回抽样 ---
  return weightedSample(candidates, weights, count);
}

// 洗牌：把顺序完全打乱，每次结果都可能不同
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 单个词的权重：越大越容易被抽到
function weightOf(progress, todayStat, today) {
  const W = REVIEW_WEIGHTS;
  let w;

  if (!progress) {
    // 还没考过（今天刚加的词）→ 中等偏上，优先过一遍
    w = W.neverTested;
  } else {
    // ① 艾宾浩斯：距离应复习日期多久
    const overdue = daysBetween(progress.due, today);   // 正数 = 已经过期
    if (overdue > 0) {
      w = 1 + Math.min(overdue, 15) * W.overduePerDay;  // 超期越久越该考
    } else if (overdue === 0) {
      w = W.dueToday;                                   // 正好到期
    } else {
      // 还没到期：权重随距离衰减，但不会归零（全部复习仍有机会抽到）
      w = Math.max(W.min, 1 - Math.abs(overdue) * W.notDueDecay);
    }
    // 复习阶段越低（记忆越不稳）权重略高
    w *= 1 + (5 - progress.stage) * W.stageFactor;

    // ② 历史正确率：越不准越该考
    const hist = progress.history || [];
    if (hist.length > 0) {
      const acc = hist.filter(h => h.ok).length / hist.length;
      w *= 1 + (1 - acc) * W.accuracyFactor;
    }
  }

  // ③ 今天答错过的词，权重再放大
  if (todayStat && todayStat.total > 0) {
    const acc = todayStat.ok / todayStat.total;
    if (acc < 1) w *= 1 + (1 - acc) * W.todayWrongFactor;
  }

  return Math.max(w, 0.01);
}

// 按权重不放回抽样 n 个
function weightedSample(items, weights, n) {
  const pool = items.map((it, i) => ({ it, w: Math.max(weights[i], 0.01) }));
  const picked = [];
  const take = Math.min(n, pool.length);

  for (let k = 0; k < take; k++) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= pool[idx].w;
      if (r <= 0) break;
    }
    picked.push(pool[idx].it);
    pool.splice(idx, 1);
  }
  return picked;
}

// 两个 YYYY-MM-DD 相差多少天（a - b）
function daysBetween(a, b) {
  if (!a || !b) return 0;
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((da - db) / 86400000);
}
