@echo off
title 节点编辑工作流 v0.1 - 开发模式（热更新）

cd /d "%~dp0"

REM ============================================
REM   开发模式：vite dev server（改代码立即生效）
REM   注意：dev server 重启后，已打开的页面会失去响应，
REM         刷新浏览器即可；日常使用请用 start.bat
REM ============================================

netstat -ano | findstr ":5173" | findstr "LISTENING" >nul
if not errorlevel 1 goto :portBusy

set "NODE_EXE="
if exist "runtime\node\node.exe" set "NODE_EXE=%~dp0runtime\node\node.exe"
if defined NODE_EXE goto :start
where node >nul 2>nul
if not errorlevel 1 goto :useSystem
goto :noNode

:useSystem
echo [提示] 未找到内置 Node 运行时，使用系统 Node。
set "NODE_EXE=node"

:start
echo ============================================
echo   节点编辑工作流 v0.1  [开发模式]
echo ============================================
echo [信息] 热更新地址: http://localhost:5173
echo [信息] 关闭本窗口即停止服务。
echo.
"%NODE_EXE%" "node_modules\vite\bin\vite.js" --port 5173 --open
if errorlevel 1 goto :fail
pause
exit /b 0

:portBusy
echo [错误] 端口 5173 已被占用，请先关闭正在运行的实例。
pause
exit /b 1

:noNode
echo [错误] 未检测到 Node.js，请安装 Node.js 18+ 或使用 runtime 目录内的 Node。
pause
exit /b 1

:fail
echo [错误] 启动失败，请检查上方信息。
pause
exit /b 1
