// 最小原型对比：串行基线 vs 有界并发（流水线 + 读集校验 + 冲突留痕）。
// 安全边界：只读工作区 data/ 下的源项目，cp 到系统临时目录后才读写；
// 不改动 server/、src/ 任何源码，所有写入都发生在临时副本里。
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const flag = (name, fallback) => { const hit = argv.find(a => a.startsWith(`--${name}=`)); return hit === undefined ? fallback : hit.slice(name.length + 3); };
const positional = argv.filter(a => !a.startsWith('--'));
const SOURCE = positional[0] || 'data/projects/3aaf8f0b-6485-4070-9865-d39bf0991b23';
const PROJECT_ID = flag('project', path.basename(SOURCE));
const START = Number(flag('start', 4));
const END = Number(flag('end', 12));
const K = Number(flag('k', 3));
const ARMS = flag('arms', 'serial,concurrent').split(',');
const KEEP = argv.includes('--keep');
const OUT_DIR = path.join('prototype', 'out');
const REPO_DATA = path.resolve('data');

const freshMetrics = () => ({ attempts: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0 });
const synthetic = (project, page) => ({ kind: page.purpose || 'extra', confidence: 1, reason: '手动排除，不参与剧情理解', summary: '', storyTime: '', memory: project.memory, turningPoint: null, characters: [], relationChanges: [] });

async function cropAvatar(projectId, page, characterId, box) {
  const dir = path.join(process.env.DATA_DIR, 'projects', projectId, 'avatars');
  const left = Math.min(page.width - 1, Math.floor(box.x * page.width)); const top = Math.min(page.height - 1, Math.floor(box.y * page.height));
  const width = Math.min(page.width - left, Math.max(1, Math.floor(box.width * page.width))); const height = Math.min(page.height - top, Math.max(1, Math.floor(box.height * page.height)));
  const filename = `${characterId}-${randomUUID()}.jpg`;
  await mkdir(dir, { recursive: true });
  await sharp(path.join(process.env.DATA_DIR, 'projects', projectId, 'images', `${page.id}.jpg`)).extract({ left, top, width, height }).resize(192, 192, { fit: 'cover' }).jpeg({ quality: 90 }).toFile(path.join(dir, filename));
  return `/media/${projectId}/avatars/${filename}`;
}

