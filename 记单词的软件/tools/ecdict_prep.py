"""
ecdict_prep.py — 从 ECDICT 原始数据生成 App 词库
============================================================
输入：
  --input     ECDICT 的 ecdict.csv 路径（完整版，约 66MB）
  --resemble  ECDICT 的 resemble.txt 路径（近义词辨析，可选）

输出：
  app/data/words.json，包含：
    words    单词 + 短语（筛选规则见下）
    synsets  近义词组（从 resemble.txt 解析，带中文辨析说明）

筛选规则（都可以用命令行参数改）：
  单词：牛津3000核心词（oxford=1）或 考试标签（四六级/考研/雅思/托福等），
        必须有中文释义，只留纯字母（允许连字符和撇号）
  短语：含空格的词条，同样要考试标签或牛津标记，限 300 个
  排序：牛津优先 → 词频高的（更常见）优先，取前 --max 个

用法示例：
  python tools/ecdict_prep.py ^
    --input "C:/Users/lenovo/AppData/Local/Temp/ecdict/package/assets/ecdict.csv" ^
    --resemble "C:/Users/lenovo/AppData/Local/Temp/ecdict/package/assets/resemble.txt" ^
    --output app/data/words.json

生成后记得把 app/sw.js 里的 CACHE 版本号 +1，手机才能拿到新词库。
"""

import argparse
import csv
import json
import os
import sys
from datetime import date

# 中文字段按多长截断（有些释义连"网络释义"一大串，太长没必要）
MAX_TRANSLATION = 200
MAX_DEFINITION = 150
MAX_NOTE = 300


def parse_args():
    ap = argparse.ArgumentParser(description='ECDICT 词库预处理')
    ap.add_argument('--input', required=True, help='ecdict.csv 路径')
    ap.add_argument('--resemble', default='', help='resemble.txt 路径（可选，生成近义词组）')
    ap.add_argument('--output', default='app/data/words.json', help='输出 JSON 路径')
    ap.add_argument('--tags', default='zk,gk,cet4,cet6,ky,toefl,ielts,gre',
                    help='考试标签白名单（逗号分隔）')
    ap.add_argument('--oxford-only', action='store_true', help='只用牛津3000核心词')
    ap.add_argument('--max', type=int, default=8000, help='单词数量上限')
    ap.add_argument('--max-phrase', type=int, default=300, help='短语数量上限')
    return ap.parse_args()


def clean_int(v):
    """把 CSV 里的数字字段安全转成 int（空串/脏数据当 0）"""
    try:
        return int(str(v).strip() or 0)
    except (ValueError, TypeError):
        return 0


def pick_words(args):
    """从 ecdict.csv 里筛出目标词条"""
    tag_set = set(t.strip() for t in args.tags.split(',') if t.strip())
    singles, phrases = [], []
    seen = set()

    with open(args.input, encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = (row.get('word') or '').strip()
            translation = (row.get('translation') or '').strip()
            if not word or not translation:
                continue                      # 没词或没中文释义 → 不要
            if len(word) > 25:
                continue                      # 太长的多半是怪词条
            if word.lower() in seen:
                continue                      # 去重

            oxford = clean_int(row.get('oxford'))
            tag = (row.get('tag') or '').strip()
            tag_hit = any(t in tag.split() for t in tag_set)

            is_phrase = ' ' in word
            if is_phrase:
                # 短语：也要有考试标签或牛津标记
                if not (tag_hit or oxford):
                    continue
            else:
                # 单词：牛津 或 考试标签
                if args.oxford_only:
                    if not oxford:
                        continue
                elif not (oxford or tag_hit):
                    continue
                # 只留字母（允许 - 和 '），排除 'hood 这种和含数字的
                if not all(c.isalpha() for c in word.replace('-', '').replace("'", '')):
                    continue

            seen.add(word.lower())
            entry = {
                'word': word,
                'phonetic': (row.get('phonetic') or '').strip(),
                'translation': translation[:MAX_TRANSLATION],
                'definition': (row.get('definition') or '').strip()[:MAX_DEFINITION],
                'pos': (row.get('pos') or '').strip(),
                'collins': clean_int(row.get('collins')),
                'oxford': oxford,
                'tag': tag,
                'frq': clean_int(row.get('frq')),
                'bnc': clean_int(row.get('bnc')),
                'exchange': (row.get('exchange') or '').strip(),
                'isPhrase': is_phrase,
            }
            (phrases if is_phrase else singles).append(entry)

    # 排序：牛津优先 → 词频小的（更常见）在前；没词频数据的排最后
    def sort_key(w):
        return (-w['oxford'], w['frq'] if w['frq'] > 0 else 999999)

    singles.sort(key=sort_key)
    phrases.sort(key=sort_key)
    return singles[:args.max], phrases[:args.max_phrase]


def parse_resemble(path, limit_words=None):
    """
    解析 resemble.txt（近义词辨析）成同义词组。

    文件格式（每组之间空行分隔）：
        % quite, rather, pretty, fairly
        这组词都有"相当，颇"的意思，其区别是：
        - quite: ...
        - rather: ...
    """
    synsets = []
    with open(path, encoding='utf-8') as f:
        words, note_lines = [], []
        for line in f:
            line = line.rstrip('\n')
            if line.startswith('%'):
                # 新的一组开始，先把上一组存起来
                if len(words) >= 2:
                    synsets.append((words, note_lines))
                words = [w.strip() for w in line[1:].split(',') if w.strip()]
                note_lines = []
            elif line.strip() and words:
                note_lines.append(line.strip())
        if len(words) >= 2:
            synsets.append((words, note_lines))

    result = []
    for i, (words, note_lines) in enumerate(synsets):
        result.append({
            'id': f'syn-resemble-{i}',
            'words': words,
            'note': '\n'.join(note_lines)[:MAX_NOTE],   # 中文辨析说明
            'origin': 'auto',
        })
    return result


def main():
    args = parse_args()

    print(f'读取词库: {args.input}')
    singles, phrases = pick_words(args)
    print(f'  单词 {len(singles)} 个（牛津 {sum(1 for w in singles if w["oxford"])}），'
          f'短语 {len(phrases)} 个')

    synsets = []
    if args.resemble and os.path.exists(args.resemble):
        print(f'读取近义词辨析: {args.resemble}')
        synsets = parse_resemble(args.resemble)
        print(f'  近义词组 {len(synsets)} 组')

    data = {
        'meta': {
            'source': 'ECDICT (https://github.com/skywind3000/ECDICT)',
            'license': 'MIT',
            'generatedAt': str(date.today()),
            'filter': {
                'tags': args.tags,
                'oxfordOnly': args.oxford_only,
                'maxWords': args.max,
                'maxPhrases': args.max_phrase,
            },
            'total': len(singles) + len(phrases),
            'synsetCount': len(synsets),
        },
        'words': singles + phrases,
        # idioms 留空：空数组不会覆盖 App 里的俗语数据（用户自建的保留）
        'idioms': [],
        'synsets': synsets,
    }

    os.makedirs(os.path.dirname(args.output) or '.', exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

    size = os.path.getsize(args.output)
    print(f'已生成 {args.output}（{size/1024/1024:.2f} MB）')

    # 抽查几个词确认数据完整
    sample = {w['word']: w for w in singles}
    for check in ['big', 'hard', 'important', 'beautiful']:
        if check in sample:
            w = sample[check]
            print(f'  抽查 {check}: {w["phonetic"]} | {w["translation"][:30]} | oxford={w["oxford"]}')


if __name__ == '__main__':
    main()
