/**
 * db.js — 数据层（IndexedDB 封装）
 * ============================================================
 * 负责：所有数据的存取。其他模块（pick.js / quiz.js / ui.js 等）
 *       只通过本文件提供的函数访问数据，不直接碰 IndexedDB API。
 *
 * 这样设计的好处：以后想换成 SQLite 或云端同步，
 * 只改这一个文件，业务代码一行不动。
 *
 * 对外提供：各类 CRUD 函数 + initDB() 初始化入口。
 * 改这里会影响到：所有数据的读写方式。
 */

import { DB_NAME, DB_VERSION, DEFAULT_LEVEL } from './config.js';
import { SAMPLE_WORDS, SAMPLE_IDIOMS, SAMPLE_SYNSETS } from './seed.js';

// 数据库连接（打开后缓存，避免重复打开）
let db = null;

// ============================================================
// 底层工具：把 IndexedDB 的回调式 API 包成 Promise（好写 await）
// ============================================================

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 获取某个表的 ObjectStore（操作句柄）
function store(name, mode = 'readonly') {
  return db.transaction(name, mode).objectStore(name);
}

// ============================================================
// 打开 / 创建数据库
// ============================================================

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    // 数据库升级时触发（首次创建或版本号变大）
    // 这里定义所有表的结构。以后改了表结构 → DB_VERSION +1 → 在这里加迁移代码
    req.onupgradeneeded = (event) => {
      const database = event.target.result;

      // words 表：主键是 word（单词本身）
      if (!database.objectStoreNames.contains('words')) {
        const s = database.createObjectStore('words', { keyPath: 'word' });
        s.createIndex('oxford', 'oxford');   // 按牛津核心词查
        s.createIndex('tag', 'tag');          // 按考试标签查
      }

      // idioms 表：主键是 id
      if (!database.objectStoreNames.contains('idioms')) {
        database.createObjectStore('idioms', { keyPath: 'id' });
      }

      // daily 表：主键是 date（如 '2026-11-08'）
      if (!database.objectStoreNames.contains('daily')) {
        database.createObjectStore('daily', { keyPath: 'date' });
      }

      // progress 表：主键是 word（一个词一条复习进度）
      if (!database.objectStoreNames.contains('progress')) {
        const s = database.createObjectStore('progress', { keyPath: 'word' });
        s.createIndex('due', 'due');  // 按到期日查（生成复习队列用）
      }

      // synsets 表：同义词组
      if (!database.objectStoreNames.contains('synsets')) {
        database.createObjectStore('synsets', { keyPath: 'id' });
      }

      // favorites 表：收藏的单词（主键是 word，附带收藏时间）
      if (!database.objectStoreNames.contains('favorites')) {
        database.createObjectStore('favorites', { keyPath: 'word' });
      }

      // settings 表：单行，key 固定 'app'（存放设置项）
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }

      // meta 表：存放版本号等元信息
      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

// ============================================================
// 初始化：打开数据库 → 同步词库 → 确保设置存在
// ============================================================

export async function initDB() {
  await openDB();

  // 加载 / 升级词库（版本变化时自动换新，用户数据不动）
  await syncWordLibrary();

  // 确保 settings 有默认行
  const settings = await getSettings();
  if (!settings) {
    await setSettings({
      key: 'app',
      lastOpenDate: '',
      quizDir: 'both',
      ttsRate: 0.9,
      dailyCount: 10,
      level: DEFAULT_LEVEL,     // 词汇档位（默认六级）
    });
  }
}

