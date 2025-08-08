@echo off
echo Changing directory to Kauara project folder...
cd "C:\Users\pedro\OneDrive\programas\kauara site\Kauara"
if %ERRORLEVEL% NEQ 0 (
    echo Failed to change directory. Please check the path and try again.
    pause
    exit /b %ERRORLEVEL%
)

echo Deploying to Firebase Hosting...
firebase deploy --only hosting
if %ERRORLEVEL% NEQ 0 (
    echo Firebase deploy failed. Check the error above and try again.
    pause
    exit /b %ERRORLEVEL%
)

echo Deployment successful!
pause