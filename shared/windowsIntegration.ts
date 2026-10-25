export interface WindowsIntegrationInfo {
  available: boolean
  executablePath: string
  registeredPath: string | null
}

export function windowsIntegrationScript(action: 'status' | 'register' | 'remove', executable: string): string {
  if (!/^[A-Za-z]:\\.+\.exe$/i.test(executable) || /[\u0000-\u001f"]/u.test(executable)) throw new Error('Invalid portable executable path.')
  const literal = `'${executable.replaceAll("'", "''")}'`
  const common = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$exe = ${literal}
$classes = 'HKCU:\\Software\\Classes'
$prog = "$classes\\LogDeck.LogFile"
$cap = 'HKCU:\\Software\\LogDeck\\Capabilities'
$apps = 'HKCU:\\Software\\RegisteredApplications'
`
  if (action === 'status') return `${common}
$command = "$prog\\shell\\open\\command"
$value = $null
if (Test-Path -LiteralPath $command) { $value = (Get-Item -LiteralPath $command).GetValue('') }
$value | ConvertTo-Json -Compress
`
  if (action === 'register') return `${common}
New-Item -Path "$prog\\shell\\open\\command" -Force | Out-Null
Set-Item -LiteralPath $prog -Value 'LogDeck log file'
Set-Item -LiteralPath "$prog\\shell\\open\\command" -Value ('"' + $exe + '" "%1"')
New-Item -Path "$prog\\DefaultIcon" -Force | Out-Null
Set-Item -LiteralPath "$prog\\DefaultIcon" -Value ('"' + $exe + '",0')
foreach ($ext in @('.log', '.logcat')) {
  $openWith = "$classes\\$ext\\OpenWithProgids"
  New-Item -Path $openWith -Force | Out-Null
  New-ItemProperty -LiteralPath $openWith -Name 'LogDeck.LogFile' -Value '' -PropertyType String -Force | Out-Null
}
New-Item -Path "$cap\\FileAssociations" -Force | Out-Null
New-ItemProperty -LiteralPath $cap -Name 'ApplicationName' -Value 'LogDeck' -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath $cap -Name 'ApplicationDescription' -Value 'Local-first log viewer' -PropertyType String -Force | Out-Null
foreach ($ext in @('.log', '.logcat')) {
  New-ItemProperty -LiteralPath "$cap\\FileAssociations" -Name $ext -Value 'LogDeck.LogFile' -PropertyType String -Force | Out-Null
}
New-Item -Path $apps -Force | Out-Null
New-ItemProperty -LiteralPath $apps -Name 'LogDeck' -Value 'Software\\LogDeck\\Capabilities' -PropertyType String -Force | Out-Null
`
  return `${common}
foreach ($ext in @('.log', '.logcat')) {
  $key = "$classes\\$ext\\OpenWithProgids"
  if ((Test-Path -LiteralPath $key) -and ((Get-Item -LiteralPath $key).GetValueNames() -contains 'LogDeck.LogFile')) {
    Remove-ItemProperty -LiteralPath $key -Name 'LogDeck.LogFile'
  }
}
if ((Test-Path -LiteralPath $apps) -and ((Get-Item -LiteralPath $apps).GetValueNames() -contains 'LogDeck')) {
  Remove-ItemProperty -LiteralPath $apps -Name 'LogDeck'
}
if (Test-Path -LiteralPath $prog) { Remove-Item -LiteralPath $prog -Recurse }
if (Test-Path -LiteralPath $cap) { Remove-Item -LiteralPath $cap -Recurse }
`
}
