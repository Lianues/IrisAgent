# Iris Terminal

Iris 的终端命令界面集合，使用 [OpenTUI](https://opentui.com/) + React 构建。

当前已实现的命令界面：

- `onboard`：交互式配置引导
- `platforms`：平台配置界面
- `models`：模型配置界面
- `extension`：插件安装与管理界面

### 共享包依赖

Terminal 通过 `@iris/extension-utils`（`packages/extension-utils/`）与 core 共享 extension 系统的基础工具函数（路径处理、manifest 解析、远程仓库操作、运行时入口分析等），避免重复实现。bun build 时会自动内联该包。

目录约定：

```txt
terminal/
  src/
    commands/
      onboard/
      platforms/
      models/
      extension/
    shared/
```

其中：

- `commands/<name>/` 按终端命令名称组织界面代码
- `shared/` 放命令之间复用的运行时与公共部件
- 默认入口仍然是 `onboard`，因此 `iris onboard` 行为保持不变

## 开发

```bash
bun install

# 默认进入 onboard
bun run dev

# 显式指定命令
bun run dev:onboard
bun run dev -- platforms
bun run dev -- models
bun run dev -- extension
```

## 构建

```bash
bun run build
```

## 当前命令

### onboard

```bash
iris onboard
./iris-onboard onboard /path/to/iris
```

### platforms

```bash
iris platforms
./iris-onboard platforms /path/to/iris
```

`platforms` 会读取内置平台和当前可用 extension 的 `manifest.json`，根据其中的 `platforms[].panel` 声明生成平台参数输入界面，并只修改 `platform.yaml` 中的平台相关配置。

### models

```bash
iris models
./iris-onboard models /path/to/iris
```

`models` 会先读取 `llm.yaml` 中已配置的模型列表，让用户选择一个模型条目，再复用共享模型面板生成模型 ID / 模型别名输入界面。确认后只更新 `llm.yaml` 中所选模型条目，不修改平台配置。

### extension

```bash
iris extension
./iris-onboard extension /path/to/iris
```

`extension` 会先显示“下载插件”和“管理插件”两个入口：

- `下载插件`：先读取远程仓库的 `extensions/index.json`，再按各扩展目录自己的 `manifest.json` 读取类型、名称、描述和安装状态，最后只下载所选 extension 文件夹。
- `下载插件` 会兼容当前安装目录中的内嵌 extension，并在存在同名本地版本时提示“本地已有版本 xx”。
- `管理插件`：查看 `~/.iris/extensions/` 中已安装的 extension，并执行开启、关闭、删除。运行时同名优先级为：`~/.iris/extensions/` 已安装版本 > 安装目录内嵌版本。
