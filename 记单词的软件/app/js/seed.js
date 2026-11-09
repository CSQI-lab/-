/**
 * seed.js — 样本词库（备用数据）
 * ============================================================
 * 当还没有下载完整 ECDICT 词库时，用这份数据让 App 先跑起来。
 * 真实词库（words.json）就绪后，db.js 会优先加载 JSON，
 * 只有 JSON 不存在时才用这里的样本数据。
 *
 * 包含 30 个常用词（分 6 组同义词）+ 3 个短语 + 3 条俗语示例，
 * 足以演示「每日推送、同义词归组、考核」等全部功能。
 *
 * 对外提供：SAMPLE_WORDS / SAMPLE_IDIOMS / SAMPLE_SYNSETS
 */

// ---------- 样本单词（30 个 + 3 个短语） ----------
// 字段与 ECDICT 对齐：word单词 / phonetic音标 / translation中文释义 /
// definition英文释义 / pos词性 / oxford是否牛津3000 / tag考试标签 /
// frq词频排名 / exchange词形变化 / isPhrase是否短语
export const SAMPLE_WORDS = [
  // —— 同义组1：大 ——
  { word: 'big', phonetic: '/bɪɡ/', translation: '大的；重要的', definition: 'of considerable size or extent', pos: 'adj', oxford: 1, tag: 'zk,gk,cet4', frq: 200, exchange: 'bigger/bigger/biggest/big', isPhrase: false },
  { word: 'large', phonetic: '/lɑːdʒ/', translation: '大的；大量的', definition: 'of great or considerable size', pos: 'adj', oxford: 1, tag: 'zk,gk,cet4', frq: 350, exchange: 'larger/larger/largest/large', isPhrase: false },
  { word: 'huge', phonetic: '/hjuːdʒ/', translation: '巨大的；庞大的', definition: 'extremely large in size or amount', pos: 'adj', oxford: 1, tag: 'gk,cet4', frq: 800, exchange: 'huge/huge/huge/huge', isPhrase: false },
  { word: 'enormous', phonetic: '/ɪˈnɔːməs/', translation: '巨大的；极大的', definition: 'very large in size or quantity', pos: 'adj', oxford: 1, tag: 'cet4,cet6,ky', frq: 2000, exchange: 'enormous/enormous/enormous/enormous', isPhrase: false },

  // —— 同义组2：小 ——
  { word: 'small', phonetic: '/smɔːl/', translation: '小的；少的', definition: 'of a size that is less than normal', pos: 'adj', oxford: 1, tag: 'zk,gk,cet4', frq: 250, exchange: 'smaller/smaller/smallest/small', isPhrase: false },
  { word: 'little', phonetic: '/ˈlɪtl/', translation: '小的；很少的', definition: 'small in size, amount, or degree', pos: 'adj', oxford: 1, tag: 'zk,gk,cet4', frq: 300, exchange: 'less/lesser/least/little', isPhrase: false },
  { word: 'tiny', phonetic: '/ˈtaɪni/', translation: '微小的；极小的', definition: 'very small in size or amount', pos: 'adj', oxford: 1, tag: 'gk,cet4', frq: 1500, exchange: 'tinier/tinier/tiniest/tiny', isPhrase: false },

  // —— 同义组3：高兴 ——
  { word: 'happy', phonetic: '/ˈhæpi/', translation: '高兴的；幸福的', definition: 'feeling or showing pleasure', pos: 'adj', oxford: 1, tag: 'zk,gk,cet4', frq: 400, exchange: 'happier/happier/happiest/happy', isPhrase: false },
  { word: 'glad', phonetic: '/ɡlæd/', translation: '高兴的；乐意的', definition: 'pleased and happy', pos: 'adj', oxford: 1, tag: 'gk,cet4', frq: 1200, exchange: 'gladder/gladder/gladdest/glad', isPhrase: false },
  { word: 'joyful', phonetic: '/ˈdʒɔɪfl/', translation: '快乐的；喜悦的', definition: 'full of happiness and joy', pos: 'adj', oxford: 0, tag: 'cet4', frq: 3000, exchange: 'joyful/joyful/joyful/joyful', isPhrase: false },
  { word: 'delighted', phonetic: '/dɪˈlaɪtɪd/', translation: '高兴的；愉快的', definition: 'very pleased', pos: 'adj', oxford: 0, tag: 'cet4,cet6', frq: 2500, exchange: 'delighted/delighted/delighted/delighted', isPhrase: false },

  // —— 同义组4：重要 ——
  { word: 'important', phonetic: '/ɪmˈpɔːtnt/', translation: '重要的；有影响的', definition: 'having great significance or value', pos: 'adj', oxford: 1, tag: 'zk,gk,cet4', frq: 280, exchange: 'important/important/important/important', isPhrase: false },
  { word: 'significant', phonetic: '/sɪɡˈnɪfɪkənt/', translation: '重要的；意义重大的', definition: 'sufficiently great or important to be worthy of attention', pos: 'adj', oxford: 1, tag: 'cet4,cet6,ky,ielts,toefl', frq: 1000, exchange: 'significant/significant/significant/significant', isPhrase: false },
  { word: 'crucial', phonetic: '/ˈkruːʃl/', translation: '关键的；决定性的', definition: 'extremely important or necessary', pos: 'adj', oxford: 1, tag: 'cet4,cet6,ky,ielts,toefl', frq: 1800, exchange: 'crucial/crucial/crucial/crucial', isPhrase: false },
  { word: 'vital', phonetic: '/ˈvaɪtl/', translation: '至关重要的；生命的', definition: 'absolutely necessary or important', pos: 'adj', oxford: 1, tag: 'cet4,cet6,ky,ielts', frq: 1600, exchange: 'vital/vital/vital/vital', isPhrase: false },

  // —— 同义组5：美丽 ——
  { word: 'beautiful', phonetic: '/ˈbjuːtɪfl/', translation: '美丽的；美好的', definition: 'pleasing the senses or mind aesthetically', pos: 'adj', oxford: 1, tag: 'zk,gk,cet4', frq: 500, exchange: 'more beautiful/more beautiful/most beautiful/beautiful', isPhrase: false },
  { word: 'pretty', phonetic: '/ˈprɪti/', translation: '漂亮的；迷人的', definition: 'attractive in a delicate way', pos: 'adj', oxford: 1, tag: 'zk,gk,cet4', frq: 700, exchange: 'prettier/prettier/prettiest/pretty', isPhrase: false },
  { word: 'gorgeous', phonetic: '/ˈɡɔːdʒəs/', translation: '华丽的；极美的', definition: 'beautiful; very attractive', pos: 'adj', oxford: 0, tag: 'cet6,ky', frq: 2800, exchange: 'gorgeous/gorgeous/gorgeous/gorgeous', isPhrase: false },

  // —— 同义组6：困难 ——
  { word: 'difficult', phonetic: '/ˈdɪfɪkəlt/', translation: '困难的；艰难的', definition: 'hard to do or understand', pos: 'adj', oxford: 1, tag: 'zk,gk,cet4', frq: 600, exchange: 'difficult/difficult/difficult/difficult', isPhrase: false },
  { word: 'hard', phonetic: '/hɑːd/', translation: '困难的；硬的', definition: 'not easy; requiring effort', pos: 'adj', oxford: 1, tag: 'zk,gk,cet4', frq: 180, exchange: 'harder/harder/hardest/hard', isPhrase: false },
  { word: 'tough', phonetic: '/tʌf/', translation: '艰难的；坚韧的', definition: 'difficult to do or deal with', pos: 'adj', oxford: 1, tag: 'cet4,cet6,ky', frq: 1400, exchange: 'tougher/tougher/toughest/tough', isPhrase: false },

  // —— 其他常用词 ——
  { word: 'learn', phonetic: '/lɜːn/', translation: '学习；学会', definition: 'gain knowledge or skill', pos: 'v', oxford: 1, tag: 'zk,gk,cet4', frq: 350, exchange: 'learned:learnt/learned:learnt/learned:learnt/learn', isPhrase: false },
  { word: 'remember', phonetic: '/rɪˈmembə/', translation: '记得；记住', definition: 'have in or be able to bring to mind', pos: 'v', oxford: 1, tag: 'zk,gk,cet4', frq: 450, exchange: 'remembered/remembered/remembered/remember', isPhrase: false },
  { word: 'forget', phonetic: '/fəˈɡet/', translation: '忘记；遗忘', definition: 'fail to remember', pos: 'v', oxford: 1, tag: 'zk,gk,cet4', frq: 900, exchange: 'forgot/forgotten/forgotten/forget', isPhrase: false },
  { word: 'improve', phonetic: '/ɪmˈpruːv/', translation: '改善；提高', definition: 'make or become better', pos: 'v', oxford: 1, tag: 'gk,cet4,cet6,ky,ielts,toefl', frq: 1100, exchange: 'improved/improved/improved/improve', isPhrase: false },
  { word: 'achieve', phonetic: '/əˈtʃiːv/', translation: '实现；达到', definition: 'successfully bring about or reach', pos: 'v', oxford: 1, tag: 'gk,cet4,cet6,ky,ielts,toefl', frq: 1300, exchange: 'achieved/achieved/achieved/achieve', isPhrase: false },

  // —— 短语（isPhrase: true） ——
  { word: 'look forward to', phonetic: '/lʊk ˈfɔːwəd tu/', translation: '期待；盼望', definition: 'to be excited about something that will happen', pos: 'phrase', oxford: 1, tag: 'gk,cet4', frq: 0, exchange: '', isPhrase: true },
  { word: 'take care of', phonetic: '/teɪk keə əv/', translation: '照顾；照料', definition: 'to look after someone or something', pos: 'phrase', oxford: 1, tag: 'zk,gk,cet4', frq: 0, exchange: '', isPhrase: true },
  { word: 'give up', phonetic: '/ɡɪv ʌp/', translation: '放弃；停止', definition: 'to stop trying to do something', pos: 'phrase', oxford: 1, tag: 'gk,cet4', frq: 0, exchange: '', isPhrase: true },
];