// ============================================================
// 词库同步（升级机制）
// ============================================================
// 规则：
//   1. 每次启动读 data/words.json（被 Service Worker 缓存，断网也能读）
//   2. 版本没变 → 什么都不做（秒开）
//   3. 版本变了或库里还是空的 → 覆盖 words 和 synsets
//      （synsets 只保留用户手动建的组，一起合并进去）
//      idioms（俗语）是用户自己的，永远不动
//   4. words.json 读不到且库是空的 → 用 seed.js 样本数据兜底
async function syncWordLibrary() {
  let lib = null;
  try {
    const resp = await fetch('data/words.json');
    if (resp.ok) {
      const data = await resp.json();
      if (data.words && data.words.length > 0) lib = data;
    }
  } catch (e) {
    // 离线且没缓存时会走到这里，下面用现有数据兜底
  }

  if (lib) {
    // 词库版本号 = 生成日期 + 词数，足够判断"变没变"
    const libVer =
      ((lib.meta && lib.meta.generatedAt) || '') + '-' + lib.words.length;
    const storedVer = await getMeta('wordLibVersion');

    if (storedVer && storedVer.value === libVer) return;  // 版本一致，秒过

    // 版本变了：清旧词 → 灌新词
    const t0 = Date.now();
    await clearStore('words');
    await bulkPut('words', lib.words);

    // 近义词组：JSON 里的组 + 用户手动建的组（保留用户数据）
    if (lib.synsets && lib.synsets.length > 0) {
      const existing = await getAllSynsets();
      const manualGroups = existing.filter(s => s.origin === 'manual');
      await clearStore('synsets');
      await bulkPut('synsets', [...lib.synsets, ...manualGroups]);
    }

    // 俗语：只在一次都没灌过时放入 3 条示例（用户删了就不会再回来）
    if ((await countAll('idioms')) === 0 && !(await getMeta('idiomSeeded'))) {
      await bulkPut('idioms', SAMPLE_IDIOMS);
      await setMeta('idiomSeeded', true);
    }

    await setMeta('wordLibVersion', libVer);
    await setMeta('schemaVersion', DB_VERSION);
    console.log(`[词库] 已加载：${lib.words.length} 词 + ` +
      `${lib.synsets ? lib.synsets.length : 0} 组近义词（${Date.now() - t0}ms）`);
    return;
  }

  // words.json 读不到（还没部署 / 离线没缓存）：库空时用样本兜底
  if ((await countAll('words')) === 0) {
    console.log('[词库] words.json 不可用，使用样本数据');
    await bulkPut('words', SAMPLE_WORDS);
    await bulkPut('synsets', SAMPLE_SYNSETS);
    if ((await countAll('idioms')) === 0) {
      await bulkPut('idioms', SAMPLE_IDIOMS);
      await setMeta('idiomSeeded', true);
    }
    await setMeta('schemaVersion', DB_VERSION);
  }
}

// ============================================================
// 通用函数：count / bulkPut / clear
// ============================================================

async function countAll(name) {
  return promisify(store(name).count());
}

