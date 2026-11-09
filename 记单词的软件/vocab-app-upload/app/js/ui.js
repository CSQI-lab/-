/**
 * ui.js — 界面总控（完整版）
 * ============================================================
 * 负责：页面切换、渲染、用户交互。
 * 所有业务数据来自其他模块，本文件只管「怎么画出来、怎么响应点击」。
 *
 * 设计：用「全局事件委托」——所有按钮带 data-action 属性，
 *       统一在一个 click 监听器里分发，不用每个按钮单独绑事件。
 *
 * 对外提供：无（本文件是入口，自己启动）。
 * 以后想加新页面：在 PAGES 里加一项 + 写个 render 函数。
 */

import { VOCAB_LEVELS, DEFAULT_LEVEL, LEGACY_LEVEL_MAP, REVIEW_QUIZ_COUNT } from './config.js';
import {
  initDB, getDaily, setDaily, getAllDaily, deleteDaily,
  getAllWords, getWord, searchWords,
  getLearnedWordSet, isLearnedDaily,
  getAllFavorites, addFavorite, deleteFavorite,
  getSettings, setSettings,
  getAllIdioms, updateIdiom, deleteIdiom,
} from './db.js';
import { pickDaily, getTodayStr } from './pick.js';
import { getTodayQueue, recordAnswer, pickReviewWords } from './schedule.js';
import { generateQuiz } from './quiz.js';
import {
  getMySynonyms, getManualSynsets, saveSynset, removeSynset,
} from './synonym.js';
import { speakWord } from './tts.js';
import { updateBadge } from './badge.js';
import { exportBackup, importBackup } from './backup.js';
import { pickFile } from './native-bridge.js';

// ============================================================
// 页面登记表（以后加新页面在这里加一项）
// ============================================================
const PAGES = {
  today:    { title: '今日', render: renderToday },
  library:  { title: '已学', render: renderLibrary },
  dict:     { title: '词典', render: renderDict },
  review:   { title: '复习', render: renderReview },
  settings: { title: '我的', render: renderSettings },
};

let currentPage = 'today';

// 今天是否已点过「确定」——决定词卡上要不要显示垃圾桶、要不要显示加号框
let todayConfirmed = false;

// 已收藏的词（内存里存一份，画词卡时直接用，不用每张卡都查库）
let favoriteSet = new Set();

// 「我的」页当前显示哪一屏：'main' 主页面 / 'list' 收藏列表
let settingsView = 'main';

// 考核状态（考核过程中用）
let quizState = null;

// ============================================================
// 难度档位解析（含老数据迁移）
// ============================================================
// 档位改版过一次（4 档 → 3 档），老用户存的 hard/expert 含义变了。
// 用 levelVersion 标记区分：没有标记的老数据走 LEGACY_LEVEL_MAP 映射一次。
const LEVEL_VERSION = 2;

function resolveLevel(settings) {
  const raw = settings.level;
  if (!raw) return DEFAULT_LEVEL;
  if (settings.levelVersion !== LEVEL_VERSION) {
    // 老数据：按映射表转换（旧的"难"归到新的"中"，即六级档）
    return LEGACY_LEVEL_MAP[raw] || (VOCAB_LEVELS[raw] ? raw : DEFAULT_LEVEL);
  }
  return VOCAB_LEVELS[raw] ? raw : DEFAULT_LEVEL;
}

// ============================================================
// 启动入口
// ============================================================
async function init() {
  // 1. 初始化数据库（首次会自动填充样本词库）
  await initDB();

  // 2. 把收藏的词读进内存（画词卡时判断星标亮不亮）
  await loadFavorites();

  // 3. 每日生成（新的一天首次打开 → 生成 10 词）
  await onAppOpen();

  // 4. 绑定底部标签点击
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchPage(tab.dataset.page));
  });

  // 5. 全局事件委托（所有 data-action 按钮统一处理）
  document.addEventListener('click', handleAction);

  // 6. 所有输入框：横向滑动 = 全选（全局委托，以后新加的输入框也自动生效）
  setupSlideSelect();

  // 7. 默认显示今日页
  await switchPage('today');
}

// ============================================================
// 每日生成：新的一天首次打开时，自动生成今日 10 词
// ============================================================
async function onAppOpen() {
  const today = getTodayStr();
  const settings = await getSettings();

  // 解析当前档位（自动处理旧版本数据）
  const levelId = resolveLevel(settings);
  const levelNeedsInit =
    settings.level !== levelId || settings.levelVersion !== LEVEL_VERSION;

  // 今天还没生成过，或档位需要初始化（把之前按旧规则抽的词换掉）
  if (!settings.lastOpenDate || settings.lastOpenDate !== today || levelNeedsInit) {
    const wordList = await pickDaily(today, levelId);
    await setDaily({ date: today, wordList, source: 'auto' });
    await setSettings({
      ...settings, lastOpenDate: today, level: levelId, levelVersion: LEVEL_VERSION,
    });
    console.log(`[每日] 已按「${VOCAB_LEVELS[levelId].label}」生成 ${today} 的 ${wordList.length} 个词`);
  }

  // 更新桌面角标 = 今日待学总数
  const queue = await getTodayQueue(today);
  await updateBadge(queue.all.length);
}

// ============================================================
// 切换页面
// ============================================================
async function switchPage(pageId) {
  const page = PAGES[pageId];
  if (!page) return;
  currentPage = pageId;

  // 从底部页签进「我的」时，总是回到主页面（不要停在收藏列表里）
  if (pageId === 'settings') settingsView = 'main';

  document.getElementById('page-title').textContent = page.title;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${pageId}`).classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-page="${pageId}"]`)?.classList.add('active');

  // 难度按钮只属于「今日」页：切走时清空，切回时重画
  await renderHeaderLevel();

  await page.render(document.getElementById(`page-${pageId}`));
}

// ============================================================
// 顶部标题栏右侧的难度小按钮
//   只有「今日」页显示；显示当前档位一个汉字（易/中/难），
//   点一下向右侧弹出三个选项。
// ============================================================
async function renderHeaderLevel() {
  const box = document.getElementById('header-level');
  if (!box) return;

  if (currentPage !== 'today') {
    box.innerHTML = '';
    return;
  }

  const settings = await getSettings();
  const levelId = resolveLevel(settings);
  const level = VOCAB_LEVELS[levelId];

  // 三个选项（不含当前档位以外的档位也列出，方便回选）
  const items = Object.entries(VOCAB_LEVELS).map(([id, lv]) =>
    `<button class="level-item ${id === levelId ? 'active' : ''}" data-action="set-level" data-level="${id}">${lv.label}</button>`
  ).join('');

  box.innerHTML = `
    <div class="level-picker" id="level-picker">
      <button class="level-trigger" data-action="toggle-level-menu" aria-label="切换难度">${level.label}</button>
      <div class="level-menu" id="level-menu">${items}</div>
    </div>`;
}

// ============================================================
// 全局事件分发
// ============================================================
function handleAction(e) {
  const el = e.target.closest('[data-action]');
  const action = el ? el.dataset.action : null;

  // 点菜单以外的地方 → 收起难度菜单
  // 注意：菜单挂在顶部标题栏里，不在今日页容器内，所以这里统一处理收起
  const menu = document.getElementById('level-menu');
  if (menu && menu.classList.contains('open') &&
      action !== 'toggle-level-menu' && !String(action).startsWith('set-level')) {
    menu.classList.remove('open');
  }

  if (!action) {
    // 点到了遮罩空白处 → 关闭当前打开的抽屉
    onMaskClick(e);
    return;
  }

  switch (action) {
    case 'speak': {
      // 喇叭播放动画：读的时候音波脉冲，读完自动停
      // 至少保留 500ms，避免朗读秒结束导致动画一闪而过
      el.classList.add('playing');
      const startedAt = Date.now();
      const stop = () => {
        const rest = Math.max(0, 500 - (Date.now() - startedAt));
        setTimeout(() => el.classList.remove('playing'), rest);
      };
      speakWord(el.dataset.word, stop);
      setTimeout(stop, 3000);   // 兜底：3 秒必停
      break;
    }
    case 'toggle-level-menu': {
      document.getElementById('level-menu')?.classList.toggle('open');
      break;
    }
    case 'confirm-today':  confirmToday(); break;
    case 'open-add-sheet': openAddSheet(); break;
    case 'close-add-sheet': closeAddSheet(); break;
    case 'pick-add-word':  pickAddWord(el.dataset.word); break;
    case 'start-quiz':   startQuiz(el.dataset.scope || 'all'); break;
    case 'quiz-again':   startQuiz(el.dataset.scope || 'all'); break;
    case 'quiz-back':    quizBack(); break;
    case 'submit-quiz':  submitQuiz(el); break;
    case 'confirm-ok':   confirmQuiz(true); break;
    case 'confirm-wrong':confirmQuiz(false); break;
    case 'next-quiz':    nextQuiz(); break;
    case 'export-backup': doExport(); break;
    case 'import-backup': doImport(); break;
    case 'remove-word':  removeTodayWord(el.dataset.word); break;
    case 'remove-learned-word': removeLearnedWord(el.dataset.date, el.dataset.word); break;
    case 'remove-daily-group':  removeDailyGroup(el.dataset.date); break;
    case 'open-idiom-editor':  openIdiomEditor(el.dataset.id || ''); break;
    case 'close-idiom-editor': closeIdiomEditor(); break;
    case 'save-idiom':         saveIdiomEditor(); break;
    case 'del-idiom':    delIdiom(el.dataset.id); break;
    case 'lib-tab':      switchLibTab(el.dataset.tab); break;
    case 'set-level':    setLevel(el.dataset.level); break;
    case 'toggle-date':  toggleDateGroup(el); break;
    case 'open-syn-editor':  openSynEditor(el.dataset.id || ''); break;
    case 'close-syn-editor': closeSynEditor(); break;
    case 'syn-pick-word':    synPickWord(el.dataset.word); break;
    case 'syn-drop-word':    synDropWord(el.dataset.word); break;
    case 'save-synset':      saveSynEditor(); break;
    case 'delete-synset':    deleteSynGroup(el.dataset.id); break;
    case 'toggle-favorite':  toggleFavorite(el.dataset.type, el.dataset.key); break;
    case 'open-favorites':   openFavorites(); break;
    case 'open-fav-list':    openFavList(el.dataset.type); break;
    case 'back-to-fav-menu': backToFavMenu(); break;
    case 'close-favorites':  closeFavorites(); break;
    case 'edit-profile':     openProfileEditor(); break;
    case 'close-profile-editor': closeProfileEditor(); break;
    case 'pick-avatar':      pickAvatar(el.dataset.avatar); break;
    case 'save-profile':     saveProfileEditor(); break;
    case 'cancel-crop':      cancelCrop(); break;
    case 'confirm-crop':     confirmCrop(); break;
  }
}

