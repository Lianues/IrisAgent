@echo off
chcp 65001 >nul 2>&1
title Iris

echo ============================================
echo          Iris AI 聊天框架
echo ============================================
echo.

REM 获取脚本所在目录
set "SCRIPT_DIR=%~dp0"

REM ---- 步骤 1: 检测/下载 Node.js ----
call "%SCRIPT_DIR%scripts\setup-node.bat"
if %errorlevel% neq 0 (
    echo.
    echo 启动中止：Node.js 安装失败。
    pause
    exit /b 1
)

REM ---- 步骤 2: 安装依赖 + 构建 ----
call "%SCRIPT_DIR%scripts\setup-deps.bat"
if %errorlevel% neq 0 (
    echo.
    echo 启动中止：依赖安装或构建失败。
    pause
    exit /b 1
)

REM ---- 步骤 3: 初始化配置文件 ----
call "%SCRIPT_DIR%scripts\setup-config.bat"
if %errorlevel% neq 0 (
    echo.
    echo 启动中止：配置文件初始化失败。
    pause
    exit /b 1
)

REM ---- 步骤 4: 启动应用 ----
call "%SCRIPT_DIR%scripts\env.bat"

pushd "%PROJECT_ROOT%"

REM 清理残留进程：如果 8192 端口被占用，杀掉旧进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":8192 "') do (
    echo 检测到端口 8192 被占用（PID: %%a），正在清理...
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo ============================================
echo   Iris 已启动！
echo   访问地址: http://localhost:8192
echo   关闭此窗口即可停止服务
echo ============================================
echo.

REM 延迟 2 秒后打开浏览器（后台执行，不阻塞 node 启动）
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8192"

REM 前台运行 node，关闭窗口即终止进程
node dist/index.js

REM 如果 node 异常退出，暂停让用户看到错误信息
if %errorlevel% neq 0 (
    echo.
    echo ================================================================
    echo   Iris 异常退出（错误码: %errorlevel%）
    echo   请检查上方的错误信息
    echo ================================================================
    pause
)

popd
