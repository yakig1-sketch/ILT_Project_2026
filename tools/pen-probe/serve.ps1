# Minimal local server for previewing the pen probe on this PC: http://localhost:8765/
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:8765/')
$listener.Start()
Write-Host 'Serving tools/pen-probe on http://localhost:8765/'
$page = Join-Path $PSScriptRoot 'index.html'
while ($listener.IsListening) {
    $context = $listener.GetContext()
    $bytes = [System.IO.File]::ReadAllBytes($page)
    $context.Response.ContentType = 'text/html; charset=utf-8'
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
}
