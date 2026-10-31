param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$Icon
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$metadata = [Diagnostics.FileVersionInfo]::GetVersionInfo($Executable)
if ($metadata.ProductName -ne 'LogDeck' -or $metadata.FileDescription -notmatch '^LogDeck(?:$| - )') {
  throw 'Windows executable product name and description must identify LogDeck.'
}
$actualIcon = [Drawing.Icon]::ExtractAssociatedIcon($Executable)
if ($null -eq $actualIcon) { throw 'Windows could not extract the executable icon.' }
$bytes = [IO.File]::ReadAllBytes($Icon)
$count = [BitConverter]::ToUInt16($bytes, 4)
$stream = $null
for ($i = 0; $i -lt $count; $i++) {
  $entry = 6 + 16 * $i
  if ($bytes[$entry] -eq 32 -and $bytes[$entry + 1] -eq 32) {
    $length = [BitConverter]::ToUInt32($bytes, $entry + 8)
    $offset = [BitConverter]::ToUInt32($bytes, $entry + 12)
    $stream = [IO.MemoryStream]::new($bytes, $offset, $length)
    break
  }
}
if ($null -eq $stream) { throw 'The expected icon must include a 32px image.' }
$actual = [Drawing.Bitmap]::new(32, 32)
$expected = [Drawing.Bitmap]::new(32, 32)
try {
  $images = @($actualIcon.ToBitmap(), [Drawing.Image]::FromStream($stream))
  $targets = @($actual, $expected)
  try {
    for ($i = 0; $i -lt $images.Count; $i++) {
      $graphics = [Drawing.Graphics]::FromImage($targets[$i])
      try {
        $graphics.Clear([Drawing.Color]::White)
        $graphics.DrawImage($images[$i], 0, 0, 32, 32)
      } finally { $graphics.Dispose() }
    }
    $different = 0
    for ($y = 0; $y -lt 32; $y++) {
      for ($x = 0; $x -lt 32; $x++) {
        $a = $actual.GetPixel($x, $y)
        $b = $expected.GetPixel($x, $y)
        if (([Math]::Abs([int]$a.R - $b.R) + [Math]::Abs([int]$a.G - $b.G) + [Math]::Abs([int]$a.B - $b.B)) -gt 30) { $different++ }
      }
    }
    if ($different -gt 102) { throw "The embedded EXE icon differs from the supplied logo ($different / 1024 pixels)." }
    Write-Output "Windows product name and embedded logo PASS: $Executable"
  } finally { foreach ($image in $images) { $image.Dispose() } }
} finally {
  $actual.Dispose(); $expected.Dispose(); $actualIcon.Dispose(); $stream.Dispose()
}
