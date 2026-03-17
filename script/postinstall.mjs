#!/usr/bin/env node

/**
 * Iris npm postinstall 脚本
 *
 * 在 npm install 完成后自动执行，将当前平台的预编译二进制
 * 硬链接（或复制）到 bin/.iris，供启动器脚本直接调用。
 */

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" }
  const archMap = { x64: "x64", arm64: "arm64", arm: "arm" }

  const platform = platformMap[os.platform()] || os.platform()
  const arch = archMap[os.arch()] || os.arch()
  return { platform, arch }
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch()
  const packageName = `iris-${platform}-${arch}`
  const binaryName = platform === "windows" ? "iris.exe" : "iris"

  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const packageDir = path.dirname(packageJsonPath)
    const binaryPath = path.join(packageDir, "bin", binaryName)

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Binary not found at ${binaryPath}`)
    }

    return { binaryPath, binaryName }
  } catch (error) {
    throw new Error(`Could not find package ${packageName}: ${error.message}`)
  }
}

async function main() {
  try {
    if (os.platform() === "win32") {
      // Windows 下 bin 字段直接指向 .exe，无需额外操作
      console.log("Windows detected: binary setup not needed (using packaged .exe)")
      return
    }

    const { binaryPath } = findBinary()
    const target = path.join(__dirname, "bin", ".iris")

    // 确保 bin 目录存在
    const binDir = path.join(__dirname, "bin")
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true })
    }

    // 移除旧链接
    if (fs.existsSync(target)) fs.unlinkSync(target)

    // 优先硬链接，失败则复制
    try {
      fs.linkSync(binaryPath, target)
    } catch {
      fs.copyFileSync(binaryPath, target)
    }
    fs.chmodSync(target, 0o755)
    console.log(`Iris binary linked: ${target} -> ${binaryPath}`)
  } catch (error) {
    console.error("Failed to setup Iris binary:", error.message)
    // postinstall 失败不应阻塞安装
    process.exit(0)
  }
}

try {
  main()
} catch (error) {
  console.error("Postinstall script error:", error.message)
  process.exit(0)
}