// ---------------------------------------------------------------------------
// 单臂运行（在子进程里执行，DATA_DIR 已指向临时副本）
// ---------------------------------------------------------------------------
async function runArm(arm) {
  if (path.resolve(process.env.DATA_DIR || 'data') === REPO_DATA) throw new Error('拒绝在真实数据目录上运行：DATA_DIR 必须指向临时副本。');
  const { readPage, config } = await import('../server/provider.js');
  const { applyReading, resetAnalysis, relationKey, validateReferences } = await import('../server/analysis.js');
  const { resolveIdentities } = await import('../server/identity.js');
  const { factKey } = await import('../server/character-facts.js');
  const { readProject, saveProject } = await import('../server/store.js');
  const { readingOptions } = await import('../server/reading-request.js');

  const c = await config();
  console.log(`[${arm}] model=${c.model} options=${JSON.stringify(readingOptions(c.model))} key=${c.apiKey ? 'ok' : 'MISSING'}`);
  if (!c.apiKey) throw new Error('未找到 API Key（检查 .env 与密钥文件）。');
  const project = await readProject(PROJECT_ID);
  resetAnalysis(project);
  for (let i = 0; i < START - 1; i++) {
    const page = project.pages[i];
    if (page.override !== 'skip') throw new Error(`第 ${i + 1} 页不是手动排除页，原型目前只支持跳过页作为前缀。`);
    applyReading(project, synthetic(project, page));
  }
  await saveProject(project);
  console.log(`[${arm}] prefix committed: processed=${project.processed}; plan=${project.pages.slice(START - 1, END).map((p, i) => `${START + i}:${p.override}/${p.purpose || '-'}`).join(' ')}`);

  const signal = new AbortController().signal;
  const rows = [];
  const allConflicts = [];
  const startedAll = Date.now();
  const buildAvatars = async (page, reading) => {
    const avatars = {};
    for (const person of reading.characters) if (person.avatarBox && !project.characters.find(x => x.id === person.id)?.avatar) avatars[person.id] = await cropAvatar(project.id, page, person.id, person.avatarBox);
    return avatars;
  };

  if (arm === 'serial') {
    for (let i = START - 1; i < END; i++) {
      const page = project.pages[i];
      if (page.override === 'skip') { applyReading(project, synthetic(project, page)); await saveProject(project); rows.push({ page: i + 1, skip: true }); continue; }
      const metrics = freshMetrics(); const startedAt = Date.now();
      const reading = await readPage(project, signal, metrics);
      // 与 server/index.ts run() 完全一致：先归一化身份再校验、裁剪头像，最后提交。
      const normalized = resolveIdentities(project, reading).reading;
      validateReferences(project, normalized);
      applyReading(project, reading, await buildAvatars(page, normalized));
      const ms = Date.now() - startedAt;
      await saveProject(project);
      rows.push({ page: i + 1, ms, ...metrics });
      console.log(`[${arm}] P${i + 1} ${(ms / 1000).toFixed(1)}s out=${metrics.completionTokens} think=${metrics.reasoningTokens}`);
    }
  } else {
    // 流水线：始终维持 K 个在飞请求；启动顺序=提交顺序；每个请求携带自己启动时的
    // 状态快照（base）与 basePage，提交时对写入键做读集校验。
    const inflight = new Map(); const order = []; let next = START - 1;
    const launch = i => {
      const page = project.pages[i];
      if (page.override === 'skip') { inflight.set(i, Promise.resolve({ i, skip: true })); order.push(i); return; }
      const base = structuredClone(project); const basePage = project.processed;
      const snap = structuredClone(project); snap.processed = i;
      const prev = snap.pages[i - 1];
      let prevRef = 'none';
      if (prev?.analysis?.kind === 'story') prevRef = 'committed';
      else if (prev && !prev.analysis && prev.override !== 'skip' && (prev.purpose === undefined || prev.purpose === 'story')) {
        // 上一页仍在阅读中：保留它的图片作为“仅供参考”，但摘要无法提供。
        prev.analysis = { kind: 'story', confidence: 1, reason: '并发原型：上一页仍在阅读中，先按正文参考', summary: '', storyTime: '' };
        prevRef = 'stub';
      }
      const metrics = freshMetrics(); const startedAt = Date.now();
      const promise = readPage(snap, signal, metrics)
        .then(reading => ({ i, reading, metrics, ms: Date.now() - startedAt, base, basePage, missed: i - basePage, prevRef }))
        .catch(error => ({ i, error, metrics, ms: Date.now() - startedAt, base, basePage, missed: i - basePage, prevRef }));
      inflight.set(i, promise); order.push(i);
    };
    while (next < END || order.length) {
      while (inflight.size < K && next < END) launch(next++);
      const i = order.shift(); const r = await inflight.get(i); inflight.delete(i);
      if (r.error) throw r.error;
      const page = project.pages[i];
      if (r.skip) { applyReading(project, synthetic(project, page)); await saveProject(project); rows.push({ page: i + 1, skip: true }); continue; }
      const normalized = resolveIdentities(project, r.reading).reading;
      validateReferences(project, normalized);
      const { reading, conflicts } = validateWrites(project, { base: r.base, basePage: r.basePage, reading: normalized, relationKey, factKey });
      applyReading(project, reading, await buildAvatars(page, reading));
      await saveProject(project);
      rows.push({ page: i + 1, ms: r.ms, ...r.metrics, basePage: r.basePage, missed: r.missed, prevRef: r.prevRef, conflicts });
      allConflicts.push(...conflicts.map(x => ({ page: i + 1, ...x })));
      console.log(`[${arm}] P${i + 1} ${(r.ms / 1000).toFixed(1)}s base=P${r.basePage} missed=${r.missed} prevRef=${r.prevRef} out=${r.metrics.completionTokens} conflicts=${conflicts.length}${conflicts.length ? ' [' + conflicts.map(x => x.type + ':' + x.reason).join(', ') + ']' : ''}`);
    }
  }
  const wallMs = Date.now() - startedAll;
  project.status = 'completed';
  await saveProject(project);

  const result = { arm, model: c.model, options: readingOptions(c.model), source: SOURCE, start: START, end: END, k: K, wallMs, finishedAt: new Date().toISOString(), rows, conflicts: allConflicts, state: stateSummary(project, relationKey) };
  await mkdir(path.dirname(process.env.ARM_OUT), { recursive: true });
  await writeFile(process.env.ARM_OUT, JSON.stringify(result, null, 2));
  console.log(`[${arm}] done: wall=${(wallMs / 1000).toFixed(1)}s pages=${rows.filter(r => !r.skip).length} conflicts=${allConflicts.length} -> ${process.env.ARM_OUT}`);
  printTable(arm, rows);
}

