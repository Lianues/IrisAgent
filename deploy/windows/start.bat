@echo off
chcp 65001 >nul 2>&1
title Iris

echo ============================================
echo          Iris AI Framework
echo ============================================
echo.

REM 获取脚本所在目录
set "SCRIPT_DIR=%~dp0"

REM ---- 步骤 1: 检测/下载 Node.js ----
call "%SCRIPT_DIR%scripts\setup-node.bat"
if %errorlevel% neq 0 (
    echo.
    echo Startup aborted: Node.js setup failed.
    pause
    exit /b 1
)

REM ---- 步骤 2: 安装依赖 + 构建 ----
call "%SCRIPT_DIR%scripts\setup-deps.bat"
if %errorlevel% neq 0 (
    echo.
    echo Startup aborted: dependency install or build failed.
    pause
    exit /b 1
)

REM ---- 步骤 3: 初始化配置文件 ----
call "%SCRIPT_DIR%scripts\setup-config.bat"
if %errorlevel% neq 0 (
    echo.
    echo Startup aborted: config initialization failed.
    pause
    exit /b 1
)

REM ---- 步骤 4: 启动应用 ----
call "%SCRIPT_DIR%scripts\env.bat"

pushd "%PROJECT_ROOT%"

REM 清理残留进程：如果 8192 端口被占用，杀掉旧进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":8192 "') do (
    echo Port 8192 in use ^(PID: %%a^), cleaning up...
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo ============================================
echo   Iris is running!
echo   URL: http://localhost:8192
echo   Close this window to stop the server
echo ============================================
echo.

REM 延迟 2 秒后打开浏览器（后台执行，不阻塞启动）
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8192"

REM 前台运行，关闭窗口即终止进程
if not exist "node_modules\tsx\dist\cli.mjs" (
    echo [start] ERROR: node_modules\tsx\dist\cli.mjs not found.
    echo [start] Please run npm install in the project root and try again.
    echo.
    pause
    popd
    exit /b 1
)
node node_modules\tsx\dist\cli.mjs src/index.ts

REM 如果到达这里说明进程已退出，暂停让用户看到信息
echo.
echo ================================================================
echo   Iris has stopped. (exit code: %errorlevel%)
echo ================================================================
pause

popd
