export async function requestApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new Error("暂时无法连接接诊服务，请确认本地服务已启动后重试。");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof result?.error === "string" ? result.error : result?.error?.message;
    throw new Error(
      detail || result?.message || `服务请求失败（${response.status}），请稍后重试。`,
    );
  }
  if (result === null) throw new Error("接诊服务返回了无效数据，请确认后端服务运行正常。");
  return result as T;
}
