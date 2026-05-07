# Iris v1.0.17 Release Notes

* 修复构建产物缺少 `extensions/embedded.json` 导致 `console` / `web` 等内嵌平台无法注册的问题。
* 修复 Docker production / computer-use 镜像未携带 `extensions/embedded.json`，导致内嵌扩展在容器中被误判为 workspace 扩展的问题。
* 修复编译后二进制加载 `multimodal` 扩展时报 `Cannot find package 'jszip'` 的问题，将文档解析依赖打包进扩展产物。
* 修复编译后二进制加载 `remote-exec` 扩展时报 `Cannot find package 'ssh2'` 的问题，并随扩展产物携带 SSH 相关原生 `.node` 资产。
* 调整内嵌扩展构建流程，统一使用 `outdir` 构建模式，确保额外构建资产会被正确生成和复制。
* 更新内嵌扩展打包产物与 manifest 元数据。
