export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${url}`, { ...options, headers: options.body instanceof FormData ? options.headers : { 'Content-Type':'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。');
  return data;
}
export const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
