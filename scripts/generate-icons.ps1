# Reproducible vector rendering for the checked-in PNGs; not needed for builds.
Add-Type -AssemblyName System.Drawing
$iconRoot = Join-Path $PSScriptRoot '../public/icons'
foreach ($variant in @(@(192, 'folio-192.png', $false), @(512, 'folio-512.png', $false), @(180, 'apple-touch-icon.png', $false), @(512, 'folio-maskable-512.png', $true))) {
  $size = [int]$variant[0]
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $background = if ($variant[2]) { '#586449' } else { '#f5f1e8' }
  $foreground = if ($variant[2]) { '#f5f1e8' } else { '#586449' }
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($background))
  $graphics.ScaleTransform($size / 512.0, $size / 512.0)
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($foreground), 16)
  $pen.StartCap = $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddBezier(256,176,218,146,176,144,132,158)
  $path.AddLine(132,158,132,342)
  $path.AddBezier(132,342,178,328,218,332,256,360)
  $path.AddBezier(256,360,294,332,334,328,380,342)
  $path.AddLine(380,342,380,158)
  $path.AddBezier(380,158,336,144,294,146,256,176)
  $path.AddLine(256,176,256,360)
  $graphics.DrawPath($pen, $path)
  $pen.Width = 10
  $graphics.DrawBezier($pen,168,196,188,192,207,196,224,204)
  $graphics.DrawBezier($pen,168,232,188,228,207,232,224,240)
  $graphics.DrawBezier($pen,288,204,305,196,324,192,344,196)
  $bitmap.Save((Join-Path $iconRoot $variant[1]), [System.Drawing.Imaging.ImageFormat]::Png)
  $path.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
