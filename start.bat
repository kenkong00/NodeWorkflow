@echo off
title 节点编辑工作流 v0.1 - 启动

cd /d "%~dp0"

REM ============================================
REM   节点编辑工作流 v0.1 启动脚本（生产模式）
REM   流程: 构建 -> 预览服务 -> 自动打开浏览器
REM   使用内置 Node 运行时 (runtime/node)
REM   原因: better-sqlite3 原生模块绑定 Node 22 ABI 127,
REM         系统 Node 24 (ABI 137) 会导致数据库加载失败
REM ============================================

REM ===== 端口占用预检 =====
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul
if not errorlevel 1 goto :portBusy

REM ===== 定位 Node.js =====
set "NODE_EXE="
if exist "runtime\node\node.exe" set "NODE_EXE=%~dp0runtime\node\node.exe"

if defined NODE_EXE goto :nodeReady

where node >nul 2>nul
if not errorlevel 1 goto :useSystemNode

set "NODE_DIR="
if exist "G:\Program Files\nodejs\node.exe" set "NODE_DIR=G:\Program Files\nodejs"
if not defined NODE_DIR if exist "C:\Program Files\nodejs\node.exe" set "NODE_DIR=C:\Program Files\nodejs"
if not defined NODE_DIR if exist "C:\Program Files (x86)\nodejs\node.exe" set "NODE_DIR=C:\Program Files (x86)\nodejs"
if not defined NODE_DIR if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"

if not defined NODE_DIR goto :noNode
set "NODE_EXE=%NODE_DIR%\node.exe"

:useSystemNode
echo [提示] 未找到内置 Node 运行时，使用系统 Node。
echo [警告] 如遇数据库加载失败，请改用 runtime 目录内的 Node。

:nodeReady
echo ============================================
echo   节点编辑工作流 v0.1（ComfyUI 同款操作）
echo ============================================
echo.

if not exist "node_modules" goto :needInstall
if not exist "node_modules\vite\bin\vite.js" goto :needInstall
goto :build

:needInstall
echo [信息] 首次运行，正在安装依赖 (npm install)...
echo.
call "%NODE_EXE%" "runtime\node\npm\bin\npm-cli.js" install
if errorlevel 1 goto :installFail
echo.
echo [信息] 依赖安装完成。
echo.

:build
echo [信息] 正在构建生产版本（约 10 秒）...
echo.
"%NODE_EXE%" "node_modules\vite\bin\vite.js" build
if errorlevel 1 goto :buildFail

echo.
echo [信息] 构建完成，正在启动预览服务...
echo [信息] 浏览器将自动打开: http://localhost:5173
echo [信息] 停止服务请直接关闭本窗口。
echo.

"%NODE_EXE%" "node_modules\vite\bin\vite.js" preview --port 5173 --host 127.0.0.1 --strictPort --open
if errorlevel 1 goto :devFail
pause
exit /b 0

:portBusy
echo [错误] 端口 5173 已被占用。
echo [提示] 请先关闭正在运行的实例窗口，或修改 vite.config.ts 中的端口。
pause
exit /b 1

:noNode
echo [错误] 未检测到 Node.js，请先安装 Node.js 18+ 或使用项目 runtime 目录内的 Node。
pause
exit /b 1

:installFail
echo [错误] 依赖安装失败，请手动执行 npm install 后重试。
pause
exit /b 1

:buildFail
echo [错误] 构建失败，请检查上方错误信息。
pause
exit /b 1

:devFail
echo [错误] 预览服务异常退出。
pause
exit /b 1
