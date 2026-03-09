# LLM API 调用层

## 职责

调用各 LLM 提供商的 API。自己发 HTTP 请求，不使用官方 SDK。
内部统一使用 Gemini 格式，通过格式适配器做双向转换。

## 模块结构

```
src/llm/
├── formats/                    # 格式转换模块
│   ├── types.ts                # FormatAdapter 接口定义
│   ├── gemini.ts               # Gemini 格式（请求直通，响应提取）
│   ├── openai-compatible.ts    # OpenAI 格式（完整双向转换）
│   └── claude.ts               # Claude 格式（完整双向转换）
├── transport.ts                # HTTP 请求模块（通用 fetch 发送）
├── response.ts                 # 响应后处理（流式 / 非流式统一处理）
├── providers/
│   ├── base.ts                 # LLMProvider 组合器
│   ├── gemini.ts               # createGeminiProvider()
│   ├── openai-compatible.ts    # createOpenAICompatibleProvider()
│   └── claude.ts               # createClaudeProvider()
```

## 核心接口

### FormatAdapter（格式转换）

每个渠道格式实现此接口，负责 Gemini ↔ 渠道 API 格式的双向转换：

```typescript
interface FormatAdapter {
  encodeRequest(request: LLMRequest, stream?: boolean): unknown;
  decodeResponse(raw: unknown): LLMResponse;
  decodeStreamChunk(raw: unknown, state: StreamDecodeState): LLMStreamChunk;
  createStreamState(): StreamDecodeState;
}
```

### EndpointConfig（HTTP 传输）

```typescript
interface EndpointConfig {
  url: string;           // 非流式 URL
  streamUrl?: string;    // 流式 URL（默认同 url）
  headers: Record<string, string>;
}
```

### LLMProvider（组合器）

```typescript
class LLMProvider {
  constructor(format: FormatAdapter, endpoint: EndpointConfig, name?: string);
  chat(request: LLMRequest): Promise<LLMResponse>;
  chatStream(request: LLMRequest): AsyncGenerator<LLMStreamChunk>;
}
```

## 数据流向

```
LLMRequest (Gemini 格式)
  │
  ▼
[FormatAdapter.encodeRequest]  → 渠道请求体
  │
  ▼
[transport.sendRequest]        → HTTP 发送，获取 Response
  │
  ├─ 非流式 → [response.processResponse]       → FormatAdapter.decodeResponse       → LLMResponse
  └─ 流式   → [response.processStreamResponse]  → SSE 解析 + FormatAdapter.decodeStreamChunk → LLMStreamChunk…
```

## 新增渠道步骤

1. 在 `formats/` 下新建文件，实现 `FormatAdapter` 接口
2. 在 `providers/` 下新建文件，写工厂函数（配置 URL + headers + 选哪个 format）
3. 在 `src/config/types.ts` 和 `src/index.ts` 中加一个 case
4. 在 `src/config/llm.ts` 的 `DEFAULTS` 和 `web-ui/src/components/SettingsPanel.vue` 的 `PROVIDER_DEFAULTS` 中添加默认 model/baseUrl（前端切换 provider 时自动填充）

不需要碰 transport.ts 和 response.ts。

## 格式转换对照表

### OpenAI

| Gemini 格式 | OpenAI 格式 |
|---|---|
| `systemInstruction.parts[].text` | `messages[0] = {role:"system", content:"..."}` |
| `Content{role:"user", parts:[{text}]}` | `{role:"user", content:"..."}` |
| `Content{role:"model", parts:[{text}]}` | `{role:"assistant", content:"..."}` |
| `Content{role:"model", parts:[{functionCall}]}` | `{role:"assistant", tool_calls:[...]}` |
| `Content{role:"user", parts:[{functionResponse}]}` | `{role:"tool", tool_call_id:"...", content:"..."}` |
| `tools[].functionDeclarations[]` | `tools[].{type:"function", function:{...}}` |

### Claude

| Gemini 格式 | Claude 格式 |
|---|---|
| `systemInstruction.parts[].text` | `system: "..."` （顶层字段，非 message） |
| `Content{role:"user", parts:[{text}]}` | `{role:"user", content:[{type:"text", text:"..."}]}` |
| `Content{role:"model", parts:[{text}]}` | `{role:"assistant", content:[{type:"text", text:"..."}]}` |
| `Content{role:"model", parts:[{functionCall}]}` | `{role:"assistant", content:[{type:"tool_use", id, name, input}]}` |
| `Content{role:"user", parts:[{functionResponse}]}` | `{role:"user", content:[{type:"tool_result", tool_use_id, content}]}` |
| `tools[].functionDeclarations[]` | `tools[].{name, description, input_schema}` |

## 注意事项

- OpenAI/Claude 的 tool_call 有 ID，Gemini 没有。转换时需生成/匹配 ID。
- Gemini 格式请求直通，无需转换。
- Gemini 流式使用不同 URL (`streamGenerateContent?alt=sse`)，OpenAI/Claude 用同一 URL 加 `stream:true` 参数。
- OpenAI 流式中工具调用参数分片到达，通过 StreamDecodeState 累积。
- Claude 的 `stop_reason` 映射：`tool_use` → 有工具调用，`end_turn` → 正常结束。
- 支持 Gemini 的 `thoughtSignature` 字段，流式接收后附加到 text part 和 function call parts。