// ---------- 样本俗语（3 条示例，用户可自行增删） ----------
export const SAMPLE_IDIOMS = [
  { id: 'idiom-1', text: 'A piece of cake', meaning: '小菜一碟；非常容易', example: 'The exam was a piece of cake.', createdAt: '2026-11-08' },
  { id: 'idiom-2', text: 'Break a leg', meaning: '祝你好运（常用于演出前）', example: 'Break a leg in your performance tonight!', createdAt: '2026-11-08' },
  { id: 'idiom-3', text: 'Hit the books', meaning: '用功读书', example: 'I need to hit the books for the exam.', createdAt: '2026-11-08' },
];

// ---------- 样本同义词组（与上面单词对应） ----------
// words 数组里的词必须都出现在 SAMPLE_WORDS 里，才能自动归组
export const SAMPLE_SYNSETS = [
  { id: 'syn-1', words: ['big', 'large', 'huge', 'enormous'], origin: 'auto' },
  { id: 'syn-2', words: ['small', 'little', 'tiny'], origin: 'auto' },
  { id: 'syn-3', words: ['happy', 'glad', 'joyful', 'delighted'], origin: 'auto' },
  { id: 'syn-4', words: ['important', 'significant', 'crucial', 'vital'], origin: 'auto' },
  { id: 'syn-5', words: ['beautiful', 'pretty', 'gorgeous'], origin: 'auto' },
  { id: 'syn-6', words: ['difficult', 'hard', 'tough'], origin: 'auto' },
];
