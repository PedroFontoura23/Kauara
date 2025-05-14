
@echo off
echo ===================================================
echo Firebase Functions Deployment Script
echo ===================================================
echo.

echo Checking if Firebase CLI is installed...
where firebase >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Firebase CLI not found!
    echo Please install Firebase CLI using: npm install -g firebase-tools
    echo Then login using: firebase login
    pause
    exit /b 1
)

echo Firebase CLI found.
echo.

echo Starting deployment of Cloud Functions...
echo.

cd C:\Users\pedro\OneDrive\programas\kauara site\Kauara\functions

echo Kauara Functions
echo.
firebase deploy --only functions

if %errorlevel% neq 0 (
    echo.
    echo ===================================================
    echo ERROR: Deployment failed! See error messages above.
    echo ===================================================
    pause
    exit /b 1
) else (
    echo.
    echo ===================================================
    echo SUCCESS: Functions deployed successfully!
    echo ===================================================
)

pause
exit /b 0