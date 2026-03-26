#!/usr/bin/env bun

/**
 * Iris npm 发布脚本
 *
 * 将 dist/bin/ 下构建好的平台二进制包和包装器包发布到 npm。
 *
 * 产物结构：
 *   dist/bin/irisagent-linux-x64/      → npm publish (平台包)
 *   dist/bin/irisagent-darwin-arm64/   → npm publish (平台包)
 *   dist/bin/irisagent-windows-x64/    → npm publish (平台包)
 *   dist/bin/irisagent/             → npm publish (包装器包)
 *
 * 用法：
 *   bun run script/publish.ts
 *   bun run script/publish.ts --tag preview
 */

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
process.chdir(dir)

const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))

// 解析 --tag 参数
const tagIndex = process.argv.indexOf("--tag")
const tag = tagIndex >= 0 && process.argv[tagIndex + 1] ? process.argv[tagIndex + 1] : "latest"
const wrapperName = "irisagent"

// 收集已构建的平台二进制
const distBinDir = path.join(dir, "dist", "bin")
const binaries: Record<string, string> = {}

for (const entry of fs.readdirSync(distBinDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pkgJsonPath = path.join(distBinDir, entry.name, "package.json")
  if (!fs.existsSync(pkgJsonPath)) continue
  const p = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"))
  if (p.name && p.version && p.name !== wrapperName && p.name.startsWith("irisagent-")) {
    binaries[p.name] = p.version
  }
}

if (Object.keys(binaries).length === 0) {
  console.error("未找到已构建的平台二进制包。请先运行 bun run build:compile")
  process.exit(1)
}

console.log("待发布的平台包:", binaries)

const version = Object.values(binaries)[0]

// 生成 npm 包装器
const wrapperDir = path.join(distBinDir, wrapperName)
fs.mkdirSync(path.join(wrapperDir, "bin"), { recursive: true })

// 复制 data/ 目录（配置模板和示例文件）
const dataSrc = path.join(dir, "data")
const dataDest = path.join(wrapperDir, "data")
if (fs.existsSync(dataSrc)) {
  fs.cpSync(dataSrc, dataDest, { recursive: true })
}

// 复制启动器脚本
const launcherSrc = path.join(dir, "bin", "iris")
const launcherDest = path.join(wrapperDir, "bin", "iris")
fs.copyFileSync(launcherSrc, launcherDest)

// 复制 postinstall 脚本
const postinstallSrc = path.join(dir, "script", "postinstall.mjs")
const postinstallDest = path.join(wrapperDir, "postinstall.mjs")
fs.copyFileSync(postinstallSrc, postinstallDest)

// 复制 LICENSE（如果存在）
const licensePath = path.join(dir, "LICENSE")
if (fs.existsSync(licensePath)) {
  fs.copyFileSync(licensePath, path.join(wrapperDir, "LICENSE"))
}

// 生成包装器 package.json
fs.writeFileSync(
  path.join(wrapperDir, "package.json"),
  JSON.stringify(
    {
      name: wrapperName,
      version,
      description: pkg.description ?? "Iris AI Agent",
      license: pkg.license ?? "GPL-3.0-only",
      bin: {
        iris: "./bin/iris",
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

console.log(`\n包装器包 ${wrapperName}@${version} 已生成`)

// 发布所有平台包
const publishTasks = Object.keys(binaries).map(async (name) => {
  const pkgDir = path.join(distBinDir, name)
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(pkgDir)
  }
  console.log(`\n发布 ${name}@${binaries[name]}...`)
  await $`npm publish --access public --tag ${tag}`.cwd(pkgDir)
  console.log(`  ✓ ${name} 发布成功`)
})
await Promise.all(publishTasks)

// 发布包装器
console.log(`\n发布 ${wrapperName}@${version}...`)
await $`npm publish --access public --tag ${tag}`.cwd(wrapperDir)
console.log(`  ✓ ${wrapperName} 发布成功`)

console.log("\n=== 全部发布完成 ===")
