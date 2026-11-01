!include "common.nsh"

!ifndef APP_64
  !error "LogDeck's portable launcher requires an x64 7z payload."
!endif

# Match electron-builder's portable launcher: archive extraction checks its data,
# and release downloads have a published SHA-256 checksum.
CRCCheck off
SilentInstall normal
AutoCloseWindow True
RequestExecutionLevel user
Icon "${MUI_ICON}"
Caption "LogDeck is starting"
SubCaption 3 ""
Page instfiles "" showStartup
Var cacheRoot
Var staging
Var mutex
Var parameters
Var appHandle
Var readyFile
Var progress
Var attempts

Function showStartup
  SendMessage $HWNDPARENT 0xC 0 "STR:LogDeck is starting"
  GetDlgItem $0 $HWNDPARENT 1
  EnableWindow $0 0
  GetDlgItem $0 $HWNDPARENT 2
  EnableWindow $0 0
  GetDlgItem $progress $HWNDPARENT 1004
  System::Call 'user32::GetWindowLongW(p $progress, i -16) i .r0'
  IntOp $0 $0 | 0x8
  System::Call 'user32::SetWindowLongW(p $progress, i -16, i r0)'
  SendMessage $progress 0x40A 1 30
  GetDlgItem $0 $HWNDPARENT 1006
  SendMessage $0 0xC 0 "STR:Starting LogDeck. Preparing your workspace..."
FunctionEnd

Function .onInit
  SetShellVarContext current
  !insertmacro check64BitAndSetRegView
FunctionEnd

Section
  StrCpy $cacheRoot "$LOCALAPPDATA\LogDeck\portable"
  ReadEnvStr $0 "LOGDECK_TEST_PORTABLE_CACHE_ROOT"
  StrCmp $0 "" +2
  StrCpy $cacheRoot $0
  # Keep native-module paths below Windows' legacy path limit.
  StrCpy $1 "${APP_64_HASH}" 32
  StrCpy $INSTDIR "$cacheRoot\${VERSION}-$1"
  StrCpy $staging "$INSTDIR.pending"

  # Serialize extraction only; release the lock before waiting for the app.
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\LogDeck-portable-${APP_64_HASH}") p .r0'
  StrCpy $mutex $0
  StrCmp $mutex 0 lockFailed
  System::Call 'kernel32::WaitForSingleObject(p $mutex, i 120000) i .r0'
  StrCmp $0 0 locked
  StrCmp $0 128 locked lockFailed

locked:
  IfFileExists "$INSTDIR\.ready" cached
  IfFileExists "$INSTDIR\*.*" cacheFailed
  InitPluginsDir
  CreateDirectory "$cacheRoot"
  RMDir /r "$staging"
  ClearErrors
  SetOutPath "$staging"
  IfErrors cacheFailed
  SetCompress off
  File /oname=$PLUGINSDIR\payload.7z "${APP_64}"
  GetDlgItem $0 $HWNDPARENT 1006
  SendMessage $0 0xC 0 "STR:Preparing LogDeck for its first launch. Please wait..."
  ClearErrors
  Nsis7z::Extract "$PLUGINSDIR\payload.7z"
  IfErrors cacheFailed
  IfFileExists "$staging\${APP_EXECUTABLE_FILENAME}" 0 cacheFailed
  IfFileExists "$staging\resources\app.asar" 0 cacheFailed
  IfFileExists "$staging\resources\app.asar.unpacked\node_modules\better-sqlite3\prebuilds\win32-x64.node" 0 cacheFailed
  ClearErrors
  FileOpen $0 "$staging\.ready" w
  IfErrors cacheFailed
  FileWrite $0 "${APP_64_HASH}"
  IfErrors cacheFailed
  FileClose $0
  SetOutPath "$cacheRoot"
  ClearErrors
  Rename "$staging" "$INSTDIR"
  IfErrors cacheFailed

