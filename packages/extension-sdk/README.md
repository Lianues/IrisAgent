# @iris/extension-sdk

Iris extension / plugin 公共 SDK。

目标：

1. 给平台 extension 和插件提供稳定的公共接口。
2. 避免 extension / plugin 直接 import 宿主仓库内部的 `src/**`。
3. 让 extension / plugin 可以在独立仓库中维护自己的 `package.json`、锁文件和第三方依赖。

## 当前导出内容

### 平台 extension API

- extension manifest 类型
- 平台工厂上下文类型
- Backend 公共接口类型
- `PlatformAdapter`
- `splitText`
- `createExtensionLogger`
- `definePlatformFactory`
- `pairing` 公共模块

### 插件 API

- `IrisPlugin`
- `PluginContext`
- `PreBootstrapContext`
- `IrisAPI`
- `PluginHook`
- `PluginLogger`
- `createPluginLogger`
- `definePlugin`
- `ToolDefinition`
- `ModeDefinition`
- `Part` / `Content` / `LLMRequest`

## 建议用法

```ts
import {
  PlatformAdapter,
  createExtensionLogger,
  definePlatformFactory,
  type IrisBackendLike,
  type IrisPlatformFactoryContextLike,
  type ToolAttachment,
} from '@iris/extension-sdk';

import {
  definePlugin,
  createPluginLogger,
  type IrisPlugin,
  type PluginContext,
  type PreBootstrapContext,
} from '@iris/extension-sdk/plugin';

import { PairingGuard, PairingStore, type PairingConfig } from '@iris/extension-sdk/pairing';
```

## 依赖边界

extension / plugin 自己使用的第三方库，应当写在它自己的 `package.json` 中。

例如：

- Telegram extension 依赖 `grammy`
- Discord extension 依赖 `discord.js`
- Lark extension 依赖 `@larksuiteoapi/node-sdk`

这些依赖不应再由宿主根 `package.json` 代替声明。

## node_modules 与锁文件

推荐做法是：

- extension / plugin 在自己的仓库里维护自己的锁文件
- 运行时优先加载 extension 自己目录下的 `node_modules`
- 如果 extension 发布的是自包含的 `dist/index.mjs`，也可以不依赖运行时 `node_modules`

在当前仓库内，为了便于统一开发和测试，可能仍会存在本地安装层面的集中处理；但依赖归属应当属于 extension / plugin 自己，而不是宿主。

## 约束

extension / plugin 不应再直接依赖宿主仓库内部路径，例如：

- `../../../src/core/backend`
- `../../../src/types`
- `../../../src/platforms/pairing`
- `../../logger`
- `../base`
