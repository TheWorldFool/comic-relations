import { readingSchema } from './analysis.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function numberString(value: unknown): unknown {
  // Do not turn null, booleans, blanks or percent scales into invented confidence.
  if (typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) return Number(value);
  return value;
}

export function parseReadingOutput(input: unknown) {
  const output = structuredClone(input);
  const adjustments: string[] = [];
  if (record(output)) {
    output.confidence = numberString(output.confidence);
    if (output.storyTime == null) { output.storyTime = ''; adjustments.push('storyTime: 未提供时间'); }
    if (Array.isArray(output.characters)) {
      output.characters.forEach((person, i) => {
        if (!record(person)) return;
        if (person.aliases == null) { person.aliases = []; adjustments.push(`characters.${i}.aliases: 无别名`); }
        if (record(person.avatarBox)) {
          for (const key of ['x','y','width','height']) person.avatarBox[key] = numberString(person.avatarBox[key]);
        }
        const parsedBox = readingSchema.shape.characters.element.shape.avatarBox.safeParse(person.avatarBox);
        if (!parsedBox.success || (parsedBox.data && (parsedBox.data.x + parsedBox.data.width > 1 || parsedBox.data.y + parsedBox.data.height > 1))) {
          // An unusable optional portrait must not discard a valid story/relationship.
          person.avatarBox = null;
          adjustments.push(`characters.${i}.avatarBox: 无有效头像框，留待手动裁剪`);
        }
      });
    }
    if (Array.isArray(output.relationChanges)) {
      for (const change of output.relationChanges) if (record(change) && ['true','false'].includes(String(change.directed)) && typeof change.directed === 'string') change.directed = change.directed === 'true';
    }
  }
  const parsed = readingSchema.safeParse(output);
  return { parsed, adjustments };
}

export function describeReadingIssues(issues: {path: PropertyKey[]; message:string}[]) {
  return issues.slice(0,8).map(issue => `${issue.path.join('.') || '$'}: ${issue.message}`).join('；');
}

export class ReadingOutputError extends Error {
  constructor(public readonly detail: string) {
    super(`模型输出自动修正后仍不合格：${detail}。本页未提交，已保留进度；可继续重试。`);
    this.name = 'ReadingOutputError';
  }
}

export class ModelRefusalError extends Error {
  constructor() {
    super('模型无法按非露骨方式处理本页，阅读已暂停。可排除此页或使用适合的素材；指定“正文”不能解除模型的内容限制。');
    this.name = 'ModelRefusalError';
  }
}

export function isModelRefusal(output: unknown): boolean {
  const refusalText = (text: unknown) => typeof text === 'string' && (/^(?:抱歉|对不起|很抱歉|sorry\b|i (?:cannot|can.t|am unable))/i.test(text.trim()) || /(?:无法|不能|不予|拒绝)[\s\S]{0,50}(?:处理|解读|分析|概述|提供|提取)/.test(text));
  if (typeof output === 'string') return refusalText(output);
  if (!record(output)) return false;
  if (['blocked','refused'].includes(String(output.status)) || output.kind === 'blocked' || output.blocked === true || typeof output.refusal === 'string') return true;
  return output.kind === 'uncertain' && refusalText(output.reason) && typeof output.reason === 'string' && /(?:内容限制|安全|政策|性内容|露骨|未成年|拒绝|不予|不对该类内容)/.test(output.reason);
}
