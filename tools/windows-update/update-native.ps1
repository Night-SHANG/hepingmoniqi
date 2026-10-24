param([Parameter(Mandatory=$true)][string]$RootPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$timer = [Diagnostics.Stopwatch]::StartNew()
$RootPath = [IO.Path]::GetFullPath($RootPath)
$exeName = 'nuclear-native-slice.exe'
$dllName = 'libvoxel.windows.template_release.x86_64.dll'
$pckName = 'nuclear-native-slice.pck'
$manifestName = 'update-manifest.json'
$installedManifestName = 'UPDATE-MANIFEST.json'

function Assert-PlainPath([string]$Path, [bool]$Directory = $false) {
    $item = Get-Item -LiteralPath $Path -Force
    if ([bool]$item.PSIsContainer -ne $Directory) { throw ('Unexpected file type: ' + $Path) }
    while ($null -ne $item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw ('Reparse points are not allowed: ' + $Path) }
        $item = if ($item -is [IO.DirectoryInfo]) { $item.Parent } else { $item.Directory }
    }
}

function Assert-SafeRelative([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '[:\\<>"|?*]') { throw 'Unsafe manifest path.' }
    foreach ($part in $Path.Split('/')) {
        if ($part -eq '' -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Unsafe manifest path component.' }
    }
}

function Assert-Record($Record) {
    Assert-SafeRelative ([string]$Record.path)
    if ([string]$Record.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or [long]$Record.bytes -lt 0) { throw 'Invalid manifest file checksum or size.' }
}

function Test-Record([string]$Directory, $Record) {
    $path = Join-Path $Directory $Record.path
    Assert-PlainPath $path
    return ((Get-Item -LiteralPath $path).Length -eq [long]$Record.bytes -and (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -eq $Record.sha256)
}

function Get-PlainTree([string]$Directory) {
    Assert-PlainPath $Directory $true
    $queue = New-Object 'Collections.Generic.Queue[string]'
    $queue.Enqueue($Directory)
    $count = 0
    while ($queue.Count -gt 0) {
        foreach ($item in @(Get-ChildItem -LiteralPath ($queue.Dequeue()) -Force)) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw ('Reparse point in package: ' + $item.FullName) }
            if (++$count -gt 4096) { throw 'Package inventory exceeds its bounded file limit.' }
            if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
            $item
        }
    }
}

