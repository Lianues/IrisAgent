/**
 * ssh-config.ts
 *
 * 解析 VSCode SSH config 风格的服务器清单文件。
 * 在标准 ssh_config 字段基础上额外支持 `Password` 字段（remote-exec 扩展）。
 *
 * 语法：
 *   - 以 `Host <alias>` 开始一个块；遇到下一个 Host 或文件结束时该块结束
 *   - 块内字段为 `Key Value`，可缩进可不缩进
 *   - `#` 开头为注释（整行）
 *   - 字段名大小写不敏感
 */

export interface ServerEntry {
  /** Host 别名（remote_exec.yaml 中通过此名引用） */
  host: string;
  hostName: string;
  port: number;
  user?: string;
  identityFile?: string;
  /** 明文密码（可选，与 identityFile 二选一） */
  password?: string;
  /** 该服务器上的默认工作目录（覆盖 remote_exec.yaml 的 remoteWorkdir） */
  workdir?: string;
  /** 该环境的人类可读描述（switch_environment 工具会展示给 AI） */
  description?: string;
  /** 传输策略：auto（默认）/ sftp / bash */
  transport?: 'auto' | 'sftp' | 'bash';
}

export function parseServersFile(text: string): Map<string, ServerEntry> {
  const result = new Map<string, ServerEntry>();
  let current: Partial<ServerEntry> | null = null;

  const flush = () => {
    if (!current || !current.host) return;
    if (!current.hostName) {
      // 没有 HostName 的块视为无效（默认行为：fallback 到 host 字面量本身）
      current.hostName = current.host;
    }
    result.set(current.host, {
      host: current.host,
      hostName: current.hostName!,
      port: current.port ?? 22,
      user: current.user,
      identityFile: current.identityFile,
      password: current.password,
      workdir: current.workdir,
      description: current.description,
      transport: current.transport,
    });
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // 形如 `Key Value`，按第一个空白拆分
    const m = line.match(/^(\S+)\s+(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    if (key === 'host') {
      flush();
      current = { host: value };
      continue;
    }
    if (!current) continue;

    switch (key) {
      case 'hostname':
        current.hostName = value;
        break;
      case 'port': {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n) && n > 0) current.port = n;
        break;
      }
      case 'user':
        current.user = value;
        break;
      case 'identityfile':
        current.identityFile = stripQuotes(value);
        break;
      case 'password':
        current.password = stripQuotes(value);
        break;
      case 'workdir':
        current.workdir = stripQuotes(value);
        break;
      case 'description':
        current.description = stripQuotes(value);
        break;
      case 'transport': {
        const v = stripQuotes(value).toLowerCase();
        if (v === 'auto' || v === 'sftp' || v === 'bash') current.transport = v;
        break;
      }
      default:
        // 未识别字段忽略，保持向前兼容
        break;
    }
  }
  flush();
  return result;
}

function stripQuotes(v: string): string {
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return v.slice(1, -1);
    }
  }
  return v;
}
