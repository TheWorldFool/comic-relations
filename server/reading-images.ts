import sharp from 'sharp';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { projectDir } from './store.js';
import type { Page, Project } from '../shared/types.js';

type Result = { value: string | null; error?: never } | { value?: never; error: unknown };
type Variant = 'page' | 'reference';
export type ImageLoader = (filename: string, variant: Variant | 'avatar') => Promise<string | null>;
const loadImage: ImageLoader = async (filename, variant) => {
  if (variant === 'avatar') {
    const buffer = await readFile(filename).catch(() => null);
    return buffer ? `data:image/jpeg;base64,${buffer.toString('base64')}` : null;
  }
  const size = variant === 'page' ? { width: 2400, height: 4000 } : { width: 1200, height: 1800 };
  const buffer = await sharp(filename).resize({ ...size, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: variant === 'page' ? 88 : 80 }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
};

// One bounded cache per reading job. Prefetch never calls a model, constructs
// future context, edits pages, or shares data with another project's job.
export class ReadingImages {
  private cache = new Map<string, Promise<Result>>();
  private closed = false;
  constructor(private projectId: string, private signal: AbortSignal, private loader: ImageLoader = loadImage) {
    signal.addEventListener('abort', this.close, { once: true });
  }
  close = () => {
    this.closed = true;
    this.cache.clear();
    this.signal.removeEventListener('abort', this.close);
  };
  private async get(filename: string, variant: Variant | 'avatar') {
    this.signal.throwIfAborted();
    if (this.closed) throw new Error('图片准备任务已结束。');
    const key = `${variant}:${filename}`;
    let task = this.cache.get(key);
    if (!task) {
      task = Promise.resolve().then(() => this.loader(filename, variant)).then(
        value => ({ value }), error => ({ error }),
      );
    }
    this.cache.delete(key); this.cache.set(key, task);
    while (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
    const result = await task;
    this.signal.throwIfAborted();
    if ('error' in result) {
      if (this.cache.get(key) === task) this.cache.delete(key);
      throw result.error;
    }
    return result.value;
  }
  page(page: Page, variant: Variant = 'page') {
    return this.get(path.join(projectDir(this.projectId), 'images', `${page.id}.jpg`), variant);
  }
  avatar(url: string) {
    return this.get(path.join(projectDir(this.projectId), 'avatars', path.basename(url)), 'avatar');
  }
  prefetch(project: Project) {
    if (this.closed || this.signal.aborted) return;
    const current = project.pages[project.processed];
    const next = project.pages.slice(project.processed + 1).find(page => page.override !== 'skip');
    // A failed speculative file read is retried only if that page is reached.
    // All promises have rejection handlers, including cancellation during sharp.
    if (current) void this.page(current, 'reference').catch(() => {});
    if (next) void this.page(next).catch(() => {});
  }
}
