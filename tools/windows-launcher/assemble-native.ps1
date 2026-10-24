param([Parameter(Mandatory=$true)][string]$RootPath)
$ErrorActionPreference = 'Stop'
$RootPath = [System.IO.Path]::GetFullPath($RootPath)
if (!(Test-Path -LiteralPath $RootPath -PathType Container)) { throw 'Assembly folder is missing.' }
Set-Location -LiteralPath $RootPath
$parts = 1..6 | ForEach-Object { 'native-package.part{0:D2}' -f $_ }
foreach ($part in $parts) { if (!(Test-Path -LiteralPath $part)) { throw "Missing $part. Extract all six ZIP files into the same folder first." } }
$output = Join-Path $RootPath 'native-verified-package.zip'
$stream = [System.IO.File]::Create($output)
try { foreach ($part in $parts) { $input = [System.IO.File]::OpenRead((Join-Path $RootPath $part)); try { $input.CopyTo($stream) } finally { $input.Dispose() } } } finally { $stream.Dispose() }
if ((Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash -ne 'FB32CAFEFD1FAA2A791C12C6DB24D8101F9EBA7F5101060DE615DD89177E8A38') { throw 'Checksum mismatch. The game will not start.' }
$destination = Join-Path $RootPath ('native-restored-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff'))
Expand-Archive -LiteralPath $output -DestinationPath $destination
$exe = @(Get-ChildItem -LiteralPath $destination -Filter 'nuclear-native-slice.exe' -Recurse)
if ($exe.Count -ne 1) { throw 'Expected exactly one game executable.' }
Start-Process -FilePath $exe[0].FullName -WorkingDirectory $exe[0].DirectoryName
Write-Host 'Verified and started. The restored folder can be used directly next time.'