// 读集校验：reading 由快照 base（第 basePage 页后的状态）推导，提交时对每个写入键
// 检查它在 base 之后是否已被改动。改动过 = 冲突，不覆盖、只留痕；新键 = 直接放行。
function validateWrites(live, { base, basePage, reading, relationKey, factKey }) {
  const conflicts = [];
  const baseRel = new Map(base.relations.map(x => [relationKey(x), x]));
  const liveRel = new Map(live.relations.map(x => [relationKey(x), x]));
  const fieldOf = c => JSON.stringify([c.name, [...(c.aliases || [])].sort().join('|'), c.description, c.appearance ?? null, c.nameType ?? null, c.presence ?? null]);
  const droppedIds = new Set();
  const characters = [];
  for (const person of reading.characters) {
    const bc = base.characters.find(x => x.id === person.id);
    const lc = live.characters.find(x => x.id === person.id);
    if (bc && !lc) { droppedIds.add(person.id); conflicts.push({ type: 'character', id: person.id, reason: 'merged-or-removed-in-window' }); continue; }
    const staleFields = !!(lc && (!bc || fieldOf(bc) !== fieldOf(lc)));
    const profile = []; const status = [];
    for (const update of person.profileUpdates || []) {
      const liveFact = lc && (lc.profile || []).find(f => factKey(f) === factKey(update));
      if (liveFact && liveFact.sincePage > basePage) conflicts.push({ type: 'fact', id: person.id, key: update.key, reason: 'updated-in-window' });
      else profile.push(update);
    }
    for (const update of person.statusChanges || []) {
      const liveFact = lc && (lc.statuses || []).find(f => factKey(f) === factKey(update));
      if (liveFact && liveFact.sincePage > basePage) conflicts.push({ type: 'fact', id: person.id, key: update.key, reason: 'updated-in-window' });
      else status.push(update);
    }
    if (staleFields) {
      conflicts.push({ type: 'character', id: person.id, reason: bc ? 'fields-updated-in-window' : 'created-in-window' });
      // 字段沿用 live 现值（等于空写），只保留未被窗口改动的档案/状态维度。
      characters.push({ ...person, name: lc.name, aliases: lc.aliases, description: lc.description, appearance: lc.appearance, nameType: lc.nameType, presence: lc.presence, profileUpdates: profile, statusChanges: status });
    } else {
      characters.push({ ...person, profileUpdates: profile, statusChanges: status });
    }
  }
  const relationChanges = [];
  for (const rc of reading.relationChanges) {
    if (droppedIds.has(rc.source) || droppedIds.has(rc.target)) { conflicts.push({ type: 'relation', reason: 'endpoint-dropped', key: relationKey(rc) }); continue; }
    const key = relationKey(rc); const b = baseRel.get(key); const l = liveRel.get(key);
    if (rc.action === 'upsert') {
      if (!l && b) conflicts.push({ type: 'relation', key, reason: 'removed-in-window', proposed: rc.label });
      else if (l && l.sincePage > basePage) conflicts.push({ type: 'relation', key, reason: 'updated-in-window', live: l.label, proposed: rc.label });
      else relationChanges.push(rc);
    } else {
      if (l && l.sincePage > basePage) conflicts.push({ type: 'relation', key, reason: 'updated-in-window', live: l.label, proposed: 'remove' });
      else if (!l && b) conflicts.push({ type: 'relation', key, reason: 'already-removed' });
      else relationChanges.push(rc);
    }
  }
  if (live.memory !== base.memory) conflicts.push({ type: 'memory', reason: 'replaced-from-stale-base', baseLength: base.memory.length, liveLength: live.memory.length, proposedLength: reading.memory.length });
  const baseStage = base.stages.at(-1); const liveStage = live.stages.at(-1);
  if (base.stages.length !== live.stages.length || baseStage?.fromPage !== liveStage?.fromPage) conflicts.push({ type: 'stage', reason: 'changed-in-window', baseStages: base.stages.length, liveStages: live.stages.length });
  if (JSON.stringify(base.identityRedirects || {}) !== JSON.stringify(live.identityRedirects || {})) conflicts.push({ type: 'identity', reason: 'redirects-changed-in-window' });
  return { reading: { ...reading, characters, relationChanges }, conflicts };
}

