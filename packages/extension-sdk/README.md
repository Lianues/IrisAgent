# @iris/extension-sdk

Iris extension 公共 SDK。

目标：

1. 给平台 extension / 插件提供稳定的公共接口。
2. 避免 extension 直接 import 宿主仓库内部的 `src/**`。
3. 让 extension 可以在独立仓库中维护自己的 `package.json`、锁文件和第三方依赖。

## 当前导出内容

- extension manifest 类型
- 平台工厂上下文类型
- Backend 公共接口类型
- `PlatformAdapter`
- `splitText`
- `createExtensionLogger`
- pairing 公共模块

## 建议用法

```ts
import {
  PlatformAdapter,
  createExtensionLogger,
  getPlatformConfig,
  type IrisBackendLike,
  type IrisPlatformFactoryContextLike,
  type ToolAttachment,
} from '@iris/extension-sdk';

import { PairingGuard, PairingStore, type PairingConfig } from '@iris/extension-sdk/pairing';
```

## 约束

extension 不应再直接依赖宿主仓库内部路径，例如：

- `../../../src/core/backend`
- `../../../src/types`
- `../../../src/platforms/pairing`
- `../../logger`
- `../base`

extension 自己使用的第三方库，应当写在 extension 自己的 `package.json` 中。
