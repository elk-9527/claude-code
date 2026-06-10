@echo off
REM Fix missing ADB interface GUID for HONOR tablet - CrossScreen

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator privileges, click YES in the popup...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo ================================================
echo   Fixing ADB Interface GUID for HONOR tablet
echo ================================================
echo.

reg add "HKLM\SYSTEM\CurrentControlSet\Enum\USB\VID_339B&PID_107D&MI_01\7&24563D21&2&0001\Device Parameters" /v DeviceInterfaceGUIDs /t REG_MULTI_SZ /d "{F72FE0D4-CBCB-407d-8814-9ED673D0DD6B}" /f

if %errorlevel% equ 0 (
  echo.
  echo [OK] GUID written successfully.
) else (
  echo.
  echo [FAIL] Access denied or key protected. Tell me this result.
)

echo.
echo ================================================
echo   Next: unplug the USB cable, wait 3 sec, plug back in
echo ================================================
echo.
pause
