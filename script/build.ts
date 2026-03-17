#!/usr/bin/env bun

/**
 * Iris 全平台编译脚本
 *
 * 使用 bun build --compile 为每个目标平台生成独立可执行文件。
 * 产物内嵌 Bun 运行时 + opentui 原生库 + 全部依赖，无需外部运行时。
 *
 * 用法：
 *   bun run script/build.ts            # 编译所有平台
 *   bun run script/build.ts --single   # 仅编译当前平台
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
const version: string = pkg.version

interface Target {
  os: string
  arch: "x64" | "arm64"
}

const allTargets: Target[] = [
  { os: "linux",  arch: "x64" },
  { os: "linux",  arch: "arm64" },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "win32",  arch: "x64" },
]

const singleFlag = process.argv.includes("--single")
const targets = singleFlag
  ? allTargets.filter(t => t.os === process.platform && t.arch === process.arch)
  : allTargets

if (targets.length === 0) {
  console.error(`当前平台 ${process.platform}-${process.arch} 不在支持的目标列表中`)
  process.exit(1)
}

// 清理旧产物
const distBinDir = path.join(dir, "dist", "bin")
if (fs.existsSync(distBinDir)) {
  fs.rmSync(distBinDir, { recursive: true, force: true })
}

// 确保安装所有平台的 opentui 原生依赖
const opentuiVersion = pkg.optionalDependencies?.["@opentui/core"] ?? "latest"
await $`bun install --os="*" --cpu="*" @opentui/core@${opentuiVersion}`

const binaries: Record<string, string> = {}

for (const item of targets) {
  const platformName = item.os === "win32" ? "windows" : item.os
  const name = `iris-${platformName}-${item.arch}`
  console.log(`\n=== Building ${name} ===`)

  const outDir = path.join(distBinDir, name)
  fs.mkdirSync(path.join(outDir, "bin"), { recursive: true })

  try {
    await Bun.build({
      entrypoints: ["./src/index.ts"],
      compile: {
        target: `bun-${item.os}-${item.arch}` as any,
        outfile: `dist/bin/${name}/bin/iris`,
      },
      define: {
        IRIS_VERSION: `'${version}'`,
      },
    })

    // 生成平台包 package.json
    fs.writeFileSync(
      path.join(outDir, "package.json"),
      JSON.stringify(
        {
          name,
          version,
          description: `Prebuilt ${platformName}-${item.arch} binary for Iris`,
          os: [item.os],
          cpu: [item.arch],
          license: pkg.license ?? "MIT",
        },
        null,
        2,
      ),
    )

    binaries[name] = version
    console.log(`  ✓ ${name} built successfully`)
  } catch (err) {
    console.error(`  ✗ ${name} build failed:`, err)
  }
}

console.log("\n=== Build Summary ===")
for (const [name, ver] of Object.entries(binaries)) {
  console.log(`  ${name}@${ver}`)
}

export { binaries }