Assert-PlainPath $RootPath $true
$RootPath = (Get-Item -LiteralPath $RootPath -Force).FullName.TrimEnd('\', '/')
$manifestPath = Join-Path $RootPath $manifestName
Assert-PlainPath $manifestPath
$manifestBytes = [IO.File]::ReadAllBytes($manifestPath)
$manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
$manifest = [Text.Encoding]::UTF8.GetString($manifestBytes).TrimStart([char]0xFEFF) | ConvertFrom-Json
if ([int]$manifest.schema -ne 1) { throw 'Unsupported update manifest version.' }
Assert-SafeRelative ([string]$manifest.original.root_directory)
if ($manifest.original.root_directory.Contains('/')) { throw 'Original package directory must be a direct child.' }
if ([string]$manifest.original.archive_sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid original archive checksum.' }
Assert-Record $manifest.payload
if ($manifest.payload.path -cne $pckName) { throw 'Unexpected update payload name.' }
$originalFiles = @($manifest.original.files)
$expected = @{}
foreach ($record in $originalFiles) {
    Assert-Record $record
    $name = [string]$record.path
    if ($name -cne $exeName -and $name -cne $dllName -and !$name.StartsWith('THIRD-PARTY-NOTICES/', [StringComparison]::Ordinal)) { throw 'Unexpected original package member.' }
    if ($expected.ContainsKey($name)) { throw 'Duplicate update member.' }
    $expected[$name] = $record
}
if (!$expected.ContainsKey($exeName) -or !$expected.ContainsKey($dllName) -or $expected.Count -lt 3) { throw 'Update manifest must include the engine, extension, and notices.' }
$expected[$pckName] = $manifest.payload
$expected[$installedManifestName] = [PSCustomObject]@{ path = $installedManifestName; bytes = $manifestBytes.Length; sha256 = $manifestHash }
$expectedDirectories = @{}
foreach ($name in @($expected.Keys)) {
    $parent = [string]$name
    while ($parent.Contains('/')) {
        $parent = $parent.Substring(0, $parent.LastIndexOf('/'))
        $expectedDirectories[$parent] = $true
    }
}
if (!(Test-Record $RootPath $manifest.payload)) { throw 'Update PCK checksum mismatch. Nothing will be launched.' }
$destination = Join-Path $RootPath ('native-update-' + $manifest.payload.sha256.Substring(0, 16).ToLowerInvariant())

function Assert-CompleteUpdate([string]$Directory) {
    $files = @{}
    $directories = @{}
    foreach ($item in @(Get-PlainTree $Directory)) {
        $relative = $item.FullName.Substring($Directory.Length + 1).Replace('\', '/')
        if ($item.PSIsContainer) {
            if (!$expectedDirectories.ContainsKey($relative)) { throw ('Unexpected update directory: ' + $relative) }
            $directories[$relative] = $true
        } else {
            if (!$expected.ContainsKey($relative)) { throw ('Unexpected update file: ' + $relative) }
            $files[$relative] = $true
        }
    }
    if ($files.Count -ne $expected.Count -or $directories.Count -ne $expectedDirectories.Count) { throw 'Update directory has missing files or directories.' }
    foreach ($record in $expected.Values) {
        if (!(Test-Record $Directory $record)) { throw ('Update member checksum mismatch: ' + $record.path) }
    }
}

function Test-OriginalDirectory([string]$Directory) {
    try {
        $null = @(Get-PlainTree $Directory)
        foreach ($record in $originalFiles) { if (!(Test-Record $Directory $record)) { return $false } }
        return $true
    } catch { return $false }
}

$mode = 'verified-update-cache'
if (Test-Path -LiteralPath $destination) {
    # Compare the entire installed inventory to this delivered update manifest,
    # never to a self-authored manifest found inside the cached directory.
    Assert-CompleteUpdate $destination
} else {
    $archivePath = Join-Path $RootPath 'native-verified-package.zip'
    $originalDirectory = $null
    $useArchive = Test-Path -LiteralPath $archivePath
    if ($useArchive) {
        Assert-PlainPath $archivePath
        if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $manifest.original.archive_sha256) { throw 'Original ZIP checksum mismatch. Original files were preserved.' }
        $mode = 'verified-original-archive'
    } else {
        # No recursive or whole-disk search. Only the exact original top-level
        # package directory and the known old launcher's direct cache children.
        $candidates = New-Object 'Collections.Generic.List[string]'
        $candidates.Add((Join-Path $RootPath $manifest.original.root_directory))
        foreach ($candidate in @(Get-ChildItem -LiteralPath $RootPath -Directory -Filter 'native-restored-*' -Force | Sort-Object Name)) {
            if ($candidate.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            $candidates.Add((Join-Path $candidate.FullName $manifest.original.root_directory))
        }
        foreach ($candidate in $candidates) {
            if ((Test-Path -LiteralPath $candidate -PathType Container) -and (Test-OriginalDirectory $candidate)) { $originalDirectory = $candidate; break }
        }
        if (!$originalDirectory) { throw 'No verified original package found. Extract this update beside the original six-part files and restored game folder. If only the six parts remain, run the original merge launcher once, then retry this update. No download is required.' }
        $mode = 'verified-restored-folder'
    }

    # Never overwrite a game or an invalid cache. A failed partial build stays
    # separate for diagnosis; only a completely verified build becomes final.
    $staging = Join-Path $RootPath ('.native-update-building-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging | Out-Null
    $archive = $null
    try {
        if ($useArchive) {
            Add-Type -AssemblyName System.IO.Compression
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
        }
        foreach ($record in $originalFiles) {
            $target = Join-Path $staging $record.path
            $parent = Split-Path -Parent $target
            if (!(Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
            if ($useArchive) {
                $entryName = $manifest.original.root_directory + '/' + $record.path
                $entries = @($archive.Entries | Where-Object { $_.FullName -ceq $entryName })
                if ($entries.Count -ne 1 -or $entries[0].Length -ne [long]$record.bytes) { throw ('Original ZIP is missing a unique expected member: ' + $record.path) }
                $input = $entries[0].Open()
                $output = $null
                try {
                    $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                    $input.CopyTo($output)
                } finally { if ($null -ne $output) { $output.Dispose() }; $input.Dispose() }
            } else {
                [IO.File]::Copy((Join-Path $originalDirectory $record.path), $target, $false)
            }
        }
    } finally { if ($null -ne $archive) { $archive.Dispose() } }
    [IO.File]::Copy((Join-Path $RootPath $pckName), (Join-Path $staging $pckName), $false)
    [IO.File]::WriteAllBytes((Join-Path $staging $installedManifestName), $manifestBytes)
    Assert-CompleteUpdate $staging
    [IO.Directory]::Move($staging, $destination)
    Assert-CompleteUpdate $destination
}

Start-Process -FilePath (Join-Path $destination $exeName) -WorkingDirectory $destination
$timer.Stop()
Write-Host ('NATIVE_UPDATE mode={0} total_ms={1} directory={2}' -f $mode, $timer.ElapsedMilliseconds, $destination)
Write-Host 'Updated version verified and started. The original game and files were preserved.'
