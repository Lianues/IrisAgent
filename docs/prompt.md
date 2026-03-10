# 提示词组装层

## 职责

将系统提示词、聊天历史、工具声明、生成配置组装为完整的 LLMRequest。
支持动态插入提示词片段，支持 per-request 额外上下文注入（如记忆）。

## 文件结构

```
src/prompt/
├── assembler.ts          PromptAssembler 组装器
└── templates/
    └── default.ts        默认提示词模板
```

## PromptAssembler 接口

```typescript
class PromptAssembler {
  // 设置系统提示词（替换全部）
  setSystemPrompt(text: string): void;

  // 追加系统提示词片段（可用于注入时间、用户信息等动态内容）
  addSystemPart(part: Part): void;

  // 移除指定的系统提示词片段（按引用匹配）
  removeSystemPart(part: Part): void;

  // 清空系统提示词
  clearSystemParts(): void;

  // 设置默认生成配置
  setGenerationConfig(config: LLMRequest['generationConfig']): void;

  // 组装完整的 LLMRequest
  assemble(
    history: Content[],
    toolDecls?: FunctionDeclaration[],
    overrides?: LLMRequest['generationConfig'],
    extraParts?: Part[],    // per-request 额外系统提示词（如记忆上下文）
  ): LLMRequest;
}
```

## extraParts 参数

`assemble()` 的第四个参数 `extraParts` 用于按请求注入额外上下文（如记忆），不修改共享的 `systemParts`。

实际效果：`systemInstruction.parts = [...systemParts, ...extraParts]`

这种设计确保多会话并发时不会互相污染系统提示词。

## 组装行为

- `usageMetadata` 在组装时被剥离（仅存储用，不发送给 LLM）
- 工具声明为空数组时不添加 `tools` 字段
- 生成配置：`overrides` 优先于 `generationConfig` 默认值

## 组装结果示例

```json
{
  "systemInstruction": {
    "parts": [
      { "text": "你是一个有用的 AI 助手..." },
      { "text": "\n\n## 长期记忆\n- [preference] 用户喜欢简洁回答" }
    ]
  },
  "contents": [
    { "role": "user", "parts": [{ "text": "你好" }] },
    { "role": "model", "parts": [{ "text": "你好！" }] }
  ],
  "tools": [{
    "functionDeclarations": [
      { "name": "get_current_time", "description": "..." }
    ]
  }],
  "generationConfig": {
    "temperature": 0.7
  }
}
```

## 扩展指南

- 添加新模板：在 `src/prompt/templates/` 目录下创建新文件，导出字符串或函数
- 动态提示词：用 `addSystemPart()` 在运行时添加上下文信息
- 如需更复杂的提示词逻辑，可继承 PromptAssembler 覆写 assemble 方法
