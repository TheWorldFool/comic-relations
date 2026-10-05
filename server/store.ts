import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../shared/types.js';
export const dataDir = path.resolve(process.env.DATA_DIR || 'data');
export const projectsDir = path.join(dataDir, 'projects');
await mkdir(projectsDir, { recursive: true });
export function projectDir(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效项目 ID'); return path.join(projectsDir, id); }
export async function readProject(id: string): Promise<Project> { return JSON.parse(await readFile(path.join(projectDir(id), 'project.json'), 'utf8')); }
export async function saveProject(project: Project) {
  project.updatedAt = new Date().toISOString();
  const dir = projectDir(project.id); await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, 'project.json.tmp');
  await writeFile(tmp, JSON.stringify(project, null, 2)); await rename(tmp, path.join(dir, 'project.json'));
}
export async function listProjects() {
  const entries = await readdir(projectsDir, { withFileTypes: true });
  const projects = await Promise.all(entries.filter(e => e.isDirectory()).map(e => readProject(e.name).catch(() => null)));
  return projects.filter((p): p is Project => !!p).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