// ============================================================
// 今日页
// ============================================================
async function renderToday(container) {
  const today = getTodayStr();
  const daily = await getDaily(today);
  const queue = await getTodayQueue(today);

  // 难度按钮在顶部标题栏（「今日」右边），这里只负责把它画出来
  await renderHeaderLevel();

  if (!daily || daily.wordList.length === 0) {
    todayConfirmed = !!(daily && daily.confirmed);
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">词</div>
        <p class="empty-text">今天还没有单词</p>
        <p class="empty-hint">点下面的加号自己加，或明天再来看</p>
      </div>
      ${todayConfirmed ? '' : renderAddCard()}`;
    return;
  }

  // 取每个词的详细信息
  const words = await Promise.all(daily.wordList.map(w => getWord(w)));
  const valid = words.filter(Boolean);
  const confirmed = !!daily.confirmed;   // 是否已按「确定」
  todayConfirmed = confirmed;            // 同步给渲染词卡用（决定显示垃圾桶与否）

  // 待复习提示
  const reviewHint = queue.reviewCount > 0
    ? `<div class="card text-center text-muted text-sm">今日待复习 ${queue.reviewCount} 个词，去「复习」页考核</div>`
    : '';

  container.innerHTML = `
    <div class="today-top">
      <span class="today-date">${today}</span>
      ${confirmed
        ? `<span class="confirm-done">已确定</span>`
        : `<button class="confirm-btn" data-action="confirm-today">确定</button>`}
    </div>

    <div class="today-count">已有 ${valid.length} 个词${confirmed ? '' : ' · 加减完点右上角「确定」'}</div>

    ${reviewHint}
    ${valid.map(w => renderWordCard(w)).join('')}
    ${confirmed ? '' : renderAddCard()}
  `;
}

// 加词用的虚线框（里面一个蓝圆圈包着加号，尺寸和词卡一样大）
function renderAddCard() {
  return `
    <button class="add-card" data-action="open-add-sheet" aria-label="添加单词">
      <span class="add-circle">+</span>
    </button>`;
}

// 五角星：实心（已收藏）/ 空心（未收藏）
const STAR_FILLED = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17.1 6.6 20l1-6.1L3.2 9.6l6.1-.9z"></path></svg>';
const STAR_OUTLINE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17.1 6.6 20l1-6.1L3.2 9.6l6.1-.9z"></path></svg>';

// 给一个星标按钮上色 / 换图形
function paintStar(btn, on) {
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
  btn.innerHTML = on ? STAR_FILLED : STAR_OUTLINE;
}

// 垃圾桶图标（今日页删词、已学页清记录、俗语删除共用同一套图形）
const TRASH_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 6h18"></path><path d="M8 6V4h8v2"></path>
  <path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>
</svg>`;

// 星标按钮（单词 / 俗语 / 同义词共用）
function starBtnHTML(type, key, starred) {
  return `<button class="star-btn corner-star ${starred ? 'on' : ''}" data-action="toggle-favorite"
            data-type="${type}" data-key="${esc(key)}"
            aria-label="${starred ? '取消收藏' : '收藏'}">${starred ? STAR_FILLED : STAR_OUTLINE}</button>`;
}

// 俗语卡片（俗语列表和收藏页共用）
//   withTrash：列表里显示删除按钮，收藏页里不显示
//   withEdit：列表里显示「编辑」按钮，收藏页里不显示
function idiomCardHTML(i, { withTrash = true, withEdit = true } = {}) {
  const starred = isFav('idiom', i.id);
  return `
    <div class="word-row">
      <div class="card idiom-card ${starred ? 'fav' : ''}">
        ${starBtnHTML('idiom', i.id, starred)}
        <div class="idiom-text">${esc(i.text)}</div>
        <div class="idiom-meaning">${esc(i.meaning)}</div>
        ${i.example ? `<div class="idiom-example">${esc(i.example)}</div>` : ''}
        ${withEdit ? `<button class="btn btn-secondary btn-block mt-sm" data-action="open-idiom-editor" data-id="${esc(i.id)}">编辑</button>` : ''}
      </div>
      ${withTrash ? `
      <button class="icon-btn danger trash-outside" data-action="del-idiom"
              data-id="${esc(i.id)}" aria-label="删除这条俗语">
        ${TRASH_SVG}
      </button>` : ''}
    </div>`;
}

// 自己建的同义词组卡片（同义词页和收藏页共用）
function synCardHTML(s, { withActions = true } = {}) {
  const starred = isFav('synset', s.id);
  return `
    <div class="word-row">
      <div class="card syn-card ${starred ? 'fav' : ''}">
        ${starBtnHTML('synset', s.id, starred)}
        ${s.title ? `<div class="syn-card-title">${esc(s.title)}</div>` : ''}
        <div class="flex gap-sm" style="flex-wrap:wrap">
          ${s.words.map(w => `<span class="syn-chip">${esc(w)}</span>`).join('')}
        </div>
        ${withActions ? `<button class="btn btn-secondary btn-block mt-sm" data-action="open-syn-editor" data-id="${esc(s.id)}">编辑</button>` : ''}
      </div>
      ${withActions ? `
      <button class="icon-btn danger trash-outside" data-action="delete-synset"
              data-id="${esc(s.id)}" aria-label="删除这一组">
        ${TRASH_SVG}
      </button>` : ''}
    </div>`;
}

// 渲染一个单词卡片
//   布局：单词 + 右侧蓝底音标 + 右上角收藏星标 / 单词下方喇叭 / 释义
//   垃圾桶在卡片外面右侧：今日页「未确定」时是删词，已学页是清除这条学习记录
//   extraBtn：由调用方额外塞进来的按钮（比如已学页的"清除记录"）
function renderWordCard(wordObj, extraBtn = '') {
  // 只有今日页、且今天还没点「确定」时才能删词
  const canEdit = currentPage === 'today' && !todayConfirmed;
  const starred = isFav('word', wordObj.word);
  return `
    <div class="word-row">
      <div class="word-card${starred ? ' fav' : ''}">
        <div class="word-head">
          <span class="word">${wordObj.word}</span>
          ${wordObj.phonetic ? `<span class="phonetic-pill">${wordObj.phonetic}</span>` : ''}
          <button class="star-btn ${starred ? 'on' : ''}" data-action="toggle-favorite"
                  data-type="word" data-key="${wordObj.word}"
                  aria-label="${starred ? '取消收藏' : '收藏'}">${starred ? STAR_FILLED : STAR_OUTLINE}</button>
        </div>
        <div class="word-bar">
          <button class="icon-btn speak-btn" data-action="speak" data-word="${wordObj.word}" aria-label="朗读">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4V5z"></path>
              <path class="wave w1" d="M15.5 8.5a5 5 0 0 1 0 7"></path>
              <path class="wave w2" d="M19 5a9 9 0 0 1 0 14"></path>
            </svg>
          </button>
        </div>
        <div class="translation">${formatTranslation(wordObj.translation)}</div>
      </div>
      ${canEdit ? `
      <button class="icon-btn danger trash-outside" data-action="remove-word" data-word="${wordObj.word}" aria-label="移除">
        ${TRASH_SVG}
      </button>` : ''}
      ${extraBtn}
    </div>`;
}

// 释义格式化：ECDICT 原始数据用字面 "\n" 分隔不同词性的释义，
// 直接显示会看到反斜杠，这里换成真正的换行。
function formatTranslation(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\n/g, '<br>')
    .replace(/\n/g, '<br>');
}

// ============================================================
// 收藏（单词 / 俗语 / 同义词组 共用一套）
// ============================================================
// favoriteSet 里存 "类型:标识"，例如 word:abandon / idiom:idiom-123 / synset:syn-manual-1
function favKey(type, key) {
  return String(type || 'word') + ':' + String(key);
}

// 是否已收藏
function isFav(type, key) {
  return favoriteSet.has(favKey(type, key));
}

// 把收藏读进内存（启动时一次，之后靠 favoriteSet 判断星标）
async function loadFavorites() {
  const list = await getAllFavorites();
  favoriteSet = new Set(list.map(f => favKey(f.type || 'word', f.word)));
}

// 点星标：收藏 / 取消收藏
async function toggleFavorite(type, key) {
  if (!key) return;
  const k = favKey(type, key);
  const turnOn = !favoriteSet.has(k);

  if (turnOn) {
    favoriteSet.add(k);
    await addFavorite(key, type);
  } else {
    favoriteSet.delete(k);
    await deleteFavorite(key);
  }

  // 页面上所有同类型同标识的星标和卡片一起变（同一个词可能出现在多处）
  document.querySelectorAll('.star-btn').forEach(btn => {
    if (btn.dataset.type === (type || 'word') && btn.dataset.key === key) {
      paintStar(btn, turnOn);
      const card = btn.closest('.word-card, .idiom-card, .syn-card');
      if (card) card.classList.toggle('fav', turnOn);
    }
  });

  // 正在某一类收藏列表里取消收藏 → 立刻刷新列表
  if (!turnOn && currentPage === 'settings' && settingsView.startsWith('fav-')) {
    await renderFavList(document.getElementById('page-settings'), settingsView.slice(4));
  }
}

// ============================================================
// 个人资料（头像 + 用户名）
// ============================================================
const DEFAULT_PROFILE = { name: '学习者', avatar: '🐣' };
const AVATAR_PRESETS = ['🐣', '📚', '🎧', '🚀', '🌙', '⭐'];

// 草稿：编辑抽屉里正在改的资料
let profileDraft = null;

async function getProfile() {
  const s = await getSettings();
  const p = s && s.profile;
  return {
    name: (p && p.name) || DEFAULT_PROFILE.name,
    avatar: (p && p.avatar) || DEFAULT_PROFILE.avatar,
  };
}

// 头像可以是 emoji，也可以是上传的图片（data:image/...）
function renderAvatarHTML(avatar) {
  if (avatar && String(avatar).startsWith('data:image')) {
    return `<img src="${avatar}" alt="头像">`;
  }
  return `<span>${esc(avatar || DEFAULT_PROFILE.avatar)}</span>`;
}

// 抽屉的两种状态：'edit' 选头像改名字 / 'crop' 拖动图片选显示区域
let profileMode = 'edit';
let cropState = null;   // { img, baseW, baseH, zoom, dx, dy, stage, box }

async function openProfileEditor() {
  if (document.getElementById('profile-editor')) return;
  const p = await getProfile();
  profileDraft = { name: p.name, avatar: p.avatar };
  profileMode = 'edit';
  cropState = null;

  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.id = 'profile-editor';
  mask.innerHTML = `
    <div class="sheet" id="profile-editor-panel">
      <div class="sheet-head">
        <span id="profile-head-title">我的资料</span>
        <button class="sheet-close" data-action="close-profile-editor">关闭</button>
      </div>
      <div id="profile-body"></div>
    </div>`;
  document.body.appendChild(mask);

  renderProfileBody();
}

function closeProfileEditor() {
  dismissSheet(document.getElementById('profile-editor'));
  profileDraft = null;
  cropState = null;
  profileMode = 'edit';
}

// 按当前状态渲染抽屉内容
function renderProfileBody() {
  const body = document.getElementById('profile-body');
  if (!body) return;

  if (profileMode === 'crop' && cropState) {
    body.innerHTML = `
      <div class="crop-stage" id="crop-stage">
        <img id="crop-img" alt="">
        <div class="crop-box"></div>
      </div>
      <p class="text-muted text-sm mb-sm">拖动图片，选你想显示的那一块</p>
      <input type="range" class="crop-zoom" id="crop-zoom" min="1" max="3" step="0.01" value="${cropState.zoom}">
      <div class="flex gap-sm mt-sm">
        <button class="btn btn-secondary" style="flex:1" data-action="cancel-crop">重选</button>
        <button class="btn btn-primary" style="flex:1" data-action="confirm-crop">用这张</button>
      </div>`;
    mountCropper();
    return;
  }

  body.innerHTML = `
    <div class="profile-preview" id="profile-preview">
      <span class="avatar avatar-lg">${renderAvatarHTML(profileDraft.avatar)}</span>
    </div>

    <input class="input mb-sm" id="profile-name" maxlength="16"
           placeholder="给自己起个名字" value="${esc(profileDraft.name)}">

    <div class="avatar-grid" id="avatar-grid"></div>

    <button class="btn btn-primary btn-block mt-sm" data-action="save-profile">保存</button>`;

  renderAvatarGrid();
  bindAvatarFile();

}

// 预设头像 + 上传按钮
function renderAvatarGrid() {
  const grid = document.getElementById('avatar-grid');
  if (!grid || !profileDraft) return;

  const isPreset = AVATAR_PRESETS.includes(profileDraft.avatar);
  grid.innerHTML = `
    ${AVATAR_PRESETS.map(a => `
      <button class="avatar-opt ${profileDraft.avatar === a ? 'on' : ''}"
              data-action="pick-avatar" data-avatar="${a}">${a}</button>`).join('')}
    <label class="avatar-upload">
      ${isPreset ? '上传' : '换图'}
      <input type="file" id="avatar-file" accept="image/*" hidden>
    </label>`;
}

async function pickAvatar(avatar) {
  if (!profileDraft) return;
  profileDraft.avatar = avatar;
  renderProfileBody();
}

function bindAvatarFile() {
  const file = document.getElementById('avatar-file');
  if (!file || file.dataset.bound) return;
  file.dataset.bound = '1';
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    startCrop(f);
  });
}