function stateSummary(project, relationKey) {
  return {
    processed: project.processed,
    memory: { length: project.memory.length, head: project.memory.slice(0, 120), tail: project.memory.slice(-120) },
    characters: project.characters.map(x => ({ id: x.id, name: x.name, firstPage: x.firstPage, aliases: x.aliases, hasAvatar: !!x.avatar, profile: (x.profile || []).length, statuses: (x.statuses || []).length })),
    relations: project.relations.map(x => ({ key: relationKey(x), label: x.label, sincePage: x.sincePage })),
    stages: project.stages.map(s => ({ from: s.fromPage, to: s.toPage, title: s.title, changes: s.changes.length })),
    pages: project.pages.map((p, i) => ({ n: i + 1, kind: p.analysis?.kind ?? null, summaryLength: p.analysis?.summary?.length ?? null, storyTime: p.analysis?.storyTime ?? null })),
  };
}

function printTable(arm, rows) {
  console.log(`\n[${arm}] #\tms\tattempts\tprompt\tcompletion\treasoning\tbase/missed`);
  for (const r of rows) console.log([r.page, r.skip ? 'skip' : (r.ms / 1000).toFixed(1), r.attempts ?? '-', r.promptTokens ?? '-', r.completionTokens ?? '-', r.reasoningTokens ?? '-', r.skip ? '' : `P${r.basePage}/-${r.missed} ${r.prevRef}`].join('\t'));
}

