@echo off
chcp 65001 >nul 2>&1
title Iris Update

echo ============================================
echo          Iris Update
echo ============================================
echo.

REM 获取脚本所在目录
set "SCRIPT_DIR=%~dp0"

REM 加载环境变量
call "%SCRIPT_DIR%scripts\env.bat"

REM 切换到项目根目录
pushd "%PROJECT_ROOT%"

REM ---- 步骤 1: 记录当前版本，拉取最新代码 ----
for /f %%i in ('git rev-parse HEAD') do set "OLD_HEAD=%%i"

echo [update] Pulling latest code...
git pull
if %errorlevel% neq 0 (
    echo [update] ERROR: git pull failed.
    popd
    pause
    exit /b 1
)

for /f %%i in ('git rev-parse HEAD') do set "NEW_HEAD=%%i"

if "%OLD_HEAD%"=="%NEW_HEAD%" (
    echo [update] Already up to date.
    popd
    goto :start
)

echo [update] New version detected, updating...
echo          %OLD_HEAD:~0,8% -^> %NEW_HEAD:~0,8%
echo.

REM ---- 步骤 2: 安装依赖 ----
echo [update] Installing root dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [update] ERROR: root npm install failed.
    popd
    pause
    exit /b 1
)

echo [update] Installing web-ui dependencies...
pushd src\platforms\web\web-ui
call npm install
if %errorlevel% neq 0 (
    echo [update] ERROR: web-ui npm install failed.
    popd
    popd
    pause
    exit /b 1
)
popd
echo [update] Dependencies installed.
echo.

REM ---- 步骤 3: 重新构建 ----
echo [update] Building project...
call npm run build
if %errorlevel% neq 0 (
    echo [update] ERROR: build failed.
    popd
    pause
    exit /b 1
)
echo [update] Build complete.
echo.

popd

:start
echo ============================================
echo   Starting Iris...
echo ============================================
echo.

REM ---- 步骤 4: 启动应用 ----
call "%SCRIPT_DIR%start.bat"