// 选好图片 → 进入裁剪状态
function startCrop(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      profileMode = 'crop';
      cropState = {
        img,
        baseW: 0,
        baseH: 0,
        zoom: 1,
        dx: 0,
        dy: 0,
        stage: 0,
        box: 0,
      };
      renderProfileBody();
    };
    img.onerror = () => alert('这张图片读不出来，换一张试试');
    img.src = reader.result;
  };
  reader.onerror = () => alert('这张图片读不出来，换一张试试');
  reader.readAsDataURL(file);
}

// 把裁剪界面挂起来：算尺寸、绑拖动和缩放
function mountCropper() {
  const stage = document.getElementById('crop-stage');
  const imgEl = document.getElementById('crop-img');
  const zoomEl = document.getElementById('crop-zoom');
  if (!stage || !imgEl || !cropState) return;

  const st = cropState;
  st.stage = stage.clientWidth || 260;
  st.box = Math.round(st.stage * 0.7);

  // 取景框尺寸跟 JS 算的一致（CSS 只负责位置和样式）
  const boxEl = stage.querySelector('.crop-box');
  if (boxEl) {
    boxEl.style.width = st.box + 'px';
    boxEl.style.height = st.box + 'px';
  }

  // 图片先按「铺满正方形」算基础尺寸
  const cover = Math.max(st.stage / st.img.naturalWidth, st.stage / st.img.naturalHeight);
  st.baseW = st.img.naturalWidth * cover;
  st.baseH = st.img.naturalHeight * cover;

  imgEl.src = st.img.src;
  applyCropTransform();

  if (zoomEl) {
    zoomEl.addEventListener('input', () => {
      st.zoom = parseFloat(zoomEl.value) || 1;
      applyCropTransform();
    });
  }

  // 拖动图片（手指或鼠标）
  let startX = 0, startY = 0, baseDx = 0, baseDy = 0, dragging = false;

  const point = (e) => (e.touches && e.touches[0]) ? e.touches[0] : e;

  const down = (e) => {
    const p = point(e);
    startX = p.clientX; startY = p.clientY;
    baseDx = st.dx; baseDy = st.dy;
    dragging = true;
  };

  const move = (e) => {
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();     // 拖图片时页面别跟着滚
    const p = point(e);
    st.dx = baseDx + (p.clientX - startX);
    st.dy = baseDy + (p.clientY - startY);
    applyCropTransform();
  };

  const up = () => { dragging = false; };

  stage.addEventListener('touchstart', down, { passive: true });
  stage.addEventListener('touchmove', move, { passive: false });
  stage.addEventListener('touchend', up);
  stage.addEventListener('mousedown', down);
  stage.addEventListener('mousemove', move);
  stage.addEventListener('mouseup', up);
  stage.addEventListener('mouseleave', up);
}

// 按当前缩放和位移更新图片位置（并把它限制在选框范围内）
function applyCropTransform() {
  const st = cropState;
  if (!st) return;
  const imgEl = document.getElementById('crop-img');
  if (!imgEl) return;

  const dispW = st.baseW * st.zoom;
  const dispH = st.baseH * st.zoom;

  // 图片必须盖住选框：可移动的最大距离
  const maxDx = Math.max(0, (dispW - st.box) / 2);
  const maxDy = Math.max(0, (dispH - st.box) / 2);
  st.dx = Math.min(maxDx, Math.max(-maxDx, st.dx));
  st.dy = Math.min(maxDy, Math.max(-maxDy, st.dy));

  imgEl.style.width = dispW + 'px';
  imgEl.style.height = dispH + 'px';
  imgEl.style.transform = `translate(calc(-50% + ${st.dx}px), calc(-50% + ${st.dy}px))`;
}

function cancelCrop() {
  profileMode = 'edit';
  cropState = null;
  renderProfileBody();
}

// 按选框区域把图片裁成 200×200 存下来
function confirmCrop() {
  const st = cropState;
  if (!st) return;

  const dispW = st.baseW * st.zoom;
  const dispH = st.baseH * st.zoom;
  const scale = dispW / st.img.naturalWidth;      // 显示像素 / 原图像素

  const imgLeft = st.stage / 2 + st.dx - dispW / 2;
  const imgTop = st.stage / 2 + st.dy - dispH / 2;
  const boxLeft = st.stage / 2 - st.box / 2;
  const boxTop = st.stage / 2 - st.box / 2;

  const sx = (boxLeft - imgLeft) / scale;
  const sy = (boxTop - imgTop) / scale;
  const sw = st.box / scale;

  const size = 200;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(st.img, sx, sy, sw, sw, 0, 0, size, size);

  profileDraft.avatar = canvas.toDataURL('image/jpeg', 0.85);
  profileMode = 'edit';
  cropState = null;
  renderProfileBody();
}

