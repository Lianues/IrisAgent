# Iris v1.0.18 Release Notes

* **remote-exec**：执行环境存储从 agent 级 GlobalStore 迁移到 per-session SessionMeta，解决对话重载后环境回退、跨对话污染等一致性问题。
* **remote-exec**：新增 `onBeforeLLMCall` hook，每轮 LLM 调用前自动从会话元数据预加载当前环境。
* **remote-exec**：`switch_environment` 工具切换后立即写入 session meta（无 debounce 延迟），不再依赖 GlobalStore 的异步持久化。
* **remote-exec**：`/env` 命令适配新架构，有活跃对话时写入 session meta，无活跃对话时写入 agent 级作为新对话默认值。
* **remote-exec**：服务器配置新增 `os` 字段，支持 OS-aware 工具描述。
* **iris**：新增 `iris stop` 命令与干净的 shutdown 信号处理，支持优雅关闭 IPC 服务和后台进程。
* **iris**：修复 Ctrl+C / shutdown 流程中缺少 GlobalStore flush 的问题，确保关键状态在进程退出前落盘。
