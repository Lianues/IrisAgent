@echo off
chcp 65001 >nul 2>&1
title Iris 更新

echo ============================================
echo          Iris 更新
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

echo [更新] 正在拉取最新代码...
git pull
if %errorlevel% neq 0 (
    echo [更新] 错误: git pull 失败，请检查网络或手动解决冲突。
    popd
    pause
    exit /b 1
)

for /f %%i in ('git rev-parse HEAD') do set "NEW_HEAD=%%i"

if "%OLD_HEAD%"=="%NEW_HEAD%" (
    echo [更新] 已是最新版本，无需重新构建。
    popd
    goto :start
)

echo [更新] 检测到新版本，开始更新...
echo         %OLD_HEAD:~0,8% → %NEW_HEAD:~0,8%
echo.

REM ---- 步骤 2: 安装依赖 ----
echo [更新] 正在安装根目录依赖...
call npm install
if %errorlevel% neq 0 (
    echo [更新] 错误: 根目录 npm install 失败。
    popd
    pause
    exit /b 1
)

echo [更新] 正在安装 web-ui 依赖...
pushd src\platforms\web\web-ui
call npm install
if %errorlevel% neq 0 (
    echo [更新] 错误: web-ui npm install 失败。
    popd
    popd
    pause
    exit /b 1
)
popd
echo [更新] 依赖安装完成。
echo.

REM ---- 步骤 3: 重新构建 ----
echo [更新] 正在构建项目...
call npm run build
if %errorlevel% neq 0 (
    echo [更新] 错误: 项目构建失败。
    popd
    pause
    exit /b 1
)
echo [更新] 构建完成。
echo.

popd

:start
echo ============================================
echo   正在启动 Iris...
echo ============================================
echo.

REM ---- 步骤 4: 启动应用 ----
call "%SCRIPT_DIR%start.bat"