async function saveProfileEditor() {
  if (!profileDraft) return;
  const nameInput = document.getElementById('profile-name');
  const name = (nameInput && nameInput.value.trim()) || DEFAULT_PROFILE.name;

  const s = (await getSettings()) || { key: 'app' };
  await setSettings({ ...s, profile: { name, avatar: profileDraft.avatar } });

  closeProfileEditor();
  if (currentPage === 'settings') {
    await renderSettings(document.getElementById('page-settings'));
  }
}

// 「我的」页内部换屏时，新内容淡入一次（页面本身不重建，所以要手动播动画）
async function renderSettingsWithEnter() {
  const el = document.getElementById('page-settings');
  await renderSettings(el);
  playEnter(el);
}

// 从「我的」进入收藏菜单（三个模块）
async function openFavorites() {
  settingsView = 'favMenu';
  document.getElementById('page-title').textContent = '收藏';
  await renderSettingsWithEnter();
}

// 从收藏菜单进入某一类的列表
async function openFavList(type) {
  if (!FAV_TITLES[type]) return;
  settingsView = 'fav-' + type;
  document.getElementById('page-title').textContent = FAV_TITLES[type];
  await renderSettingsWithEnter();
}

// 从具体列表返回收藏菜单
async function backToFavMenu() {
  settingsView = 'favMenu';
  document.getElementById('page-title').textContent = '收藏';
  await renderSettingsWithEnter();
}

// 从收藏菜单返回「我的」
async function closeFavorites() {
  settingsView = 'main';
  document.getElementById('page-title').textContent = PAGES.settings.title;
  await renderSettingsWithEnter();
}

// ============================================================
// 输入框：横向滑动一下 = 选中框里全部文字
// ============================================================
// 手机上一个字一个字挪光标很费劲，输入框里其实只想"全选后重输"。
//
// 不用逐个输入框绑定 —— 直接在 document 上做事件委托，
// 以后任何新加的输入框都自动支持，不用再记得调一次。
//
// 关键：判定成"框选手势"之后，要把默认行为挡掉（preventDefault），
// 否则横向滑动会牵连后面整页跟着滚。纵向滑动不挡，页面照常滚。
function setupSlideSelect() {
  let target = null;       // 当前手指按住的输入框
  let startX = 0, startY = 0, sliding = false;

  const point = (e) => (e.touches && e.touches[0]) ? e.touches[0] : e;

  // 找出被按住的那个输入框（file / range / checkbox 这类不算）
  const pickInput = (node) => {
    const el = node && node.closest ? node.closest('input, textarea') : null;
    if (!el) return null;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    const skip = ['file', 'checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color'];
    return skip.includes(type) ? null : el;
  };

  document.addEventListener('touchstart', (e) => {
    target = pickInput(e.target);
    if (!target) return;
    const p = point(e);
    startX = p.clientX;
    startY = p.clientY;
    sliding = false;
  }, { passive: true });

  // 需要能 preventDefault，所以 passive 必须是 false
  document.addEventListener('touchmove', (e) => {
    if (!target) return;
    const p = point(e);
    const dx = Math.abs(p.clientX - startX);
    const dy = Math.abs(p.clientY - startY);

    if (!sliding && dx > 8 && dx > dy) sliding = true;   // 横向为主才算框选

    if (sliding && e.cancelable) {
      e.preventDefault();          // 页面/背景不再跟着滑
    }
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (target && sliding) selectAllText(target);
    target = null;
    sliding = false;
  });
}

