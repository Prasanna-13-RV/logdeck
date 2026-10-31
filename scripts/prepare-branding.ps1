$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

function Resize-Logo($sourcePath, $width, $height) {
  $source = [Drawing.Image]::FromFile($sourcePath)
  try {
    $bitmap = [Drawing.Bitmap]::new($width, $height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $scale = [Math]::Min($width / $source.Width, $height / $source.Height)
      $w = [int][Math]::Round($source.Width * $scale)
      $h = [int][Math]::Round($source.Height * $scale)
      $graphics.DrawImage($source, [int](($width - $w) / 2), [int](($height - $h) / 2), $w, $h)
    } finally { $graphics.Dispose() }
    return $bitmap
  } finally { $source.Dispose() }
}

$source = Join-Path $root 'images\logo\logdeck_transparent_bg.png'
$mark = Resize-Logo $source 256 256
try { $mark.Save((Join-Path $root 'images\brand-mark.png'), [Drawing.Imaging.ImageFormat]::Png) }
finally { $mark.Dispose() }
$portrait = Resize-Logo (Join-Path $root 'images\logo\logdeck_transparent_bg_vertical.png') 240 300
try { $portrait.Save((Join-Path $root 'images\brand-portrait.png'), [Drawing.Imaging.ImageFormat]::Png) }
finally { $portrait.Dispose() }

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$payloads = @()
foreach ($size in $sizes) {
  $bitmap = Resize-Logo $source $size $size
  $stream = [IO.MemoryStream]::new()
  try {
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $payloads += ,$stream.ToArray()
  } finally { $bitmap.Dispose(); $stream.Dispose() }
}
$output = [IO.File]::Create((Join-Path $root 'images\app-icon.ico'))
$writer = [IO.BinaryWriter]::new($output)
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dimension = $sizes[$i] % 256
    $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
    $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$payloads[$i].Length); $writer.Write([uint32]$offset)
    $offset += $payloads[$i].Length
  }
  foreach ($payload in $payloads) { $writer.Write([byte[]]$payload) }
} finally { $writer.Dispose(); $output.Dispose() }