async function bulkPut(name, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const os = tx.objectStore(name);
    items.forEach(item => os.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 导出版本（供 backup.js 导入备份时批量写入）
export async function bulkPutImport(name, items) {
  return bulkPut(name, items);
}

async function clearStore(name) {
  return promisify(store(name, 'readwrite').clear());
}

// ============================================================
// words 表（单词库）
// ============================================================

export async function getAllWords() {
  return promisify(store('words').getAll());
}

export async function getWord(word) {
  return promisify(store('words').get(word));
}

export async function addWord(wordObj) {
  return promisify(store('words', 'readwrite').add(wordObj));
}

export async function updateWord(wordObj) {
  return promisify(store('words', 'readwrite').put(wordObj));
}

export async function deleteWord(word) {
  return promisify(store('words', 'readwrite').delete(word));
}

// 搜索：按输入的字母顺序（前缀）匹配
//   英文输入 → 只匹配「以这些字母开头」的词：输入 lar 出 large，不会出 alarm
//   中文输入 → 匹配释义里包含这些字的词
export async function searchWords(query, limit = 50) {
  const all = await getAllWords();
  const q = query.toLowerCase().trim();
  if (!q) return all.slice(0, limit);

  // 纯字母（可带连字符/撇号）查询 → 走前缀匹配
  const isLatin = /^[a-z'’\-\s.]+$/.test(q);

  if (isLatin) {
    return all.filter(w => w.word.toLowerCase().startsWith(q)).slice(0, limit);
  }

  // 中文查询 → 释义包含即可（中文没有"前缀"的概念）
  return all
    .filter(w => w.translation && w.translation.includes(q))
    .slice(0, limit);
}

// ============================================================
// idioms 表（俗语库）
// ============================================================

export async function getAllIdioms() {
  return promisify(store('idioms').getAll());
}

export async function addIdiom(idiomObj) {
  return promisify(store('idioms', 'readwrite').add(idiomObj));
}

export async function updateIdiom(idiomObj) {
  return promisify(store('idioms', 'readwrite').put(idiomObj));
}

export async function deleteIdiom(id) {
  return promisify(store('idioms', 'readwrite').delete(id));
}

// ============================================================
// daily 表（每日学习记录，按日期）
// ============================================================

export async function getDaily(date) {
  return promisify(store('daily').get(date));
}

export async function setDaily(dailyObj) {
  return promisify(store('daily', 'readwrite').put(dailyObj));
}

// 删掉某一天的整份单词记录
export async function deleteDaily(date) {
  return promisify(store('daily', 'readwrite').delete(date));
}

export async function getAllDaily() {
  // 返回所有每日记录，按日期倒序（最新的在前）
  const all = await promisify(store('daily').getAll());
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

// ============================================================
// progress 表（每个词的复习进度）
// ============================================================

export async function getProgress(word) {
  return promisify(store('progress').get(word));
}

export async function setProgress(progressObj) {
  return promisify(store('progress', 'readwrite').put(progressObj));
}

export async function getAllProgress() {
  return promisify(store('progress').getAll());
}

// 取今日待复习的词（due <= today）
export async function getDueReview(today) {
  const all = await getAllProgress();
  return all.filter(p => p.due <= today && p.stage < 5);
  // stage < 5 表示还没到最高级（还没"毕业"）；stage=5 表示已掌握
}

// ============================================================
// 「已学」相关：判断哪些词算学过
// ============================================================
// 定义（按你的要求）：**只有在「今日」页点过「确定」的那一天，词才算已学**。
// 每天自动生成的 10 个词只是"草稿"，没点确定之前不进已学，
// 也不参与同义词自动归组和「全部已学复习」。
//
// 过去的日期特殊处理：那天已经过去、没法再补点「确定」了，
// 所以历史记录默认视为已学（同时兼容早期版本没有 confirmed 字段的数据）。
// 「已学」页、同义词本、全部复习都用这一套口径，保证各处一致。

// 本地算今天的日期字符串（不 import pick.js，避免循环依赖）
function localTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 某一天是否算「已学」
export function isLearnedDaily(d, today) {
  if (!d || !d.date) return false;
  if (d.confirmed === true) return true;      // 点过确定
  return d.date < (today || localTodayStr()); // 过去的日子默认算（无法补点）
}

// 已学词集合（Set<单词字符串>）
export async function getLearnedWordSet() {
  const allDaily = await getAllDaily();
  const today = localTodayStr();
  const set = new Set();
  allDaily
    .filter(d => isLearnedDaily(d, today))
    .forEach(d => (d.wordList || []).forEach(w => set.add(w)));
  return set;
}

// 已学词的完整词条列表（带音标、释义）
export async function getLearnedWords() {
  const set = await getLearnedWordSet();
  if (set.size === 0) return [];
  const all = await getAllWords();
  return all.filter(w => set.has(w.word));
}

// ============================================================
// synsets 表（同义词组）
// ============================================================

export async function getAllSynsets() {
  return promisify(store('synsets').getAll());
}

export async function addSynset(synsetObj) {
  return promisify(store('synsets', 'readwrite').add(synsetObj));
}

export async function updateSynset(synsetObj) {
  return promisify(store('synsets', 'readwrite').put(synsetObj));
}

export async function deleteSynset(id) {
  return promisify(store('synsets', 'readwrite').delete(id));
}

// ============================================================
// favorites 表（收藏：单词 / 俗语 / 同义词组）
// ============================================================
// type：'word' 单词 / 'idiom' 俗语 / 'synset' 同义词组
// 三类共用一个表；主键字段叫 word，对俗语和同义词存的是它们的 id

export async function getAllFavorites() {
  const list = await promisify(store('favorites').getAll());
  // 最新收藏的排前面
  return list.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
}

export async function getFavorite(word) {
  return promisify(store('favorites').get(word));
}

export async function addFavorite(key, type = 'word') {
  return promisify(store('favorites', 'readwrite').put({
    word: key,
    type,
    addedAt: new Date().toISOString(),
  }));
}

export async function deleteFavorite(word) {
  return promisify(store('favorites', 'readwrite').delete(word));
}

// ============================================================
// settings 表（设置项，单行 key='app'）
// ============================================================

export async function getSettings() {
  return promisify(store('settings').get('app'));
}

export async function setSettings(settingsObj) {
  const obj = { ...settingsObj, key: 'app' };
  return promisify(store('settings', 'readwrite').put(obj));
}

// ============================================================
// meta 表（版本等元信息）
// ============================================================

export async function getMeta(key) {
  return promisify(store('meta').get(key));
}

export async function setMeta(key, value) {
  return promisify(store('meta', 'readwrite').put({ key, value }));
}

// ============================================================
// 备份用：导出全部数据 / 清空全部数据（供 backup.js 调用）
// ============================================================

export async function exportAllData() {
  return {
    words: await getAllWords(),
    idioms: await getAllIdioms(),
    daily: await getAllDaily(),
    progress: await getAllProgress(),
    synsets: await getAllSynsets(),
    favorites: await getAllFavorites(),
    settings: await getSettings(),
    meta: {
      schemaVersion: DB_VERSION,
      appVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
    },
  };
}

export async function clearAllData() {
  // 清空所有表（导入备份前调用）
  await clearStore('words');
  await clearStore('idioms');
  await clearStore('daily');
  await clearStore('progress');
  await clearStore('synsets');
  await clearStore('favorites');
  await clearStore('settings');
  await clearStore('meta');
}
