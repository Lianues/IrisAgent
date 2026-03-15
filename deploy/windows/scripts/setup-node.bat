@echo off
REM ==========================================
REM  检测/下载 Node.js 便携版
REM ==========================================

call "%~dp0env.bat"

REM 检查 Node.js 是否已存在
if exist "%NODE_DIR%\node.exe" (
    echo [Node.js] Portable Node.js found, skipping download.
    goto :eof
)

echo [Node.js] Node.js not found, downloading portable v%NODE_VERSION%...
echo [Node.js] URL: %NODE_URL%
echo.

REM 创建临时目录
set "TEMP_ZIP=%PROJECT_ROOT%\node-download.zip"

REM 使用 PowerShell 下载
echo [Node.js] Downloading, please wait (~30MB)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
    "try { " ^
    "    $ProgressPreference = 'SilentlyContinue'; " ^
    "    Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%TEMP_ZIP%' -UseBasicParsing; " ^
    "    Write-Host '[Node.js] Download complete.'; " ^
    "} catch { " ^
    "    Write-Host '[Node.js] ERROR: download failed.'; " ^
    "    Write-Host $_.Exception.Message; " ^
    "    exit 1; " ^
    "}"

if %errorlevel% neq 0 (
    echo [Node.js] Download failed. Please check your network.
    if exist "%TEMP_ZIP%" del /f "%TEMP_ZIP%"
    exit /b 1
)

REM 使用 PowerShell 解压
echo [Node.js] Extracting...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { " ^
    "    Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%PROJECT_ROOT%' -Force; " ^
    "    Write-Host '[Node.js] Extraction complete.'; " ^
    "} catch { " ^
    "    Write-Host '[Node.js] ERROR: extraction failed.'; " ^
    "    Write-Host $_.Exception.Message; " ^
    "    exit 1; " ^
    "}"

if %errorlevel% neq 0 (
    echo [Node.js] Extraction failed.
    if exist "%TEMP_ZIP%" del /f "%TEMP_ZIP%"
    exit /b 1
)

REM 重命名解压后的目录为 node/
if exist "%PROJECT_ROOT%\node-v%NODE_VERSION%-win-x64" (
    if exist "%NODE_DIR%" rd /s /q "%NODE_DIR%" >nul 2>&1
    ren "%PROJECT_ROOT%\node-v%NODE_VERSION%-win-x64" node
)

REM 清理临时文件
if exist "%TEMP_ZIP%" del /f "%TEMP_ZIP%"

REM 验证安装
if exist "%NODE_DIR%\node.exe" (
    echo [Node.js] Installation successful!
    "%NODE_DIR%\node.exe" --version
) else (
    echo [Node.js] ERROR: node.exe not found after install.
    echo [Node.js] Please manually download Node.js v%NODE_VERSION% and extract to node/ directory.
    exit /b 1
)