// ---------------------------------------------------------------------------
// 父进程：准备临时副本、串行/并发各自跑一个子进程、汇总对比
// ---------------------------------------------------------------------------
async function orchestrate() {
  console.log(`[proto] 源项目（只读）: ${SOURCE}\n[proto] 所有读写都在系统临时目录的副本中进行；工作区 data/ 不会被修改。`);
  console.log(`[proto] 页面范围 ${START}-${END}，K=${K}，arms=${ARMS.join(',')}${KEEP ? '（保留临时目录）' : ''}`);
  await mkdir(OUT_DIR, { recursive: true });
  const results = {};
  for (const arm of ARMS) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), `proto-${arm}-`));
    await mkdir(path.join(dataDir, 'projects'), { recursive: true });
    await cp(SOURCE, path.join(dataDir, 'projects', PROJECT_ID), { recursive: true });
    console.log(`\n[proto] ${arm} 副本: ${dataDir}`);
    const outFile = path.join(OUT_DIR, `${arm}-p${START}-${END}-k${K}.json`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'prototype/compare.mjs', `--arm=${arm}`, `--project=${PROJECT_ID}`, `--start=${START}`, `--end=${END}`, `--k=${K}`], { cwd: process.cwd(), env: { ...process.env, DATA_DIR: dataDir, ARM_OUT: outFile }, stdio: 'inherit' });
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${arm} 子进程退出码 ${code}`))));
    });
    results[arm] = JSON.parse(await readFile(outFile, 'utf8'));
    if (!KEEP) await rm(dataDir, { recursive: true, force: true });
  }
  compare(results);
}

function compare(results) {
  const a = results.serial; const b = results.concurrent;
  const sum = rows => rows.filter(r => !r.skip).reduce((x, r) => x + r.ms, 0);
  console.log('\n==================== 对比 ====================');
  if (a) console.log(`串行：wall ${(a.wallMs / 1000).toFixed(1)}s，页耗时合计 ${(sum(a.rows) / 1000).toFixed(1)}s，tokens=prompt ${a.rows.reduce((x, r) => x + (r.promptTokens || 0), 0)} / completion ${a.rows.reduce((x, r) => x + (r.completionTokens || 0), 0)} / reasoning ${a.rows.reduce((x, r) => x + (r.reasoningTokens || 0), 0)}`);
  if (b) console.log(`并发：wall ${(b.wallMs / 1000).toFixed(1)}s，页耗时合计 ${(sum(b.rows) / 1000).toFixed(1)}s（膨胀 ${(sum(b.rows) / b.wallMs).toFixed(2)}x），tokens=prompt ${b.rows.reduce((x, r) => x + (r.promptTokens || 0), 0)} / completion ${b.rows.reduce((x, r) => x + (r.completionTokens || 0), 0)} / reasoning ${b.rows.reduce((x, r) => x + (r.reasoningTokens || 0), 0)}`);
  if (a && b) {
    console.log(`提速：${(a.wallMs / b.wallMs).toFixed(2)}x`);
    const byPage = new Map(b.rows.map(r => [r.page, r]));
    console.log('\n#\t串行s\t并发s\tmissed\tprevRef\tconflicts');
    for (const r of a.rows) {
      const c = byPage.get(r.page);
      console.log([r.page, r.skip ? 'skip' : (r.ms / 1000).toFixed(1), !c || c.skip ? 'skip' : (c.ms / 1000).toFixed(1), c?.missed ?? '-', c?.prevRef ?? '-', c?.conflicts ? c.conflicts.map(x => x.type).join(',') : '-'].join('\t'));
    }
  }
  if (b) {
    const byType = {};
    for (const c of b.conflicts) byType[c.type] = (byType[c.type] || 0) + 1;
    console.log(`\n冲突统计（并发臂）：${Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(' | ') || '无'}`);
    for (const type of Object.keys(byType)) for (const c of b.conflicts.filter(x => x.type === type).slice(0, 4)) console.log(`  ${type} P${c.page} ${JSON.stringify(c)}`);
  }
  if (a && b) {
    console.log('\n状态对比：');
    console.log(`  memory：串行 ${a.state.memory.length} 字 | 并发 ${b.state.memory.length} 字`);
    const idA = new Map(a.state.characters.map(c => [c.id, c])); const idB = new Map(b.state.characters.map(c => [c.id, c]));
    console.log(`  characters：串行 ${idA.size} | 并发 ${idB.size}；仅串行 [${[...idA.keys()].filter(k => !idB.has(k)).join(', ')}]；仅并发 [${[...idB.keys()].filter(k => !idA.has(k)).join(', ')}]`);
    const renamed = [...idA.keys()].filter(k => idB.has(k) && idA.get(k).name !== idB.get(k).name).map(k => `${k}:${idA.get(k).name}≠${idB.get(k).name}`);
    if (renamed.length) console.log(`  同名 id 名称不同：${renamed.join(' | ')}`);
    const relA = new Map(a.state.relations.map(r => [r.key, r])); const relB = new Map(b.state.relations.map(r => [r.key, r]));
    console.log(`  relations：串行 ${relA.size} | 并发 ${relB.size}；仅串行 ${relA.size - [...relB.keys()].filter(k => relA.has(k)).length} 条，仅并发 ${relB.size - [...relA.keys()].filter(k => relB.has(k)).length} 条`);
    for (const k of [...relA.keys()].filter(k => relB.has(k) && relA.get(k).label !== relB.get(k).label)) console.log(`  label 不同：${relA.get(k).label} → ${relB.get(k).label}`);
    console.log(`  stages：串行 [${a.state.stages.map(s => `P${s.from} ${s.title}`).join(' | ')}] | 并发 [${b.state.stages.map(s => `P${s.from} ${s.title}`).join(' | ')}]`);
    const lens = p => p.state.pages.filter(x => x.summaryLength !== null).map(x => `P${x.n}:${x.summaryLength}`).join(' ');
    console.log(`  每页摘要长度：\n    串行 ${lens(a)}\n    并发 ${lens(b)}`);
  }
}

const arm = flag('arm', null);
const compareOnly = argv.includes('--compare-only');
if (arm) await runArm(arm);
else if (compareOnly) {
  const results = {};
  for (const name of ARMS) results[name] = JSON.parse(await readFile(path.join(OUT_DIR, `${name}-p${START}-${END}-k${K}.json`), 'utf8'));
  compare(results);
} else await orchestrate();
