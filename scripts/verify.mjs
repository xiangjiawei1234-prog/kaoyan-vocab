#!/usr/bin/env node
/**
 * 一键验收：主应用逻辑测试 + 数据校验（若存在）
 * 用法：node scripts/verify.mjs
 *
 * 说明：多词书/词库数据测试较重（加载 ~5.7MB 词库），给子进程加内存上限；
 * 2026-10-21 曾因断言直接比较 8100 元素数组导致内存暴涨，已修复，勿重蹈。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NODE_FLAGS = ["--max-old-space-size=512"];
const checks = [
  { name: "test-app", cmd: process.execPath, args: ["js/test-app.mjs"] },
  { name: "test-backup-archives", cmd: process.execPath, args: ["js/test-backup-archives.mjs"] },
  { name: "test-regressions", cmd: process.execPath, args: ["js/test-regressions.mjs"] },
  { name: "test-review-logic", cmd: process.execPath, args: ["js/test-review-logic.mjs"] },
  { name: "test-review-storage", cmd: process.execPath, args: ["js/test-review-storage.mjs"] },
  { name: "test-doubleclick", cmd: process.execPath, args: ["js/test-doubleclick.mjs"] },
  { name: "test-toast", cmd: process.execPath, args: ["js/test-toast.mjs"] },
  { name: "test-study-time", cmd: process.execPath, args: ["js/test-study-time.mjs"] },
  { name: "test-pos-filter", cmd: process.execPath, args: ["js/test-pos-filter.mjs"] },
  { name: "test-rhythm", cmd: process.execPath, args: ["js/test-rhythm.mjs"] },
  { name: "test-review-cap", cmd: process.execPath, args: ["js/test-review-cap.mjs"] },
  { name: "test-extra-new", cmd: process.execPath, args: ["js/test-extra-new.mjs"] },
  { name: "test-group", cmd: process.execPath, args: ["js/test-group.mjs"] },
  { name: "test-lifecycle", cmd: process.execPath, args: ["js/test-lifecycle.mjs"] },
  { name: "test-defaults", cmd: process.execPath, args: ["js/test-defaults.mjs"] },
  { name: "test-settings-profiles", cmd: process.execPath, args: ["js/test-settings-profiles.mjs"] },
  { name: "test-study-actions", cmd: process.execPath, args: ["js/test-study-actions.mjs"] },
  { name: "test-input-preferences", cmd: process.execPath, args: ["js/test-input-preferences.mjs"] },
  { name: "test-reading-layout", cmd: process.execPath, args: ["js/test-reading-layout.mjs"] },
  { name: "test-study-modes", cmd: process.execPath, args: ["js/test-study-modes.mjs"] },
  { name: "test-device-preferences", cmd: process.execPath, args: ["js/test-device-preferences.mjs"] },
  { name: "test-wordlist-tools", cmd: process.execPath, args: ["js/test-wordlist-tools.mjs"] },
  { name: "test-stats-drill", cmd: process.execPath, args: ["js/test-stats-drill.mjs"] },
  { name: "test-word-issues", cmd: process.execPath, args: ["js/test-word-issues.mjs"] },
  { name: "test-autoresume", cmd: process.execPath, args: ["js/test-autoresume.mjs"] },
  { name: "test-senses", cmd: process.execPath, args: ["js/test-senses.mjs"] },
  { name: "test-senses-data", cmd: process.execPath, args: ["js/test-senses-data.mjs"] },
  { name: "test-resume-session", cmd: process.execPath, args: ["js/test-resume-session.mjs"] },
  { name: "test-save-rest", cmd: process.execPath, args: ["js/test-save-rest.mjs"] },
  { name: "test-micro-learning", cmd: process.execPath, args: ["js/test-micro-learning.mjs"] },
  { name: "test-ex-lookup", cmd: process.execPath, args: ["js/test-ex-lookup.mjs"] },
  { name: "test-review-interaction", cmd: process.execPath, args: ["js/test-review-interaction.mjs"] },
  { name: "test-review-offline", cmd: process.execPath, args: ["js/test-review-offline.mjs"] },
  { name: "test-pwa-cache", cmd: process.execPath, args: ["js/test-pwa-cache.mjs"] },
  { name: "test-pwa-status", cmd: process.execPath, args: ["js/test-pwa-status.mjs"] },
  { name: "test-guide", cmd: process.execPath, args: ["js/test-guide.mjs"] },
  { name: "test-a11y", cmd: process.execPath, args: ["js/test-a11y.mjs"] },
  { name: "test-audio-playback", cmd: process.execPath, args: ["js/test-audio-playback.mjs"] },
  { name: "test-spelling-drill", cmd: process.execPath, args: ["js/test-spelling-drill.mjs"] },
  { name: "test-list-arrow", cmd: process.execPath, args: ["js/test-list-arrow.mjs"] },
  { name: "test-review-ui", cmd: process.execPath, args: ["js/test-review-ui.mjs"] },
  { name: "test-multibook", cmd: process.execPath, args: ["js/test-multibook.mjs"] },
  { name: "test-combined-book", cmd: process.execPath, args: ["js/test-combined-book.mjs"] },
  { name: "test-content-quality", cmd: process.execPath, args: ["js/test-content-quality.mjs"] },
  { name: "test-txt-export", cmd: process.execPath, args: ["js/test-txt-export.mjs"] },
  { name: "test-txt-zip", cmd: process.execPath, args: ["js/test-txt-zip.mjs"] },
  { name: "test-new-features", cmd: process.execPath, args: ["js/test-new-features.mjs"], optional: true },
  { name: "test-spelling-migration", cmd: process.execPath, args: ["js/test-spelling-migration.mjs"], optional: true },
  { name: "test-print-export", cmd: process.execPath, args: ["js/test-print-export.mjs"], optional: true },

  { name: "validate-senses", cmd: process.execPath, args: ["scripts/validate-senses.mjs"] },
  { name: "validate-words", cmd: process.execPath, args: ["js/validate-words.mjs"], optional: true },
  { name: "validate-cet-data", cmd: process.execPath, args: ["js/validate-cet-data.mjs"], optional: true },
];

let failed = 0;
for (const c of checks) {
  const path = join(root, c.args[0]);
  if (!existsSync(path)) {
    if (c.optional) {
      console.log(`SKIP  ${c.name}（${c.args[0]} 不存在）`);
      continue;
    }
    console.error(`FAIL  ${c.name}（缺少 ${c.args[0]}）`);
    failed++;
    continue;
  }
  console.log(`\n======== ${c.name} ========`);
  const args = [...NODE_FLAGS, ...c.args];
  const r = spawnSync(c.cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`FAIL  ${c.name} exit=${r.status}`);
    failed++;
  } else {
    console.log(`OK    ${c.name}`);
  }
}

console.log(failed ? `\n验收失败：${failed} 项` : "\n验收全部通过");
process.exit(failed ? 1 : 0);
