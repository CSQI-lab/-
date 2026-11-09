/**
 * backup.js — 数据备份（导出 / 导入）
 * ============================================================
 * 负责：把所有学习数据导出成一个 JSON 文件（存到手机「文件」App），
 *       以及从备份文件恢复数据。
 *
 * 为什么需要它：iPhone 的网页 App 数据存在手机本地，
 * 系统偶尔会清理长期不用的数据。导出备份是唯一可靠的保全方式。
 *
 * 对外提供：exportBackup() 导出、importBackup(file) 导入。
 * 改这里会影响到：备份文件的格式和恢复逻辑。
 */

import { exportAllData, clearAllData, bulkPutImport } from './db.js';
import { DB_VERSION } from './config.js';

// 备份文件的 schema 版本（与 DB_VERSION 对应）
const BACKUP_SCHEMA_VERSION = DB_VERSION;

// ============================================================
// 导出备份
// ============================================================

export async function exportBackup() {
  // 1. 从数据库取出全部数据
  const data = await exportAllData();

  // 2. 打包成 JSON 字符串
  const json = JSON.stringify(data, null, 2);

  // 3. 创建一个可下载的文件（Blob）
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  // 4. 生成文件名：vocab-backup-2026-11-08.json
  const today = new Date().toISOString().slice(0, 10);
  const filename = `vocab-backup-${today}.json`;

  // 5. 触发下载（创建临时 <a> 标签点击它）
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // 6. 释放内存
  URL.revokeObjectURL(url);

  return filename;
}

// ============================================================
// 导入备份
// ============================================================

// file 是用户通过 <input type="file"> 选择的文件对象
export async function importBackup(file) {
  // 1. 读取文件内容
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('备份文件格式错误，不是有效的 JSON');
  }

  // 2. 基本格式校验
  if (!data.meta || !data.meta.schemaVersion) {
    throw new Error('这不是有效的备份文件（缺少版本信息）');
  }

  // 3. 版本迁移（当前只有 v1，以后改了表结构在这里加迁移步骤）
  data = migrateBackup(data);

  // 4. 清空现有数据，再写入（完整恢复）
  await clearAllData();

  // 5. 逐表写入
  if (data.words) await bulkPutImport('words', data.words);
  if (data.idioms) await bulkPutImport('idioms', data.idioms);
  if (data.daily) await bulkPutImport('daily', data.daily);
  if (data.progress) await bulkPutImport('progress', data.progress);
  if (data.synsets) await bulkPutImport('synsets', data.synsets);
  // 收藏是 v2 才有的表；v1 老备份里没有，跳过即可
  if (data.favorites) await bulkPutImport('favorites', data.favorites);
  // settings 表里只有一行（单个对象），批量写入函数要的是数组，包一层
  if (data.settings) await bulkPutImport('settings', [data.settings]);
  // meta 表的主键是 'key'，而备份里的 meta 是 {schemaVersion, ...} 普通对象，
  // 要先转成 {key, value} 条目，否则 put 会报错导致整个导入失败
  if (data.meta) {
    await bulkPutImport('meta',
      Object.entries(data.meta).map(([key, value]) => ({ key, value })));
  }

  return true;
}

// ============================================================
// 版本迁移框架
// ============================================================
// 以后改了表结构（DB_VERSION 从 1 升到 2），旧备份导入时
// 需要把旧格式转成新格式。在这里加迁移步骤：
//
//   function migrateBackup(data) {
//     let v = data.meta.schemaVersion;
//     if (v < 2) {
//       // v1 → v2 的改动：比如给每个 progress 加一个新字段
//       data.progress.forEach(p => { p.newField = 'default'; });
//       v = 2;
//     }
//     data.meta.schemaVersion = v;
//     return data;
//   }
//
// 当前只有 v1，不需要迁移，原样返回：
function migrateBackup(data) {
  data.meta.schemaVersion = BACKUP_SCHEMA_VERSION;
  return data;
}
