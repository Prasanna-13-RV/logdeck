!macro customUnInstall
  ReadRegStr $0 HKCU "Software\Classes\LogDeck.LogFile\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\LogDeck.exe" "%1"' 0 logdeckAssociationDone
  DeleteRegValue HKCU "Software\Classes\.log\OpenWithProgids" "LogDeck.LogFile"
  DeleteRegValue HKCU "Software\Classes\.logcat\OpenWithProgids" "LogDeck.LogFile"
  DeleteRegKey HKCU "Software\Classes\LogDeck.LogFile"
  DeleteRegKey HKCU "Software\LogDeck\Capabilities"
  DeleteRegValue HKCU "Software\RegisteredApplications" "LogDeck"
logdeckAssociationDone:
  ReadRegStr $0 HKCU "Software\Classes\Applications\LogDeck.exe\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\LogDeck.exe" "%1"' 0 logdeckApplicationDone
  DeleteRegKey HKCU "Software\Classes\Applications\LogDeck.exe"
logdeckApplicationDone:
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
