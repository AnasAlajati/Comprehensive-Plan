@echo off
echo ==========================================
echo      UPDATING NASEEJ FACTORY APP
echo ==========================================

echo 1. Pulling latest changes from GitHub...
git pull
IF %ERRORLEVEL% NEQ 0 (
    echo Error pulling from GitHub!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo 2. Installing new dependencies (if any)...
call npm install
IF %ERRORLEVEL% NEQ 0 (
    echo Error installing dependencies!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo 3. Building the application...
call npm run build
IF %ERRORLEVEL% NEQ 0 (
    echo Error building the app!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ==========================================
echo      UPDATE COMPLETE!
echo      The 'dist' folder is now updated.
echo ==========================================
pause
