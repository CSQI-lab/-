/**
 * config.js — 全局配置中心
 * ============================================================
 * 这是整个 App 的「控制面板」。
 * 以后想调整任何参数（每天背几个词、复习间隔、题型、主题色），
 * 只改这一个文件里的数字就行，不用动其他业务代码。
 *
 * 对外提供：所有配置常量，其他模块通过 import 使用。
 * 改这里会影响到：全 App 的行为参数。
 */

// ---------- 数据库 ----------
export const DB_NAME = 'vocab';        // IndexedDB 数据库名
export const DB_VERSION = 2;           // 数据库版本号（改了表结构就 +1，会触发自动迁移）
                                       // v2：新增 favorites 表（收藏）

// ---------- 每日学习 ----------
export const DAILY_COUNT = 10;           // 每天推送/生成的单词数量
export const RECENT_EXCLUDE_DAYS = 30;   // 最近多少天内出现过的词不再重复推送

// ---------- 词汇难度档位（决定每天推什么难度的词） ----------
// 三个难度，按词库里 7930 个单词「词数三等分」（分界点 frq 3039 / 6495）。
// 词频数值越小 = 越常见、越简单。
//   易   1000-3039 → somebody / magazine / hotel / soldier / reflect（接近四级）
//   中   3039-6495 → calculate / tendency / uniform / scholarship（六级难度）
//   难   6495 以上 → sticky / thereafter / clergy / turmoil（高于六级）
// 想整体调难/调简单：改对应档位的 minFrq（数值越大越难）。
export const VOCAB_LEVELS = {
  easy:   { label: '易', desc: '接近四级', minFrq: 1000, maxFrq: 3039, allowPhrase: true },
  medium: { label: '中', desc: '六级难度', minFrq: 3039, maxFrq: 6495, allowPhrase: true },
  hard:   { label: '难', desc: '高于六级', minFrq: 6495, maxFrq: 999999 },
};

export const DEFAULT_LEVEL = 'medium';   // 默认：中（六级难度）

// 旧版本档位 id 的迁移映射（老用户升级时用，避免档位丢失）
export const LEGACY_LEVEL_MAP = {
  junior: 'easy', cet4: 'easy',
  cet6: 'medium', hard: 'medium',
  ky: 'hard', abroad: 'hard', gre: 'hard', expert: 'hard',
};

// ---------- 艾宾浩斯复习曲线 ----------
// 单位：天。答对一级就按下一个间隔排期，答错回到上一级
export const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30];

// ---------- 复习出题 ----------
export const REVIEW_QUIZ_COUNT = 10;   // 每次复习出几道题

// 挑题权重参数（改这些就能调"哪种词更容易被考到"，数值越大越容易被抽中）
// 综合三个因素：艾宾浩斯到期情况 + 历史正确率 + 今日答题表现
export const REVIEW_WEIGHTS = {
  neverTested: 1.2,       // 还没考过的词（今天刚加的）
  dueToday: 3,            // 今天正好到期的词
  overduePerDay: 0.6,     // 每超期 1 天加多少权重（最多按 15 天算）
  notDueDecay: 0.08,      // 还没到期的词，每差 1 天降多少权重
  min: 0.3,               // 权重下限（保证全库复习时任何词都有机会）
  stageFactor: 0.08,      // 复习阶段越低（记忆越不稳）加多少权重
  accuracyFactor: 2,      // 历史正确率权重系数（正确率 0 → 权重 ×3）
  todayWrongFactor: 2.5,  // 今天答错的词再放大多少（答错 → 权重 ×3.5）
};

// ---------- 考核题型 ----------
// 这是一个「登记表」：以后想加新题型（如听音选词），在这里加一项 + 在 quiz.js 写实现即可
export const QUIZ_MODES = ['en2zh', 'zh2en'];  // en2zh=看英文写中文, zh2en=看中文拼英文

// ---------- 词库筛选 ----------
// 从 ECDICT 里筛哪些考试范围的词；改这里就能换词库范围
export const WORD_FILTER_TAGS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'ielts', 'toefl'];
export const WORD_OXFORD_ONLY = false;  // true=只用牛津3000核心词；false=牛津3000 + 考试标签词

// ---------- 朗读 ----------
export const TTS_LANG = 'en-US';   // 朗读语言
export const TTS_RATE = 0.9;       // 语速（0.5很慢 ~ 1.0正常 ~ 2.0很快）

// ---------- 界面 ----------
export const THEME_COLOR = '#1A73E8';  // 主题色（科技蓝）
export const APP_NAME = '记单词';       // App 名称

// ---------- 功能开关 ----------
// 以后加新功能时，先在这里加一个开关，默认 false（关），稳定后改 true（开）
// 开关不影响已有数据，随时可切换
export const FEATURE_FLAGS = {
  onlineAudio: false,    // 在线真人发音（默认关，走系统朗读）
  quizChoice: false,     // 选择题模式（未来扩展，暂未实现）
  statistics: false,     // 学习统计图表（未来扩展，暂未实现）
};