// 让元素重播一次「进入」动画（先移除 class、强制重排，再加回去）
function playEnter(el, cls = 'view-enter') {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// 选中输入框里的全部文字（并保持键盘不收起）
function selectAllText(input) {
  const len = (input.value || '').length;
  if (!len) return;

  const doSelect = () => {
    try { input.setSelectionRange(0, len); } catch (e) { /* 忽略不支持的浏览器 */ }
  };

  try {
    input.focus({ preventScroll: true });
    doSelect();
    // iOS Safari 有时 focus 之后会把选区重置，补一次
    setTimeout(doSelect, 0);
  } catch (e) { /* 忽略 */ }
}

// 移除一个词
async function removeTodayWord(word) {
  const today = getTodayStr();
  const daily = await getDaily(today);
  if (!daily) return;
  if (daily.confirmed) { alert('今天已经「确定」过了，不能再改'); return; }

  daily.wordList = daily.wordList.filter(w => w !== word);
  daily.source = 'manual';
  await setDaily(daily);
  await switchPage('today');
}

// 清除某个词在「已学」里的记录（从那一天的单词表里去掉）
// 已确认的日子也允许清 —— 这就是"清除记录"的意思
async function removeLearnedWord(date, word) {
  if (!date || !word) return;
  const daily = await getDaily(date);
  if (!daily) return;

  daily.wordList = (daily.wordList || []).filter(w => w !== word);
  await setDaily(daily);

  // 重绘已学页（展开的日期会保持展开，因为 openDates 记着）
  if (currentPage === 'library') await renderLibContent();
}

// 删除某一天的整份单词组
// 如果删的是今天 → 变回「草稿」状态放回今日页，可以重新编辑、重新确定
async function removeDailyGroup(date) {
  if (!date) return;
  const today = getTodayStr();
  const isToday = date === today;

  const tip = isToday
    ? '删除今天的单词组？\n删完会回到「今日」页，可以重新编辑再点确定。'
    : `删除 ${date} 这一天的单词组？`;
  if (!confirm(tip)) return;

  const old = await getDaily(date);       // 先留住原来的词表
  await deleteDaily(date);
  openDates.delete(date);

  if (isToday) {
    const words = (old && old.wordList) ? [...old.wordList] : [];
    if (words.length > 0) {
      // 原样放回，但去掉 confirmed —— 回到可编辑的草稿状态
      await setDaily({ date, wordList: words, source: 'auto' });
    } else {
      const settings = await getSettings();
      const list = await pickDaily(date, resolveLevel(settings));
      await setDaily({ date, wordList: list, source: 'auto' });
    }
    const queue = await getTodayQueue(today);
    await updateBadge(queue.all.length);
    await switchPage('today');
  } else if (currentPage === 'library') {
    await renderLibContent();
  }
}

// ============================================================
// 确定今日单词
//   点完就把今天这份词锁定：不再显示加号框和垃圾桶。
//   数量随意 —— 不足 10 个、超过 10 个都可以。
// ============================================================
async function confirmToday() {
  const today = getTodayStr();
  const daily = await getDaily(today);
  if (!daily) return;

  const count = daily.wordList.length;
  if (count === 0) {
    alert('今天还没有单词，先点加号加几个吧');
    return;
  }

  daily.confirmed = true;
  daily.confirmedAt = new Date().toISOString();
  await setDaily(daily);

  // 角标 = 今日待学数量
  const queue = await getTodayQueue(today);
  await updateBadge(queue.all.length);

  await switchPage('today');
}

// ============================================================
// 加词弹层：搜索整个词库 → 点一行就加进今天
// ============================================================
async function openAddSheet() {
  // 已经存在就不重复创建
  if (document.getElementById('add-sheet')) return;

  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.id = 'add-sheet';
  mask.innerHTML = `
    <div class="sheet" id="add-sheet-panel">
      <div class="sheet-head">
        <span>添加单词</span>
        <button class="sheet-close" data-action="close-add-sheet">关闭</button>
      </div>
      <input class="input" id="add-search" placeholder="输入英文或中文搜索…" autocomplete="off" autocapitalize="off">
      <div class="sheet-body" id="add-results"></div>
    </div>`;
  document.body.appendChild(mask);

  const input = document.getElementById('add-search');
  input.addEventListener('input', () => renderAddResults(input.value));

  await renderAddResults('');
  input.focus();
}

// 点遮罩空白处关闭。
// 注意：必须判断「点到的就是遮罩本身」（e.target === mask），
// 页面上任何内部元素（包括抽屉里没有 data-action 的地方）都不能触发关闭 ——
// 手机上手指滑动、键盘弹出导致布局变化时，用 closest 判断很容易误关。
function onMaskClick(e) {
  const mask = e.target.closest('.sheet-mask');
  if (!mask || e.target !== mask) return;

  if (mask.id === 'syn-editor') closeSynEditor();
  else if (mask.id === 'profile-editor') closeProfileEditor();
  else if (mask.id === 'idiom-editor') closeIdiomEditor();
  else closeAddSheet();
}

// 让抽屉带「往下滑 + 淡出」动画地关掉：
//   先把 id 摘掉（这样同一时刻还能重新打开新的），加 .closing 播动画，220ms 后真正移除
function dismissSheet(mask) {
  if (!mask) return;
  mask.id = '';
  mask.classList.add('closing');
  setTimeout(() => mask.remove(), 220);
}

function closeAddSheet() {
  dismissSheet(document.getElementById('add-sheet'));
}

// 渲染搜索结果（已在本日列表里的显示"已添加"）
async function renderAddResults(query) {
  const box = document.getElementById('add-results');
  if (!box) return;

  const q = (query || '').trim();
  // 没输入关键词时不列词（否则会列出 AIDS / AM 这种按字母排序的怪结果）
  if (!q) {
    box.innerHTML = '<div class="empty-state" style="padding:24px 0"><p class="empty-hint">输入英文或中文开始搜索</p></div>';
    return;
  }

  const results = await searchWords(q, 40);
  const daily = await getDaily(getTodayStr());
  const inToday = new Set(daily ? daily.wordList : []);

  if (results.length === 0) {
    box.innerHTML = '<div class="empty-state" style="padding:24px 0"><p class="empty-hint">没有匹配的词</p></div>';
    return;
  }

  box.innerHTML = results.map(w => {
    const added = inToday.has(w.word);
    return `
      <button class="pick-row" ${added ? 'disabled' : `data-action="pick-add-word" data-word="${w.word}"`}>
        <span class="pick-main">
          <span class="pick-word">${w.word}${w.phonetic ? `<span class="phonetic-pill">${w.phonetic}</span>` : ''}</span>
          <span class="pick-trans">${formatTranslation(w.translation).replace(/<br>/g, ' ')}</span>
        </span>
        <span class="pick-add ${added ? 'disabled' : ''}">${added ? '已添加' : '＋ 添加'}</span>
      </button>`;
  }).join('');
}

// 把选中的词加进今天的列表
async function pickAddWord(word) {
  const today = getTodayStr();
  const daily = await getDaily(today);
  if (!daily) return;
  if (daily.confirmed) { alert('今天已经「确定」过了，不能再改'); closeAddSheet(); return; }
  if (daily.wordList.includes(word)) return;

  daily.wordList.push(word);
  daily.source = 'manual';
  await setDaily(daily);

  // 刷新弹层里的"已添加"状态（弹层不关，方便连续加几个）
  const input = document.getElementById('add-search');
  await renderAddResults(input ? input.value : '');

  // 同时刷新背后的今日页
  const queue = await getTodayQueue(today);
  await updateBadge(queue.all.length);
  await renderToday(document.getElementById('page-today'));
}

// ============================================================
// 已学页（学过的单词按日期汇总 / 俗语 / 同义词本）
// ============================================================
let libTab = 'words';

async function renderLibrary(container) {
  // 注意：btn-primary 和 btn-secondary 只能二选一。
  // 两个类同时挂上时，CSS 里后定义的 btn-secondary 会盖掉蓝色高亮。
  const tabClass = t => `btn ${libTab === t ? 'btn-primary' : 'btn-secondary'} lib-tab-btn`;
  container.innerHTML = `
    <div class="flex gap-sm mb-sm">
      <button class="${tabClass('words')}" data-action="lib-tab" data-tab="words">单词</button>
      <button class="${tabClass('idioms')}" data-action="lib-tab" data-tab="idioms">俗语</button>
      <button class="${tabClass('synonyms')}" data-action="lib-tab" data-tab="synonyms">同义词</button>
    </div>
    <div id="lib-content"></div>
  `;
  await renderLibContent();
}

async function switchLibTab(tab) {
  libTab = tab;
  // 切换子标签时重画顶部按钮的高亮
  document.querySelectorAll('.lib-tab-btn').forEach(b => {
    b.classList.toggle('btn-primary', b.dataset.tab === tab);
    b.classList.toggle('btn-secondary', b.dataset.tab !== tab);
  });
  await renderLibContent();
}

async function renderLibContent() {
  const el = document.getElementById('lib-content');
  if (!el) return;

  if (libTab === 'words') {
    el.innerHTML = await renderLearnedWords();
  } else if (libTab === 'idioms') {
    el.innerHTML = `
      <button class="btn btn-primary btn-block mb-sm" data-action="open-idiom-editor">＋ 新建俗语</button>
      <div id="idiom-list"></div>
    `;

    await renderIdiomList();

  } else if (libTab === 'synonyms') {
    // 界面不再分"我整理的 / 自动整理"，所有组都用同一种卡片列出：
    //   有组名的 = 自己建的（带编辑按钮 + 右侧垃圾桶）
    //   只有词的   = 从学过的词自动归出来的（只读）
    const [manual, auto] = await Promise.all([getManualSynsets(), getMySynonyms()]);
    const SHOW = 60;
    const shownAuto = auto.slice(0, SHOW);

    const manualCards = manual.map(s => synCardHTML(s)).join('');

    const autoCards = shownAuto.map(s => `
      <div class="word-row">
        <div class="card syn-card">
          <div class="flex gap-sm" style="flex-wrap:wrap">
            ${s.learnedWords.map(w => `<span class="tag">${esc(w)}</span>`).join('')}
          </div>
          ${s.note ? `<p class="text-muted text-sm mt-sm" style="white-space:pre-line">${filterSynNote(s.note, s.learnedWords)}</p>` : ''}
        </div>
      </div>`).join('');

    const hasAny = manual.length > 0 || auto.length > 0;

    el.innerHTML = `
      <button class="btn btn-primary btn-block mb-sm" data-action="open-syn-editor">＋ 新建同义词组</button>
      ${hasAny ? manualCards + autoCards : `
        <div class="empty-state">
          <div class="empty-icon">同</div>
          <p class="empty-text">还没有同义词组</p>
          <p class="empty-hint">点上面新建，或者等学过 2 个以上同义的词后自动出现</p>
        </div>`}
      ${auto.length > SHOW ? `<p class="text-muted text-sm mt-sm">同类词组较多，先显示前 ${SHOW} 组</p>` : ''}
    `;
  }
}

// 把用户输入的文字转义，避免引号破坏 HTML
function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// 同义词组编辑器（底部抽屉）
//   id 为空 = 新建；有 id = 编辑已有组
// ============================================================
let synEditor = null;   // { id, title, words }

// 草稿：存在 settings.synDraft 里，只用于回填编辑器，不会变成同义词组
async function saveSynDraft(ed) {
  const s = (await getSettings()) || { key: 'app' };
  await setSettings({ ...s, synDraft: { id: ed.id, title: ed.title, words: ed.words } });
}

async function readSynDraft() {
  const s = await getSettings();
  return (s && s.synDraft) || null;
}

async function clearSynDraft() {
  const s = (await getSettings()) || { key: 'app' };
  if (!s.synDraft) return;
  await setSettings({ ...s, synDraft: null });
}

async function openSynEditor(id) {
  if (document.getElementById('syn-editor')) return;

  let title = '';
  let words = [];
  if (id) {
    const manual = await getManualSynsets();
    const found = manual.find(s => s.id === id);
    if (!found) return;
    title = found.title || '';
    words = [...(found.words || [])];
  }

  // 有未保存的草稿就回填到输入框里（新建时任何草稿都算；编辑时只认同一条目）
  const draft = await readSynDraft();
  let draftId = null;
  if (draft && (id ? draft.id === id : true)) {
    title = draft.title || title;
    words = [...(draft.words || [])];
    draftId = draft.id;
  }

  synEditor = {
    id: id || draftId || ('syn-manual-' + Date.now() + '-' + Math.floor(Math.random() * 10000)),
    title,
    words,
    origTitle: title,        // 打开时的样子，用来判断"有没有改过"
    origWords: [...words],
    isNew: !id,
  };

  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.id = 'syn-editor';
  mask.innerHTML = `
    <div class="sheet" id="syn-editor-panel">
      <div class="sheet-head">
        <span>${id ? '编辑同义词组' : '新建同义词组'}</span>
        <button class="sheet-close" data-action="close-syn-editor">关闭</button>
      </div>
      <input class="input mb-sm" id="syn-title" placeholder="组名（可选，如：表示「大」的词）" value="${esc(title)}">
      <div class="syn-selected" id="syn-selected"></div>
      <input class="input mb-sm" id="syn-search" placeholder="搜索单词加入这一组…" autocomplete="off" autocapitalize="off">
      <div class="sheet-body" id="syn-results"></div>
      <button class="btn btn-primary btn-block mt-sm" data-action="save-synset">保存这一组</button>
    </div>`;
  document.body.appendChild(mask);

  const input = document.getElementById('syn-search');
  input.addEventListener('input', () => renderSynResults(input.value));

  renderSynSelected();
  await renderSynResults('');
  input.focus();
}

// 关闭编辑器。
// 只要里面有内容、而且和打开时不一样，就把内容**存成草稿**（不生成同义词组），
// 下次打开编辑器会自动回填到输入框里。
// 点「保存这一组」成功后再关，传 skipSave=true，避免又写一次草稿。
async function closeSynEditor(skipSave) {
  const ed = synEditor;
  if (!ed) {
    dismissSheet(document.getElementById('syn-editor'));
    return;
  }

  // DOM 拆掉之前先把组名读出来
  const titleInput = document.getElementById('syn-title');
  if (titleInput) ed.title = titleInput.value.trim();

  const hasContent = ed.words.length > 0 || ed.title;
  const changed = ed.title !== ed.origTitle ||
    ed.words.join('\u0001') !== ed.origWords.join('\u0001');

  dismissSheet(document.getElementById('syn-editor'));
  synEditor = null;

  if (skipSave || !hasContent || !changed) return;

  // 只存草稿，不进同义词列表
  await saveSynDraft(ed);
}

// 已选词：点一下就把这个词从组里去掉
function renderSynSelected() {
  const box = document.getElementById('syn-selected');
  if (!box || !synEditor) return;
  box.innerHTML = synEditor.words.length
    ? `<p class="text-muted text-sm mb-sm">这一组的词（点一下可移除）：</p>
       <div class="flex gap-sm" style="flex-wrap:wrap">
         ${synEditor.words.map(w => `
           <button class="syn-chip editable" data-action="syn-drop-word" data-word="${esc(w)}">${esc(w)} ×</button>
         `).join('')}
       </div>`
    : '<p class="text-muted text-sm mb-sm">还没有词，从下面搜索加入（一组至少 2 个）</p>';
}

// 搜索整个词库，点一行加入当前组
async function renderSynResults(query) {
  const box = document.getElementById('syn-results');
  if (!box || !synEditor) return;
  const q = (query || '').trim();
  if (!q) {
    box.innerHTML = '<div class="empty-state" style="padding:20px 0"><p class="empty-hint">输入英文或中文开始搜索</p></div>';
    return;
  }

  const results = await searchWords(q, 30);
  if (results.length === 0) {
    box.innerHTML = '<div class="empty-state" style="padding:20px 0"><p class="empty-hint">没有匹配的词</p></div>';
    return;
  }

  box.innerHTML = results.map(w => {
    const added = synEditor.words.includes(w.word);
    return `
      <button class="pick-row" ${added ? 'disabled' : `data-action="syn-pick-word" data-word="${esc(w.word)}"`}>
        <span class="pick-main">
          <span class="pick-word">${esc(w.word)}${w.phonetic ? `<span class="phonetic-pill">${esc(w.phonetic)}</span>` : ''}</span>
          <span class="pick-trans">${esc(String(w.translation || '').replace(/\\n/g, ' ')).slice(0, 60)}</span>
        </span>
        <span class="pick-add ${added ? 'disabled' : ''}">${added ? '已在组里' : '＋ 加入'}</span>
      </button>`;
  }).join('');
}

// 点搜索结果里的「＋ 加入」：加进组，并把搜索框清空，方便接着搜下一个
function synPickWord(word) {
  if (!synEditor || synEditor.words.includes(word)) return;
  synEditor.words.push(word);
  renderSynSelected();

  const input = document.getElementById('syn-search');
  if (input) {
    input.value = '';
    input.focus();
  }
  renderSynResults('');
}

function synDropWord(word) {
  if (!synEditor) return;
  synEditor.words = synEditor.words.filter(w => w !== word);
  renderSynSelected();
  const input = document.getElementById('syn-search');
  renderSynResults(input ? input.value : '');
}

async function saveSynEditor() {
  if (!synEditor) return;
  const titleInput = document.getElementById('syn-title');
  synEditor.title = titleInput ? titleInput.value.trim() : '';

  if (synEditor.words.length < 2) {
    alert('一组至少放 2 个词，才有"同义"的意思');
    return;
  }
  await saveSynset(synEditor.id, synEditor.title, synEditor.words);
  await closeSynEditor(true);      // 已经写过了，关闭时别再写一遍
  await clearSynDraft();           // 正式保存了，草稿作废
  await renderLibContent();
}

async function deleteSynGroup(id) {
  if (!id) return;
  if (!confirm('删除这一组同义词？')) return;
  await removeSynset(id);
  await clearSynDraft();
  await renderLibContent();
}

// 辨析说明里每条是「- word: 说明」的格式。
// 因为只展示已学过的词，这里把没学过的词的条目也去掉，保持一致。
function filterSynNote(note, learnedWords) {
  if (!note) return '';
  const learned = learnedWords.map(w => w.toLowerCase());
  const kept = [];
  for (const line of String(note).split('\n')) {
    const m = line.match(/^\s*-\s*([A-Za-z][A-Za-z'’\-\s]*?)\s*[:：]/);
    if (m) {
      const w = m[1].trim().toLowerCase();
      if (w && !learned.includes(w)) continue;   // 没学过的词，跳过它的说明
    }
    kept.push(line);
  }
  return kept.join('\n');
}

// 已学的单词：按日期分组，日期是按钮，点开才显示当天单词（默认都收起）
let openDates = new Set();

async function renderLearnedWords() {
  const today = getTodayStr();
  const allDaily = await getAllDaily();
  // 只显示点过「确定」的日期（过去的日子默认算已学，见 db.js 的 isLearnedDaily）
  const days = allDaily.filter(d =>
    (d.wordList || []).length > 0 && isLearnedDaily(d, today)
  );

  if (days.length === 0) {
    const todayDaily = await getDaily(today);
    const draftCount = (todayDaily && !todayDaily.confirmed)
      ? (todayDaily.wordList || []).length : 0;
    return `
      <div class="empty-state">
        <div class="empty-icon">学</div>
        <p class="empty-text">还没有学过的词</p>
        <p class="empty-hint">${draftCount ? `今天有 ${draftCount} 个词待确定，` : ''}去「今日」页点右上角「确定」后，这一天的词才会记到这里</p>
      </div>`;
  }

  // 总词数（所有日期去重，不只是最近 30 天）
  const allSet = new Set();
  days.forEach(d => d.wordList.forEach(w => allSet.add(w)));

  const SHOW_DAYS = 30;
  const shown = days.slice(0, SHOW_DAYS);

  // 一次性把所有需要的词条取出来
  const needed = [...new Set(shown.flatMap(d => d.wordList))];
  const map = new Map();
  await Promise.all(needed.map(async w => {
    const obj = await getWord(w);
    if (obj) map.set(w, obj);
  }));

  const groups = shown.map(d => {
    const open = openDates.has(d.date);
    const cards = d.wordList
      .map(w => map.get(w))
      .filter(Boolean)
      .map(obj => renderWordCard(obj, `
        <button class="icon-btn danger trash-outside" data-action="remove-learned-word"
                data-date="${d.date}" data-word="${esc(obj.word)}" aria-label="清除这条学习记录">
          ${TRASH_SVG}
        </button>`))
      .join('');
    return `
      <div class="date-row">
        <button class="date-head ${open ? 'open' : ''}" data-action="toggle-date" data-date="${d.date}">
          <span class="date-left">
            <svg class="date-chev" width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 6l6 6-6 6"></path>
            </svg>
            <span class="date-text">${d.date}</span>
          </span>
          <span class="date-count">${d.wordList.length} 词</span>
        </button>
        <button class="icon-btn danger trash-outside" data-action="remove-daily-group"
                data-date="${d.date}" aria-label="删除这一天的单词组">
          ${TRASH_SVG}
        </button>
      </div>
      <div class="date-body ${open ? 'open' : ''}" data-body="${d.date}">${cards}</div>`;
  }).join('');

  // 今天还没点「确定」时，给一行明确的提示，避免"今天怎么没出现"的困惑
  const todayDaily = await getDaily(today);
  const draftHint = (todayDaily && !todayDaily.confirmed && (todayDaily.wordList || []).length > 0)
    ? `<p class="text-muted text-sm mb-sm" style="color:var(--color-primary)">
        今天还有 ${todayDaily.wordList.length} 个词没点「确定」，暂时不计入已学
      </p>`
    : '';

  return `
    <p class="text-muted text-sm mb-sm">共学过 ${allSet.size} 个词${days.length > SHOW_DAYS ? ` · 显示最近 ${SHOW_DAYS} 天` : ''} · 点日期展开当天单词</p>
    ${draftHint}
    ${groups}`;
}

// 点日期：展开 / 收起当天单词
function toggleDateGroup(el) {
  const date = el.dataset.date;
  const body = document.querySelector(`.date-body[data-body="${date}"]`);
  if (!body) return;
  const open = body.classList.toggle('open');
  el.classList.toggle('open', open);
  if (open) openDates.add(date); else openDates.delete(date);
}

// ============================================================
// 词典页（搜索整个词库，纯查询，不影响学习记录）
// ============================================================
async function renderDict(container) {
  const all = await getAllWords();

  const idleHint = `<div class="empty-state"><div class="empty-icon">典</div><p class="empty-text">查一下单词</p><p class="empty-hint">输入英文或中文，比如 abandon / 放弃</p></div>`;

  container.innerHTML = `
    <input class="input mb-sm" id="dict-search" placeholder="搜索单词或中文释义…" autocomplete="off">
    <p class="text-muted text-sm mb-sm" id="dict-tip">词库共 ${all.length} 词 · 输入关键词查词</p>
    <div id="dict-list"></div>
  `;

  const input = document.getElementById('dict-search');
  const list = document.getElementById('dict-list');
  const tip = document.getElementById('dict-tip');

  let timer = null;
  let seq = 0;          // 用来丢弃过期的搜索结果

  const runSearch = async () => {
    const mySeq = ++seq;
    const q = input.value.trim();

    if (!q) {
      tip.textContent = `词库共 ${all.length} 词 · 输入关键词查词`;
      list.innerHTML = idleHint;
      playEnter(list);
      return;
    }

    const results = await searchWords(q, 40);
    if (mySeq !== seq) return;          // 期间又输入了新内容，这次结果作废

    tip.textContent = results.length
      ? `找到 ${results.length} 个匹配（最多显示 40 个）`
      : '没有匹配的词';
    list.innerHTML = results.length
      ? results.map(w => renderWordCard(w)).join('')
      : '<div class="empty-state"><p class="empty-hint">换个关键词试试</p></div>';
    playEnter(list);                    // 结果整体淡入一次
  };

  // 输入防抖：停手 160ms 再查，连续打字时结果不会一直闪
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 160);
  });

  // 初始不列词，先给个提示（避免一上来是 AIDS / AM 这种按字母排的怪结果）
  list.innerHTML = idleHint;
}

async function renderIdiomList() {
  const idioms = await getAllIdioms();
  const el = document.getElementById('idiom-list');
  if (!el) return;
  if (idioms.length === 0) {
    el.innerHTML = '<div class="empty-state"><p class="empty-hint">还没有俗语，添加一条试试</p></div>';
    return;
  }
  el.innerHTML = idioms.map(i => idiomCardHTML(i)).join('');
}

// ============================================================
// 俗语编辑器（底部抽屉，和同义词组一样的操作方式）
//   id 为空 = 新建；有 id = 编辑已有那条
// ============================================================
let idiomEditor = null;   // { id, text, meaning, example }

async function openIdiomEditor(id) {
  if (document.getElementById('idiom-editor')) return;

  let item = { text: '', meaning: '', example: '' };
  if (id) {
    const all = await getAllIdioms();
    const found = all.find(i => i.id === id);
    if (!found) return;
    item = found;
  }

  idiomEditor = {
    id: id || ('idiom-' + Date.now() + '-' + Math.floor(Math.random() * 1000)),
    text: item.text || '',
    meaning: item.meaning || '',
    example: item.example || '',
    createdAt: item.createdAt || getTodayStr(),   // 编辑时保留原来的创建日期
  };

  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.id = 'idiom-editor';
  mask.innerHTML = `
    <div class="sheet" id="idiom-editor-panel">
      <div class="sheet-head">
        <span>${id ? '编辑俗语' : '新建俗语'}</span>
        <button class="sheet-close" data-action="close-idiom-editor">关闭</button>
      </div>
      <input class="input mb-sm" id="ie-text" placeholder="俗语原文（如 A piece of cake）"
             value="${esc(idiomEditor.text)}" autocomplete="off">
      <input class="input mb-sm" id="ie-meaning" placeholder="中文释义（如 小菜一碟）"
             value="${esc(idiomEditor.meaning)}" autocomplete="off">
      <input class="input mb-sm" id="ie-example" placeholder="例句（可选）"
             value="${esc(idiomEditor.example)}" autocomplete="off">
      <button class="btn btn-primary btn-block mt-sm" data-action="save-idiom">保存</button>
    </div>`;
  document.body.appendChild(mask);

  document.getElementById('ie-text').focus();
}

function closeIdiomEditor() {
  dismissSheet(document.getElementById('idiom-editor'));
  idiomEditor = null;
}

async function saveIdiomEditor() {
  if (!idiomEditor) return;
  const text = (document.getElementById('ie-text')?.value || '').trim();
  const meaning = (document.getElementById('ie-meaning')?.value || '').trim();
  const example = (document.getElementById('ie-example')?.value || '').trim();

  if (!text || !meaning) {
    alert('俗语原文和释义都要填');
    return;
  }

  // put 既能新建也能覆盖（编辑时主键已存在，用 add 会报错）
  await updateIdiom({
    id: idiomEditor.id,
    text, meaning, example,
    createdAt: idiomEditor.createdAt || getTodayStr(),
  });

  closeIdiomEditor();
  await renderIdiomList();
}

async function delIdiom(id) {
  await deleteIdiom(id);
  await renderIdiomList();
}

// ============================================================
// 复习页（两个部分：今日单词复习 / 全部已学复习）
// ============================================================
async function renderReview(container) {
  // 考核进行中，继续渲染当前题
  if (quizState && !quizState.finished) {
    await renderCurrentQuiz(container);
    return;
  }

  const today = getTodayStr();
  const learnedSet = await getLearnedWordSet();
  const allCount = learnedSet.size;

  // 今日复习只算「点过确定」的那批词：没确定前它们还是草稿，不进复习
  const todayDaily = await getDaily(today);
  const todayCount = (todayDaily && todayDaily.confirmed)
    ? (todayDaily.wordList || []).length
    : 0;

  const idiomCount = (await getAllIdioms()).length;

  container.innerHTML = `
    <div class="card">
      <div class="card-title">今日单词复习</div>
      <p class="text-muted text-sm mb-sm">今天学了 ${todayCount} 个词</p>
      ${todayCount > 0
        ? `<button class="btn btn-primary btn-block" data-action="start-quiz" data-scope="today">开始复习</button>`
        : ''}
    </div>

    <div class="card">
      <div class="card-title">全部已学复习</div>
      <p class="text-muted text-sm mb-sm">总共学了 ${allCount} 个词</p>
      ${allCount > 0
        ? `<button class="btn btn-primary btn-block" data-action="start-quiz" data-scope="all">开始复习</button>`
        : ''}
    </div>

    <div class="card">
      <div class="card-title">俗语复习</div>
      <p class="text-muted text-sm mb-sm">总共 ${idiomCount} 条俗语</p>
      ${idiomCount > 0
        ? `<button class="btn btn-primary btn-block" data-action="start-quiz" data-scope="idiom">开始复习</button>`
        : ''}
    </div>
  `;
}

// 开始复习（scope：'today' 今日单词 / 'all' 全部已学 / 'idiom' 俗语）
async function startQuiz(scope = 'all') {
  let items = [];

  if (scope === 'idiom') {
    const idioms = await getAllIdioms();
    if (idioms.length === 0) {
      alert('还没有俗语，先去「已学 → 俗语」加几条');
      return;
    }
    // 和「全部已学复习」一样的出场方式：随机抽最多 REVIEW_QUIZ_COUNT 题
    items = shuffleTake(idioms, REVIEW_QUIZ_COUNT).map(i => ({
      word: i.text,
      phonetic: '',
      translation: i.meaning,
      isIdiom: true,
    }));
  } else {
    // 今日复习只认「点过确定」的词表
    if (scope === 'today') {
      const d = await getDaily(getTodayStr());
      if (!d || !d.confirmed) {
        alert('今天还没点「确定」。去「今日」页弄好单词后点右上角「确定」，再回来复习。');
        return;
      }
    }

    const words = await pickReviewWords(scope, REVIEW_QUIZ_COUNT);
    if (words.length === 0) {
      alert('还没有可以复习的词');
      return;
    }
    const objs = await Promise.all(words.map(w => getWord(w)));
    items = objs.filter(Boolean);
  }

  if (items.length === 0) return;

  quizState = {
    scope,
    items,
    current: 0,
    correct: 0,
    total: items.length,
    finished: false,
    results: [],          // 每题结果，最后用来出成绩单
    pendingResult: null,
    questions: {},        // 本轮每道题缓存下来（一轮内不乱变）
  };
  await renderCurrentQuiz(document.getElementById('page-review'));
}

// 从数组里随机取 n 个（不改原数组）
function shuffleTake(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// 渲染当前题
async function renderCurrentQuiz(container) {
  if (!quizState || quizState.current >= quizState.total) {
    await renderQuizResult(container);
    return;
  }

  const wordObj = quizState.items[quizState.current];
  if (!wordObj) { quizState.current++; await renderCurrentQuiz(container); return; }

  // 题型：每题独立随机，不追求两种题型次数相等。
  // 本轮内缓存下来，避免切页签回来时当前题突然变了题型；
  // 但重新点「开始复习 / 再测一轮」会新建 quizState，所有题全部重新随机。
  if (!quizState.questions) quizState.questions = {};
  if (!quizState.questions[quizState.current]) {
    quizState.questions[quizState.current] = generateQuiz(wordObj);
  }
  const question = quizState.questions[quizState.current];
  quizState.currentQuestion = question;
  quizState.wordObj = wordObj;
  quizState.pendingResult = null;         // 新题清掉上一题的结果
  quizState.lastAnswer = '';

  const progress = `第 ${quizState.current + 1} / ${quizState.total} 题`;
  const scopeLabel = quizState.scope === 'today'
    ? '今日单词'
    : (quizState.scope === 'idiom' ? '俗语' : '全部已学');

  container.innerHTML = `
    <div class="card">
      <div class="flex-between mb-sm">
        <span class="text-muted text-sm">${scopeLabel} · ${progress}</span>
        <span class="tag">${question.type === 'en2zh' ? '看英文写中文' : '看中文写英文'}</span>
      </div>
      <div class="text-center mb-sm">
        <div class="quiz-prompt">${formatTranslation(question.prompt)}</div>
        ${wordObj.phonetic ? `<div class="text-muted text-sm">${wordObj.phonetic}</div>` : ''}
      </div>
      <input class="input mb-sm" id="quiz-answer" placeholder="${question.placeholder}" autocomplete="off" autocapitalize="off">
      <button class="btn btn-primary btn-block" data-action="submit-quiz">提交</button>
      <div id="quiz-result-area"></div>
    </div>
  `;

  // 自动聚焦输入框
  document.getElementById('quiz-answer').focus();
}

// 提交答案：不自动判分，一律把「英文 + 中文」都亮出来，让用户自己判
function submitQuiz() {
  if (!quizState) return;
  const input = document.getElementById('quiz-answer');
  const userAnswer = input ? input.value.trim() : '';
  const w = quizState.wordObj;
  const area = document.getElementById('quiz-result-area');
  quizState.lastAnswer = userAnswer;
  quizState.pendingResult = { ok: null };

  if (input) input.blur();     // 收起键盘，方便看参考答案

  area.innerHTML = `
    <div class="card mt-sm answer-card">
      <div class="card-title">参考答案</div>
      <div class="ref-head">
        <span class="ref-en">${esc(w.word)}</span>
        ${w.phonetic ? `<span class="phonetic-pill">${esc(w.phonetic)}</span>` : ''}
      </div>
      <p class="ref-zh mb-sm">${formatTranslation(w.translation)}</p>
      <p class="text-muted text-sm mb-sm">你写的：${userAnswer ? esc(userAnswer) : '（空）'}</p>
      <p class="text-muted text-sm mb-sm">对照一下，自己判对错：</p>
      <div class="flex gap-sm">
        <button class="btn btn-primary" data-action="confirm-ok" style="flex:1">✓ 写对了</button>
        <button class="btn btn-danger" data-action="confirm-wrong" style="flex:1">✗ 写错了</button>
      </div>
    </div>
  `;
}

// 用户自己判对错
function confirmQuiz(ok) {
  if (!quizState || !quizState.pendingResult) return;
  quizState.pendingResult.ok = ok;
  quizState.lastOk = ok;

  const w = quizState.wordObj;
  const isLast = quizState.current + 1 >= quizState.total;
  const area = document.getElementById('quiz-result-area');
  area.innerHTML = `
    <div class="mt-sm text-center">
      <p class="${ok ? 'result-correct' : 'result-wrong'}">${ok ? '✓ 已记为答对' : '✗ 已记为答错'}</p>
      <p class="text-muted text-sm mb-sm">${esc(w.word)} · ${formatTranslation(w.translation)}</p>
      <button class="btn btn-primary btn-block" data-action="next-quiz">${isLast ? '看成绩单' : '下一题'}</button>
    </div>
  `;
}

// 下一题
async function nextQuiz() {
  const result = quizState.pendingResult;
  if (!result || result.ok === null) return;   // 还没自己判对错

  const w = quizState.wordObj;

  // 俗语不写艾宾浩斯进度（那是单词的表），其余照旧记录
  if (!w.isIdiom) {
    await recordAnswer(w.word, quizState.currentQuestion.type, result.ok);
  }

  // 存下这道题的结果，最后一次出成绩单
  quizState.results.push({
    word: w.word,
    phonetic: w.phonetic || '',
    translation: w.translation || '',
    ok: !!result.ok,
    answer: quizState.lastAnswer || '',
    type: quizState.currentQuestion.type,
  });

  if (result.ok) quizState.correct++;
  quizState.current++;

  // 更新角标（只有单词复习才影响待学数）
  if (quizState.scope !== 'idiom') {
    const today = getTodayStr();
    const queue = await getTodayQueue(today);
    await updateBadge(Math.max(0, queue.all.length - quizState.current));
  }

  if (quizState.current >= quizState.total) {
    quizState.finished = true;
    await renderQuizResult(document.getElementById('page-review'));
  } else {
    await renderCurrentQuiz(document.getElementById('page-review'));
  }
}

// 渲染成绩单：哪些错了、哪些对了都列出来
async function renderQuizResult(container) {
  const { correct, total, results } = quizState;
  const rate = total > 0 ? Math.round(correct / total * 100) : 0;
  const wrong = results.filter(r => !r.ok);
  const right = results.filter(r => r.ok);
  const scopeLabel = quizState.scope === 'today'
    ? '今日单词'
    : (quizState.scope === 'idiom' ? '俗语' : '全部已学');

  // 一行结果：单词 + 音标 + 释义（答错的还可以看到正确答案高亮）
  const row = (r, isWrong) => `
    <div class="result-row ${isWrong ? 'wrong' : 'right'}">
      <div class="result-mark">${isWrong ? '✗' : '✓'}</div>
      <div class="result-main">
        <div class="result-word">${r.word}${r.phonetic ? `<span class="phonetic-pill">${r.phonetic}</span>` : ''}</div>
        <div class="result-trans">${formatTranslation(r.translation)}</div>
        ${isWrong && r.answer ? `<div class="result-yours">你写的：${r.answer}</div>` : ''}
      </div>
    </div>`;

  container.innerHTML = `
    <div class="card text-center">
      <div class="text-muted text-sm">${scopeLabel}复习完成</div>
      <div style="font-size:38px;font-weight:600;color:var(--color-primary);margin:12px 0 4px">${correct} / ${total}</div>
      <p class="text-muted text-sm">正确率 ${rate}%</p>
    </div>

    ${wrong.length > 0 ? `
    <div class="card">
      <div class="card-title" style="color:var(--color-danger)">答错 ${wrong.length} 个</div>
      ${wrong.map(r => row(r, true)).join('')}
    </div>` : ''}

    <div class="card">
      <div class="card-title" style="color:var(--color-success)">答对 ${right.length} 个</div>
      ${right.length > 0
        ? right.map(r => row(r, false)).join('')
        : '<p class="text-muted text-sm">这轮全错了，别灰心，下次再来一遍</p>'}
    </div>

    <button class="btn btn-primary btn-block" data-action="quiz-again" data-scope="${quizState.scope}">再测一轮（题目重新随机）</button>
    <button class="btn btn-secondary btn-block" data-action="quiz-back">返回复习页</button>
  `;
}

// 退出考核状态，回到复习页首页
async function quizBack() {
  quizState = null;
  await switchPage('review');
}

// ============================================================
// 我的页（主页面：收藏入口 + 备份；点收藏进入收藏列表）
// ============================================================
// 收藏相关的页面标题
const FAV_TITLES = { word: '收藏的单词', synset: '收藏的同义词', idiom: '收藏的俗语' };

async function renderSettings(container) {
  // 收藏菜单：单词 / 同义词 / 俗语 三个入口
  if (settingsView === 'favMenu') {
    await renderFavMenu(container);
    return;
  }
  // 某一类的收藏列表
  if (settingsView.startsWith('fav-')) {
    await renderFavList(container, settingsView.slice(4));
    return;
  }

  const profile = await getProfile();

  container.innerHTML = `
    <div class="card profile-card">
      <button class="profile-row" data-action="edit-profile">
        <span class="avatar">${renderAvatarHTML(profile.avatar)}</span>
        <span class="profile-main">
          <span class="profile-name">${esc(profile.name)}</span>
        </span>
        <span class="nav-chev">›</span>
      </button>
    </div>

    <div class="card">
      <button class="nav-row" data-action="open-favorites">
        <span class="item-main"><span class="item-title">收藏</span></span>
        <span class="nav-row-right">${favoriteSet.size} 个<span class="nav-chev">›</span></span>
      </button>
    </div>

    <div class="card">
      <div class="card-title">备份</div>
      <p class="text-muted text-sm mb-sm">导出全部数据到文件（含收藏），换手机或误删后可导入恢复</p>
      <button class="btn btn-primary btn-block mb-sm" data-action="export-backup">导出备份</button>
      <button class="btn btn-secondary btn-block" data-action="import-backup">导入备份</button>
    </div>
  `;
}

// 收藏菜单：三个模块各一行，点了再进具体列表
async function renderFavMenu(container) {
  const favs = await getAllFavorites();
  const countOf = (t) => favs.filter(f => (f.type || 'word') === t).length;

  const items = [
    { type: 'word', label: '单词' },
    { type: 'synset', label: '同义词' },
    { type: 'idiom', label: '俗语' },
  ];

  container.innerHTML = `
    <button class="back-btn" data-action="close-favorites">‹ 返回</button>
    ${items.map(it => `
      <div class="card">
        <button class="nav-row" data-action="open-fav-list" data-type="${it.type}">
          <span class="item-main"><span class="item-title">${it.label}</span></span>
          <span class="nav-row-right">${countOf(it.type)} 个<span class="nav-chev">›</span></span>
        </button>
      </div>`).join('')}
  `;
}

// 某一类收藏的具体列表
async function renderFavList(container, type) {
  const favs = await getAllFavorites();
  const keys = favs.filter(f => (f.type || 'word') === type).map(f => f.word);

  let cards = '';
  if (type === 'word') {
    const objs = (await Promise.all(keys.map(k => getWord(k)))).filter(Boolean);
    cards = objs.map(w => renderWordCard(w)).join('');
  } else if (type === 'idiom') {
    const all = await getAllIdioms();
    cards = all.filter(i => keys.includes(i.id))
      .map(i => idiomCardHTML(i, { withTrash: false })).join('');
  } else {
    const all = await getManualSynsets();
    cards = all.filter(s => keys.includes(s.id))
      .map(s => synCardHTML(s, { withActions: false })).join('');
  }

  const back = `<button class="back-btn" data-action="back-to-fav-menu">‹ 返回</button>`;

  container.innerHTML = cards
    ? `${back}${cards}`
    : `${back}
       <div class="empty-state">
         <div class="empty-icon">星</div>
         <p class="empty-text">这里还没有收藏</p>
         <p class="empty-hint">在卡片右上角点一下五角星就能收藏</p>
       </div>`;
}


// 切换词汇难度（并立刻把今天的词换成新难度）
async function setLevel(levelId) {
  const lv = VOCAB_LEVELS[levelId];
  if (!lv) return;

  const settings = await getSettings();
  if (resolveLevel(settings) === levelId && settings.levelVersion === LEVEL_VERSION) return;

  await setSettings({ ...settings, level: levelId, levelVersion: LEVEL_VERSION });

  // 立刻按新难度重抽今天的词（不用等到明天）
  const today = getTodayStr();
  const list = await pickDaily(today, levelId);
  await setDaily({ date: today, wordList: list, source: 'auto' });
  await updateBadge(list.length);

  // 回到今日页，直接看到新词（不弹窗打断，菜单随重新渲染自动收起）
  await switchPage('today');
}

// 导出备份
async function doExport() {
  try {
    const filename = await exportBackup();
    alert(`备份已导出：${filename}\n请保存到「文件」App 或微信收藏`);
  } catch (e) {
    alert('导出失败：' + e.message);
  }
}

// 导入备份
async function doImport() {
  const file = await pickFile();
  if (!file) return;
  if (!confirm('导入会覆盖现有数据，确定继续吗？')) return;
  try {
    await importBackup(file);
    alert('导入成功！数据已恢复');
    await onAppOpen();           // 重新生成角标
    await switchPage(currentPage); // 刷新当前页
  } catch (e) {
    alert('导入失败：' + e.message);
  }
}

// ============================================================
// 启动
// ============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
