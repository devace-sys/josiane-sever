@echo off
echo ========================================
echo Starting Healthcare App Server
echo ========================================
echo.

cd /d "%~dp0"

echo Checking if server is already running...
netstat -an | findstr ":3000" >nul
if %ERRORLEVEL% EQU 0 (
    echo [WARNING] Port 3000 is already in use!
    echo Another process might be using the server port.
    echo.
    echo Press any key to continue anyway, or Ctrl+C to cancel...
    pause
)

echo.
echo Starting server...
echo.
echo IMPORTANT: Keep this window open!
echo The server must be running for the app to work.
echo.
echo Press Ctrl+C to stop the server.
echo.

npm start

pause

