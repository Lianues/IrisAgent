@echo off
REM ==========================================
REM  依赖安装 + Web UI 构建
REM ==========================================

call "%~dp0env.bat"

REM 切换到项目根目录
pushd "%PROJECT_ROOT%"

REM 检查根目录 node_modules
if exist "node_modules" (
    echo [deps] Root node_modules found, skipping install.
) else (
    echo [deps] Installing root dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [deps] ERROR: root npm install failed.
        popd
        exit /b 1
    )
)

REM 检查 web-ui node_modules（单独检测，避免根目录已装但 web-ui 未装的情况）
if exist "src\platforms\web\web-ui\node_modules" (
    echo [deps] web-ui node_modules found, skipping install.
) else (
    echo [deps] Installing web-ui dependencies...
    pushd src\platforms\web\web-ui
    call npm install
    if %errorlevel% neq 0 (
        echo [deps] ERROR: web-ui npm install failed.
        popd
        popd
        exit /b 1
    )
    popd
)

echo [deps] Dependency check complete.
echo [build] Building Web UI...
call npm run build:ui
if %errorlevel% neq 0 (
    echo [build] ERROR: Web UI build failed.
    popd
    exit /b 1
)

if not exist "src\platforms\web\web-ui\dist\index.html" (
    echo [build] ERROR: Web UI build artifact src\platforms\web\web-ui\dist\index.html is missing.
    popd
    exit /b 1
)

echo [build] Web UI build complete.
popd
