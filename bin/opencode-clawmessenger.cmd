@echo off
:: Set UTF-8 code page for proper Chinese character display in Windows console
chcp 65001 >nul 2>&1
:: Run the CLI via Node.js
node "%~dp0..\dist\cli.js" %*
