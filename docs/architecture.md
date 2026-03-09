# AI Chat 架构文档

## 概述

这是一个模块化、可解耦的 AI 聊天框架。各层通过明确的接口通信，内部统一使用 **Gemini Content 格式** 作为数据标准。

## 架构分层

```
src/
├── types/          公共类型定义（所有模块共享）
├── platforms/      用户交互层：接收用户消息、发送 AI 回复
├── llm/            LLM API 调用层：自己发包，不使用官方 SDK
├── storage/        聊天记录存储层：以 Gemini 格式存取历史
├── memory/         长期记忆层：跨会话记忆持久化 + 全文检索
├── tools/          工具注册层：管理 LLM 可调用的工具
├── prompt/         提示词组装层：拼装完整的 LLM 请求
├── core/           核心协调器：串联各模块，编排流程
├── logger/         日志模块：统一日志输出
└── config/         配置加载
```

## 数据流向

```
用户输入
  │
  ▼
[Platform]  ── 接收消息，转为 IncomingMessage { sessionId, parts }
  │
  ▼
[Orchestrator]
  │
  ├─→ [Storage]  ── 存储用户消息，读取历史
  ├─→ [Memory]   ── 搜索相关记忆，注入系统提示词（可选）
  ├─→ [Prompt]   ── 组装 LLMRequest（历史 + 系统提示词 + 记忆 + 工具声明）
  ├─→ [LLM]      ── 发送请求，获取模型回复（流式/非流式）
  ├─→ [Tools]    ── 若模型返回 functionCall，执行工具，结果存储后重复上述流程
  │
  ▼
[Platform]  ── 将最终文本回复发送给用户（流式逐块输出或一次性发送）
```

## 内部数据格式（Gemini Content）

所有模块之间传递的消息均使用此格式：

```typescript
interface Content {
  role: 'user' | 'model';
  parts: Part[];  // TextPart | InlineDataPart | FunctionCallPart | FunctionResponsePart
  usageMetadata?: UsageMetadata;  // 仅存储用，不发送给 LLM
}
```

一次完整的工具调用循环在存储中的样子：

```json
[
  { "role": "user",  "parts": [{ "text": "现在几点？" }] },
  { "role": "model", "parts": [{ "functionCall": { "name": "get_current_time", "args": {} } }] },
  { "role": "user",  "parts": [{ "functionResponse": { "name": "get_current_time", "response": { "result": { "local": "2024/12/1 14:30:00" } } } }] },
  { "role": "model", "parts": [{ "text": "现在是 14:30。" }] }
]
```

## 模块通信规则

1. 模块之间通过 **抽象基类** 与 **类型接口** 通信，不直接依赖具体实现
2. 新增实现时，只需继承基类并在 `src/index.ts` 中注册
3. 各模块的接口详见 `docs/` 目录下的对应文档

## 快速开始

```bash
npm run setup    # 安装依赖（根目录 + web-ui）
cp config.example.yaml config.yaml
# 编辑 config.yaml 填入 API Key
npm run dev      # 开发模式
```

## 文档索引

| 文档 | 说明 |
|------|------|
| [architecture.md](./architecture.md) | 全局架构（本文件） |
| [core.md](./core.md) | 核心协调器 |
| [platforms.md](./platforms.md) | 用户交互层 |
| [llm.md](./llm.md) | LLM API 调用层 |
| [storage.md](./storage.md) | 聊天记录存储层 |
| [memory.md](./memory.md) | 长期记忆系统 |
| [tools.md](./tools.md) | 工具注册层 |
| [prompt.md](./prompt.md) | 提示词组装层 |
| [logger.md](./logger.md) | 日志模块 |
| [config.md](./config.md) | 配置模块 |
| [deploy.md](./deploy.md) | VPS 部署指南 |

## 自我升级指南（供 AI 阅读）

如果你是 AI 并且需要修改此项目：

1. 先读本文件了解整体架构
2. 再读 `docs/` 下目标模块的文档了解接口约定
3. 读 `src/types/` 了解数据格式
4. 修改或新增模块时，遵循现有的基类和类型约束
5. 如需修改核心流程，读 `docs/core.md`
