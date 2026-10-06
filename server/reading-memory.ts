import type { Project, ReadingMemory } from '../shared/types.js';
import type { Reading } from './analysis.js';

// Checkpoints bound repeated input/output; unresolved threads live independently
// and can only be removed by an explicit, validated resolution.
const checkpointInterval = 6;
const pendingCharacterLimit = 6000;
export function memoryPlan(project: Project): 'delta' | 'checkpoint' {
  const pending = project.readingMemory?.pending || [];
  return pending.length >= checkpointInterval - 1 || pending.reduce((n, entry) => n + entry.text.length, 0) >= pendingCharacterLimit
    ? 'checkpoint' : 'delta';
}

export function memoryIssue(project: Project, reading: Reading): string | undefined {
  // Old saved projects, integrations and model outputs still use full memory.
  if (reading.memoryMode === 'delta' && memoryPlan(project) === 'checkpoint') return 'memoryMode: 本页要求 checkpoint，请整合旧摘要、pending 及本页事件，不能仅返回增量';
  const seen = new Set<string>();
  const known = new Set(project.readingMemory?.threads.map(thread => thread.id) || []);
  for (const change of reading.threadChanges || []) {
    if (seen.has(change.id)) return `threadChanges: 重复线索 ID ${change.id}`;
    seen.add(change.id);
    if (change.action === 'resolve' && !known.has(change.id)) return `threadChanges: 不能解决未知线索 ${change.id}`;
  }
}

export function applyMemory(project: Project, reading: Reading, page: number) {
  const state: ReadingMemory = project.readingMemory ||= { version: 1, checkpointPage: project.processed, pending: [], threads: [] };
  if (reading.memoryMode === 'delta') {
    state.pending.push({ page, text: reading.memory });
  } else {
    project.memory = reading.memory;
    state.checkpointPage = page;
    state.pending = [];
  }
  for (const change of reading.threadChanges || []) {
    const index = state.threads.findIndex(thread => thread.id === change.id);
    if (change.action === 'resolve') state.threads.splice(index, 1);
    else {
      const next = { id: change.id, text: change.text, sincePage: page };
      if (index < 0) state.threads.push(next); else state.threads[index] = next;
    }
  }
}
