param([Parameter(Mandatory=$true)][string]$RootPath)
$ErrorActionPreference = 'Stop'
$launchTimer = [Diagnostics.Stopwatch]::StartNew()
$RootPath = [System.IO.Path]::GetFullPath($RootPath)
if (!(Test-Path -LiteralPath $RootPath -PathType Container)) { throw 'Assembly folder is missing.' }
Set-Location -LiteralPath $RootPath
$expectedHash = 'FB32CAFEFD1FAA2A791C12C6DB24D8101F9EBA7F5101060DE615DD89177E8A38'
$parts = 1..6 | ForEach-Object { 'native-package.part{0:D2}' -f $_ }
foreach ($part in $parts) { if (!(Test-Path -LiteralPath $part -PathType Leaf)) { throw "Missing $part. Extract all six ZIP files into the same folder first." } }

function Get-PartsHash {
    # Hash the concatenated source bytes without rewriting the ZIP on a hit.
    # Timestamps, filenames and a valid cache never excuse changed source parts.
    $hasher = [Security.Cryptography.SHA256]::Create()
    $buffer = New-Object byte[] 1048576
    try {
        foreach ($part in $parts) {
            $input = [IO.File]::OpenRead((Join-Path $RootPath $part))
            try {
                while (($count = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $null = $hasher.TransformBlock($buffer, 0, $count, $buffer, 0)
                }
            }
            finally { $input.Dispose() }
        }
        $null = $hasher.TransformFinalBlock((New-Object byte[] 0), 0, 0)
        return [BitConverter]::ToString($hasher.Hash).Replace('-', '')
    }
    finally { $hasher.Dispose() }
}

$mergeTimer = [Diagnostics.Stopwatch]::StartNew()
$output = Join-Path $RootPath 'native-verified-package.zip'
$validArchive = (Test-Path -LiteralPath $output -PathType Leaf) -and ((Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash -eq $expectedHash)
if ($validArchive) {
    if ((Get-PartsHash) -ne $expectedHash) { throw 'Checksum mismatch. The game will not start.' }
}
else {
    $stream = [IO.File]::Create($output)
    try { foreach ($part in $parts) { $input = [IO.File]::OpenRead((Join-Path $RootPath $part)); try { $input.CopyTo($stream) } finally { $input.Dispose() } } } finally { $stream.Dispose() }
    if ((Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Checksum mismatch. The game will not start.' }
}

$mergeTimer.Stop()

function Get-VerifiedInventory {
    # Only read the manifest INSIDE the just-authenticated archive. A manifest
    # lying beside a cached EXE is not evidence that the EXE is authentic.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($output)
    try {
        $files = @($archive.Entries | Where-Object { !$_.FullName.EndsWith('/') })
        $manifests = @($files | Where-Object { $_.FullName -match '(^|/)PACKAGE-MANIFEST\.json$' })
        if ($manifests.Count -ne 1) { throw 'Expected exactly one package manifest in the verified ZIP.' }
        $manifestEntry = $manifests[0]
        $prefix = $manifestEntry.FullName.Substring(0, $manifestEntry.FullName.LastIndexOf('/') + 1)
        $memory = New-Object IO.MemoryStream
        $input = $manifestEntry.Open()
        try { $input.CopyTo($memory); $manifestBytes = $memory.ToArray() }
        finally { $input.Dispose(); $memory.Dispose() }
        $document = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json
        $records = @{}
        foreach ($property in $document.files.PSObject.Properties) {
            if ($records.ContainsKey($property.Name)) { throw 'Duplicate manifest member.' }
            $records[$property.Name] = $property.Value
        }
        if ($records.Count -ne ($files.Count - 1)) { throw 'Package manifest does not cover every archive member.' }
        $seen = @{}
        foreach ($entry in $files) {
            $name = $entry.FullName
            if ($name -match '[:\\]' -or @($name.Split('/') | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }).Count -gt 0) { throw 'Unsafe archive member path.' }
            if (!$name.StartsWith($prefix, [StringComparison]::Ordinal) -or $seen.ContainsKey($name)) { throw 'Invalid or duplicate archive member.' }
            $seen[$name] = $true
            if ($name -ceq $manifestEntry.FullName) {
                $hasher = [Security.Cryptography.SHA256]::Create()
                try { $hash = [BitConverter]::ToString($hasher.ComputeHash($manifestBytes)).Replace('-', '') }
                finally { $hasher.Dispose() }
            }
            else {
                $relative = $name.Substring($prefix.Length)
                if (!$records.ContainsKey($relative)) { throw 'Archive member is not covered by the package manifest.' }
                $record = $records[$relative]
                $hash = [string]$record.sha256
                if ($hash -notmatch '^[0-9a-fA-F]{64}$' -or [long]$record.bytes -ne $entry.Length) { throw 'Invalid package member checksum or length.' }
            }
            [PSCustomObject]@{ Path = $name; Bytes = $entry.Length; Hash = $hash }
        }
    }
    finally { $archive.Dispose() }
}

$cacheKeyName = '.native-archive-sha256'
$inventoryTimer = [Diagnostics.Stopwatch]::StartNew()
$inventory = @(Get-VerifiedInventory)
$executables = @($inventory | Where-Object { ($_.Path -split '/')[-1] -ceq 'nuclear-native-slice.exe' })
if ($executables.Count -ne 1) { throw 'Expected exactly one game executable.' }
$inventoryTimer.Stop()

function Test-VerifiedCache {
    param([string]$Directory)
    try {
        if ((Get-Item -LiteralPath $Directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
        # Walk one level at a time so a junction is rejected before traversal.
        # Extra files also invalidate the cache: an added DLL must not ride
        # beside an otherwise authentic EXE. Nothing is deleted or overwritten.
        $directories = New-Object 'Collections.Generic.Queue[string]'
        $directories.Enqueue($Directory)
        $fileCount = 0
        while ($directories.Count -gt 0) {
            foreach ($item in @(Get-ChildItem -LiteralPath ($directories.Dequeue()) -Force)) {
                if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
                if ($item.PSIsContainer) { $directories.Enqueue($item.FullName) }
                else { $fileCount++ }
            }
        }
        if ($fileCount -ne ($inventory.Count + 1)) { return $false }
        $cacheKey = Join-Path $Directory $cacheKeyName
        if (!(Test-Path -LiteralPath $cacheKey -PathType Leaf)) { return $false }
        if ([IO.File]::ReadAllText($cacheKey) -cne $expectedHash) { return $false }
        foreach ($record in $inventory) {
            $path = Join-Path $Directory $record.Path
            if (!(Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
            if ((Get-Item -LiteralPath $path).Length -ne $record.Bytes) { return $false }
            if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $record.Hash) { return $false }
        }
        return $true
    }
    catch { return $false } # Unreadable/partial cache is rebuilt elsewhere.
}

$verifyTimer = [Diagnostics.Stopwatch]::StartNew()
$extractTimer = New-Object Diagnostics.Stopwatch
$mode = 'cache-hit'
$destination = $null
# Short names preserve Windows PowerShell 5.1 path headroom. The full SHA
# key is only a selector; every cache member is independently authenticated.
$cachePrefix = 'native-restored-' + $expectedHash.Substring(0, 12) + '-'
$candidates = @(Get-ChildItem -LiteralPath $RootPath -Directory -Filter ($cachePrefix + '*') | Sort-Object LastWriteTimeUtc -Descending)
foreach ($candidate in $candidates) {
    if (Test-VerifiedCache $candidate.FullName) { $destination = $candidate.FullName; break }
}
$verifyTimer.Stop()
if (!$destination) {
    $mode = 'fresh-extraction'
    $extractTimer.Start()
    do { $destination = Join-Path $RootPath ($cachePrefix + [Guid]::NewGuid().ToString('N').Substring(0, 8)) } while (Test-Path -LiteralPath $destination)
    Expand-Archive -LiteralPath $output -DestinationPath $destination
    [IO.File]::WriteAllText((Join-Path $destination $cacheKeyName), $expectedHash, [Text.Encoding]::ASCII)
    $extractTimer.Stop()
    $verifyTimer.Start()
    if (!(Test-VerifiedCache $destination)) { throw 'Extracted package failed member verification. The game will not start.' }
    $verifyTimer.Stop()
    Write-Host 'Extracted a fresh verified package; existing folders were preserved.'
}
else { Write-Host 'Reusing verified package; no ZIP rewrite or extraction was needed.' }
$exe = Join-Path $destination $executables[0].Path
$spawnTimer = [Diagnostics.Stopwatch]::StartNew()
Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
$spawnTimer.Stop()
$launchTimer.Stop()
Write-Host ('NATIVE_LAUNCH_TIMING mode={0} merge_or_reuse_ms={1} manifest_ms={2} verify_cached_members_ms={3} extract_ms={4} process_spawn_ms={5} total_ms={6}' -f $mode, $mergeTimer.ElapsedMilliseconds, $inventoryTimer.ElapsedMilliseconds, $verifyTimer.ElapsedMilliseconds, $extractTimer.ElapsedMilliseconds, $spawnTimer.ElapsedMilliseconds, $launchTimer.ElapsedMilliseconds)
Write-Host 'Verified and started.'
