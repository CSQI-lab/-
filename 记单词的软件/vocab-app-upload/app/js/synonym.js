/**
 * synonym.js — 同义词整理
 * ============================================================
 * 负责两件事：
 *   ① 自动归组：把「已经学过」的词按同义关系归组（只读展示）
 *   ② 手动整理：自己新建 / 编辑 / 删除同义词组
 *
 * 规则（按你的要求）：
 *   - 自动组只统计**已学过**的词，没学过的不显示
 *   - 一组里已学词不足 2 个就不显示（一个词凑不成"同义"）
 *   - **凡是已经被手动整理进某个组的词，自动组里就不再重复出现**
 *   - 自动组按已学词多的排前面
 *
 * 自动组数据来源：ECDICT 近义词辨析库（预处理成 words.json 里的 synsets）
 * 手动组存在同一个 synsets 表里，用 origin:'manual' 区分。
 *
 * 对外提供：getManualSynsets / getManualWordSet / getMySynonyms /
 *           getSynonymsOf / saveSynset / removeSynset / getAllSynsetGroups
 */

import {
  getAllSynsets, getLearnedWordSet,
  updateSynset, deleteSynset,
} from './db.js';

// ============================================================
// 手动组：自己整理的那些
// ============================================================

export async function getManualSynsets() {
  const all = await getAllSynsets();
  return all.filter(s => s.origin === 'manual');
}

// 已被手动整理过的词（自动组要靠它排除重复）
export async function getManualWordSet() {
  const manual = await getManualSynsets();
  const set = new Set();
  manual.forEach(s => (s.words || []).forEach(w => set.add(w)));
  return set;
}

// 新建或更新一个手动组（words 会去重、去空格、统一小写）
export async function saveSynset(id, title, words) {
  const clean = [...new Set(
    (words || []).map(w => String(w).trim().toLowerCase()).filter(Boolean)
  )];
  const synset = {
    id,
    title: String(title || '').trim(),
    words: clean,
    origin: 'manual',
  };
  await updateSynset(synset);       // put：不存在就新建，存在就覆盖
  return synset;
}

// 删除一个手动组
export async function removeSynset(id) {
  await deleteSynset(id);
}

// ============================================================
// 自动归组：只含已学过的词，且排除手动整理过的词
// ============================================================
export async function getMySynonyms() {
  const allSynsets = await getAllSynsets();
  const learned = await getLearnedWordSet();

  // 收集所有手动组里的词
  const manualWords = new Set();
  allSynsets
    .filter(s => s.origin === 'manual')
    .forEach(s => (s.words || []).forEach(w => manualWords.add(w)));

  const result = allSynsets
    .filter(s => s.origin !== 'manual')
    .map(syn => {
      // 只留「已学过」且「没被手动整理过」的词
      const learnedWords = (syn.words || [])
        .filter(w => learned.has(w) && !manualWords.has(w));
      return { ...syn, learnedWords, allWords: learnedWords };
    })
    // 一个词凑不成同义关系：至少 2 个才显示
    .filter(s => s.learnedWords.length >= 2);

  result.sort((a, b) => b.learnedWords.length - a.learnedWords.length);
  return result;
}

// ============================================================
// 获取某个词的所有同义词（预留给单词卡片下方展示用）
// ============================================================
export async function getSynonymsOf(word) {
  const allSynsets = await getAllSynsets();
  for (const syn of allSynsets) {
    if (syn.words.includes(word)) {
      return syn.words.filter(w => w !== word);
    }
  }
  return [];
}

// 获取所有同义词组（备份/管理用）
export async function getAllSynsetGroups() {
  return await getAllSynsets();
}
