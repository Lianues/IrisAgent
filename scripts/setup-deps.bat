@echo off
REM ==========================================
REM  依赖安装 + 项目构建
REM ==========================================

call "%~dp0env.bat"

REM 切换到项目根目录
pushd "%PROJECT_ROOT%"

REM 检查根目录 node_modules
if exist "node_modules" (
    echo [依赖] 已检测到根目录 node_modules，跳过安装。
) else (
    echo [依赖] 正在安装根目录依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [依赖] 错误: 根目录 npm install 失败。
        popd
        exit /b 1
    )
)

REM 检查 web-ui node_modules（单独检测，避免根目录已装但 web-ui 未装的情况）
if exist "web-ui\node_modules" (
    echo [依赖] 已检测到 web-ui node_modules，跳过安装。
) else (
    echo [依赖] 正在安装 web-ui 依赖...
    pushd web-ui
    call npm install
    if %errorlevel% neq 0 (
        echo [依赖] 错误: web-ui npm install 失败。
        popd
        popd
        exit /b 1
    )
    popd
)

echo [依赖] 依赖检查完成。

:check_build
REM 检查是否已构建
if exist "dist\index.js" (
    if exist "web-ui\dist\index.html" (
        echo [构建] 已检测到构建产物，跳过构建。
        popd
        goto :eof
    )
)

echo [构建] 正在构建项目（TypeScript 编译 + Vue 前端构建）...
call npm run build
if %errorlevel% neq 0 (
    echo [构建] 错误: 项目构建失败。
    popd
    exit /b 1
)

echo [构建] 项目构建完成。
popd
