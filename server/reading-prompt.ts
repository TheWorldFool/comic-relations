import { z } from 'zod';
import { readingSchema, systemPrompt } from './analysis.js';

type MemoryMode = 'delta' | 'checkpoint';
function buildProtocol(mode: MemoryMode) {
  const memoryDescription = mode === 'checkpoint'
    ? '整合前文 memory、全部 memoryState.pending 及本页事件的完整累计摘要，保留身份线索、未兑现承诺和因果；约 2000 汉字，不能只写本页增量。'
    : '只写本页新增的因果事件、动机与线索，不复述旧剧情或未变化档案；没有新增事件可为空字符串。';
  const task = `本页记忆任务：${mode === 'checkpoint' ? '汇总长期记忆' : '记录新增剧情'}。memoryMode 必须为 "${mode}"，由程序指定，不自行选择。memory：${memoryDescription}本页人物、关系与状态仍只返回新增或变化；threadChanges 无变化返回 []，未解线索不因汇总消失。`;
  const schema = readingSchema.extend({
    memoryMode: z.literal(mode),
    memory: (mode === 'checkpoint' ? readingSchema.shape.memory.trim().min(1) : readingSchema.shape.memory).describe(memoryDescription),
    threadChanges: readingSchema.shape.threadChanges.unwrap(),
  });
  const example = {
    kind: 'story', confidence: 0.9, reason: '正文依据', summary: '本页梗概', storyTime: '',
    memory: mode === 'checkpoint' ? '旧摘要、待汇总事件与本页事件整合后的完整累计记忆' : '本页新增剧情记忆',
    memoryMode: mode, threadChanges: [], turningPoint: null,
    characters: [{ id: 'c1', name: '人物名', aliases: [], description: '外貌与身份', appearance: '稳定辨认特征', nameType: 'named', presence: 'visible', sameAs: null, avatarBox: null, profileUpdates: [], statusChanges: [] }],
    mentions: [], relationChanges: [],
  };
  return {
    task, schema,
    system: `${systemPrompt}\n${task}\n本次输出格式示例（占位文字不可作为剧情事实）：\n${JSON.stringify(example)}\n可处理页面的输出必须符合以下 JSON Schema（不要输出 Schema 本身；无法安全处理时只返回前述 blocked 对象）：${JSON.stringify(z.toJSONSchema(schema))}`,
  };
}

// Task text, example, schema and runtime validation always use the same mode.
const protocols = { delta: buildProtocol('delta'), checkpoint: buildProtocol('checkpoint') };
export const readingProtocol = (mode: MemoryMode) => protocols[mode];