cached:
  ClearErrors
  FileOpen $0 "$INSTDIR\.ready" r
  IfErrors cacheFailed
  FileRead $0 $1
  FileClose $0
  StrCmp $1 "${APP_64_HASH}" 0 cacheFailed
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 cacheFailed
  IfFileExists "$INSTDIR\resources\app.asar" 0 cacheFailed
  IfFileExists "$INSTDIR\resources\app.asar.unpacked\node_modules\better-sqlite3\prebuilds\win32-x64.node" 0 cacheFailed
  System::Call 'kernel32::ReleaseMutex(p $mutex)'
  System::Call 'kernel32::CloseHandle(p $mutex)'
  StrCpy $mutex 0
  System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_DIR", w "$EXEDIR")'
  System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_FILE", w "$EXEPATH")'
  System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_APP_FILENAME", w "${APP_FILENAME}")'
  ${StdUtils.GetAllParameters} $parameters 0
  SetOutPath "$EXEDIR"
  InitPluginsDir
  StrCpy $readyFile "$PLUGINSDIR\window.ready"
  System::Call 'kernel32::SetEnvironmentVariableW(w "LOGDECK_STARTUP_READY_FILE", w "$readyFile")'
  GetDlgItem $0 $HWNDPARENT 1006
  SendMessage $0 0xC 0 "STR:Loading LogDeck..."

  # NSIS is a 32-bit process, so STARTUPINFO and PROCESS_INFORMATION use 32-bit pointers.
  System::Call '*(i 68, p 0, p 0, p 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, &i2 0, &i2 0, p 0, p 0, p 0, p 0) p .r2'
  System::Call '*(p 0, p 0, i 0, i 0) p .r3'
  System::Call 'kernel32::CreateProcessW(w "$INSTDIR\${APP_EXECUTABLE_FILENAME}", w `$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $parameters`, p 0, p 0, i 0, i 0, p 0, w "$EXEDIR", p r2, p r3) i .r0'
  System::Call '*$3(p .r4, p .r5, i, i)'
  System::Free $2
  System::Free $3
  StrCmp $0 0 launchFailed
  StrCpy $appHandle $4
  System::Call 'kernel32::CloseHandle(p r5)'
  StrCpy $attempts 0
waitForWindow:
  IfFileExists "$readyFile" windowReady
  System::Call 'kernel32::WaitForSingleObject(p $appHandle, i 100) i .r0'
  StrCmp $0 0 appExited
  StrCmp $0 258 0 waitFailed
  IntOp $attempts $attempts + 1
  IntCmp $attempts 1200 waitFailed waitForWindow waitFailed
windowReady:
  HideWindow
  System::Call 'kernel32::WaitForSingleObject(p $appHandle, i -1) i .r0'
  StrCmp $0 0 0 waitFailed
appExited:
  System::Call 'kernel32::GetExitCodeProcess(p $appHandle, *i .r0)'
  System::Call 'kernel32::CloseHandle(p $appHandle)'
  SetErrorLevel $0
  Goto done
waitFailed:
  System::Call 'kernel32::CloseHandle(p $appHandle)'
  MessageBox MB_OK|MB_ICONSTOP "LogDeck did not finish starting within two minutes. Check for an application error window before trying again."
  SetErrorLevel 1
  Goto done

cacheFailed:
  System::Call 'kernel32::ReleaseMutex(p $mutex)'
  System::Call 'kernel32::CloseHandle(p $mutex)'
  MessageBox MB_OK|MB_ICONSTOP "LogDeck could not prepare its runtime cache.$\r$\nClose LogDeck, then remove this cache folder and try again:$\r$\n$INSTDIR$\r$\nCheck available disk space and folder permissions."
  SetErrorLevel 1
  Goto done
lockFailed:
  StrCmp $mutex 0 +2
  System::Call 'kernel32::CloseHandle(p $mutex)'
  MessageBox MB_OK|MB_ICONSTOP "LogDeck could not acquire its startup lock. Another launch may still be extracting the runtime. Please try again."
  SetErrorLevel 1
  Goto done
launchFailed:
  MessageBox MB_OK|MB_ICONSTOP "LogDeck could not start its cached runtime:$\r$\n$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  SetErrorLevel 1
done:
SectionEnd
