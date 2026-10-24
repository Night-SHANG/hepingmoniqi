#requires -Version 5.1
<# Real Windows PowerShell 5.1 -> CMD -> delivered BAT -> real fixture EXE.
   Scripts and BAT are copied byte-for-byte. Only the release manifest's hash
   and size values are replaced with fixture values; no launch APIs are mocked.
   Run: powershell.exe -NoProfile -File tests/windows-update/test.ps1
#>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Assert-True([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}
Assert-True ($env:OS -eq 'Windows_NT') 'Windows and CMD are required.'
Assert-True (($PSVersionTable.PSEdition -eq 'Desktop') -and ($PSVersionTable.PSVersion.Major -eq 5)) 'Use Windows PowerShell 5.1, not pwsh.'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$source = Join-Path $repo 'tools/windows-update'
$batchName = '更新并启动.bat'
$scriptName = 'update-native.ps1'
$manifestName = 'update-manifest.json'
foreach ($name in @($batchName, $scriptName, $manifestName)) {
    Assert-True (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf) ('Missing production updater: ' + $name)
}
$utf8 = New-Object Text.UTF8Encoding($false)
$root = Join-Path ([IO.Path]::GetTempPath()) ('nu 中文 [空 格]& ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$caller = Join-Path $root 'unrelated caller'
$fixture = Join-Path $root 'fixture'
New-Item -ItemType Directory -Path $caller, $fixture -Force | Out-Null
Write-Host ('Runtime: Windows PowerShell ' + $PSVersionTable.PSVersion)
Write-Host ('Fixture evidence retained: ' + $root)
$manifest = [IO.File]::ReadAllText((Join-Path $source $manifestName)) | ConvertFrom-Json
$exeName = 'nuclear-native-slice.exe'
$dllName = 'libvoxel.windows.template_release.x86_64.dll'
$pckName = 'nuclear-native-slice.pck'
$originalRootName = $manifest.original.root_directory
$fixtureOriginal = Join-Path $fixture $originalRootName
New-Item -ItemType Directory -Path $fixtureOriginal | Out-Null
$program = @'
using System;
using System.IO;
using System.Text;
public static class UpdateFixture {
    public static int Main() {
        string cwd = Environment.CurrentDirectory;
        string marker = Environment.GetEnvironmentVariable("NATIVE_UPDATE_TEST_MARKER");
        File.WriteAllText(marker, cwd + "\n" + File.ReadAllText(Path.Combine(cwd, "nuclear-native-slice.pck")), new UTF8Encoding(false));
        return 0;
    }
}
'@
# Add-Type resolves OutputAssembly as a PowerShell wildcard path on WinPS 5.1.
# Compile in a short plain path, then copy with the literal .NET file API. The
# delivered BAT still runs from the Chinese/space/bracket/ampersand path.
$compileRoot = Join-Path ([IO.Path]::GetTempPath()) ('nu-compile-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[IO.Directory]::CreateDirectory($compileRoot) | Out-Null
$compiledExe = Join-Path $compileRoot $exeName
Add-Type -TypeDefinition $program -Language CSharp -OutputAssembly $compiledExe -OutputType ConsoleApplication
[IO.File]::Copy($compiledExe, (Join-Path $fixtureOriginal $exeName), $false)
# Keep production filenames and notice inventory; replace only expected content
# hashes/sizes in the test manifest. No test-only mode exists in production.
foreach ($record in $manifest.original.files) {
    $path = Join-Path $fixtureOriginal $record.path
    if ($record.path -ne $exeName) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
        [IO.File]::WriteAllText($path, ('Original fixture: ' + $record.path), $utf8)
    }
    $record.bytes = (Get-Item -LiteralPath $path).Length
    $record.sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}
[IO.File]::WriteAllText((Join-Path $fixtureOriginal $pckName), 'old-pck-must-survive', $utf8)
[IO.File]::WriteAllText((Join-Path $fixtureOriginal 'old-user-file.txt'), 'preserve me', $utf8)
$payloadText = 'new-pck-startup-fix'
$payload = Join-Path $fixture $pckName
[IO.File]::WriteAllText($payload, $payloadText, $utf8)
$manifest.payload.bytes = (Get-Item -LiteralPath $payload).Length
$manifest.payload.sha256 = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash
$fixtureZip = Join-Path $fixture 'original.zip'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($fixtureZip, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in @(Get-ChildItem -LiteralPath $fixtureOriginal -File -Recurse)) {
        $relative = $file.FullName.Substring($fixtureOriginal.Length + 1).Replace('\', '/')
        $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, ($originalRootName + '/' + $relative), [IO.Compression.CompressionLevel]::Optimal)
    }
} finally { $archive.Dispose() }
$manifest.original.archive_sha256 = (Get-FileHash -LiteralPath $fixtureZip -Algorithm SHA256).Hash
$manifestText = $manifest | ConvertTo-Json -Depth 8
$targetName = 'native-update-' + $manifest.payload.sha256.Substring(0, 16).ToLowerInvariant()
$productionBatchBytes = [IO.File]::ReadAllBytes((Join-Path $source $batchName))
$productionScriptBytes = [IO.File]::ReadAllBytes((Join-Path $source $scriptName))
Assert-True ($productionScriptBytes[0] -eq 239 -and $productionScriptBytes[1] -eq 187 -and $productionScriptBytes[2] -eq 191) 'PS1 must retain UTF-8 BOM for Windows PowerShell 5.1.'
Assert-True ($utf8.GetString($productionBatchBytes) -notmatch '(?i)ExecutionPolicy|Bypass') 'BAT must not change execution policy.'
Assert-True ($utf8.GetString($productionScriptBytes) -notmatch '\$PSScriptRoot') 'ScriptBlock-loaded helper must use its explicit RootPath parameter.'

function New-Bundle([string]$Name, [string]$SourceKind = 'archive') {
    $bundle = Join-Path $root $Name
    New-Item -ItemType Directory -Path $bundle | Out-Null
    foreach ($name in @($batchName, $scriptName)) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $bundle $name)
        Assert-True ((Get-FileHash -LiteralPath (Join-Path $source $name)).Hash -eq (Get-FileHash -LiteralPath (Join-Path $bundle $name)).Hash) ('Staging changed production bytes: ' + $name)
    }
    [IO.File]::WriteAllText((Join-Path $bundle $manifestName), $manifestText, $utf8)
    Copy-Item -LiteralPath $payload -Destination (Join-Path $bundle $pckName)
    if ($SourceKind -eq 'archive') {
        Copy-Item -LiteralPath $fixtureZip -Destination (Join-Path $bundle 'native-verified-package.zip')
    } elseif ($SourceKind -eq 'restored') {
        $restored = Join-Path $bundle 'native-restored-20261024-123456'
        New-Item -ItemType Directory -Path $restored | Out-Null
        Copy-Item -LiteralPath $fixtureOriginal -Destination $restored -Recurse
    } elseif ($SourceKind -eq 'direct') {
        Copy-Item -LiteralPath $fixtureOriginal -Destination $bundle -Recurse
    }
    return $bundle
}

function Invoke-Update([string]$Bundle, [bool]$ExpectSuccess = $true) {
    $marker = Join-Path $root ([Guid]::NewGuid().ToString('N') + '.launch-marker.txt')
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $env:ComSpec
    $start.Arguments = '/d /s /c ""' + (Join-Path $Bundle $batchName) + '""'
    $start.WorkingDirectory = $caller
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $true
    $start.EnvironmentVariables['NATIVE_UPDATE_NONINTERACTIVE'] = '1'
    $start.EnvironmentVariables['NATIVE_UPDATE_TEST_MARKER'] = $marker
    $start.EnvironmentVariables['PATH'] = $PSHOME + ';' + $env:PATH
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        Assert-True ($process.Start()) 'Could not start CMD.'
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Close()
        if (!$process.WaitForExit(30000)) {
            & (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID $process.Id /T /F | Out-Null
            throw 'Updater timed out after 30 seconds.'
        }
        Assert-True ($stdout.Wait(10000)) 'Standard output did not close.'
        Assert-True ($stderr.Wait(10000)) 'Standard error did not close.'
        $output = $stdout.Result + $stderr.Result
        Write-Host $output
        if ($ExpectSuccess) {
            Assert-True ($process.ExitCode -eq 0) ('Update failed: ' + $output)
            $expected = (Join-Path $Bundle $targetName) + "`n" + $payloadText
            $deadline = [DateTime]::UtcNow.AddSeconds(10)
            do {
                if (Test-Path -LiteralPath $marker) {
                    try { if ([IO.File]::ReadAllText($marker) -ceq $expected) { return $output } } catch [IO.IOException] { }
                }
                Start-Sleep -Milliseconds 50
            } while ([DateTime]::UtcNow -lt $deadline)
            throw 'The real EXE did not start with the new PCK and correct working directory.'
        }
        Assert-True ($process.ExitCode -ne 0) 'Invalid bundle unexpectedly returned success.'
        Start-Sleep -Milliseconds 250
        Assert-True (!(Test-Path -LiteralPath $marker)) 'Invalid bundle launched an EXE.'
        return $output
    } finally { $process.Dispose() }
}

# Mutating guards, source selection, or the PCK copy must break these cases.
$archiveRoot = New-Bundle 'archive route 中文 空格'
$archiveBefore = (Get-FileHash -LiteralPath (Join-Path $archiveRoot 'native-verified-package.zip')).Hash
# The actual original six-part layout may coexist with its verified merged ZIP.
# The update neither reads nor rewrites the old split parts when ZIP is present.
$zipBytes = [IO.File]::ReadAllBytes($fixtureZip)
$partSize = [int][Math]::Ceiling($zipBytes.Length / 6.0)
$partHashes = @{}
for ($number = 1; $number -le 6; $number++) {
    $offset = ($number - 1) * $partSize
    $length = [Math]::Min($partSize, $zipBytes.Length - $offset)
    $bytes = New-Object byte[] $length
    [Array]::Copy($zipBytes, $offset, $bytes, 0, $length)
    $partName = 'native-package.part{0:D2}' -f $number
    $partPath = Join-Path $archiveRoot $partName
    [IO.File]::WriteAllBytes($partPath, $bytes)
    $partHashes[$partName] = (Get-FileHash -LiteralPath $partPath).Hash
}
$null = Invoke-Update $archiveRoot
$destination = Join-Path $archiveRoot $targetName
$manifestBefore = (Get-FileHash -LiteralPath (Join-Path $destination 'UPDATE-MANIFEST.json')).Hash
$exeTime = (Get-Item -LiteralPath (Join-Path $destination $exeName)).LastWriteTimeUtc
$null = Invoke-Update $archiveRoot
Assert-True ((Get-Item -LiteralPath (Join-Path $destination $exeName)).LastWriteTimeUtc -eq $exeTime) 'Repeat launch rewrote the EXE.'
Assert-True (@(Get-ChildItem -LiteralPath $archiveRoot -Directory -Filter 'native-update-*').Count -eq 1) 'Repeat launch created another update directory.'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $archiveRoot 'native-verified-package.zip')).Hash -eq $archiveBefore) 'Original archive was modified.'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $destination 'UPDATE-MANIFEST.json')).Hash -eq $manifestBefore) 'Installed manifest changed on repeat.'
Remove-Item -LiteralPath (Join-Path $archiveRoot 'native-verified-package.zip')
$null = Invoke-Update $archiveRoot
foreach ($partName in $partHashes.Keys) {
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $archiveRoot $partName)).Hash -eq $partHashes[$partName]) 'An original split part changed.'
}
Assert-True (@(Get-ChildItem -LiteralPath $archiveRoot -Directory -Filter 'native-restored-*').Count -eq 0) 'Update unnecessarily extracted an old restored package.'
Write-Host 'PASS: archive plus six parts, exact repeat reuse, and verified update cache without old ZIP.'

foreach ($kind in @('restored', 'direct')) {
    $bundle = New-Bundle ('source ' + $kind) $kind
    $old = if ($kind -eq 'restored') { Join-Path (Join-Path $bundle 'native-restored-20261024-123456') $originalRootName } else { Join-Path $bundle $originalRootName }
    $null = Invoke-Update $bundle
    Assert-True ([IO.File]::ReadAllText((Join-Path $old $pckName)) -ceq 'old-pck-must-survive') 'Original PCK changed.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $old 'old-user-file.txt')) -ceq 'preserve me') 'Old user file changed.'
    $expectedCount = @($manifest.original.files).Count + 2
    Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $bundle $targetName) -File -Recurse).Count -eq $expectedCount) 'Update has incomplete notices or unexpected copied files.'
}
Write-Host 'PASS: bounded restored-folder/direct-original routes preserve the old game and complete notices.'
$manyRoot = New-Bundle 'multiple old directories 中文 空格' 'restored'
$invalidOld = Join-Path (Join-Path $manyRoot 'native-restored-20261024-123456') $originalRootName
[IO.File]::AppendAllText((Join-Path $invalidOld $exeName), 'invalid earlier cache')
$invalidBefore = (Get-FileHash -LiteralPath (Join-Path $invalidOld $exeName)).Hash
$validOldParent = Join-Path $manyRoot 'native-restored-zz-later-valid'
New-Item -ItemType Directory -Path $validOldParent | Out-Null
Copy-Item -LiteralPath $fixtureOriginal -Destination $validOldParent -Recurse
$unrelated = Join-Path $manyRoot 'unrelated-old-package'
New-Item -ItemType Directory -Path $unrelated | Out-Null
Copy-Item -LiteralPath $fixtureOriginal -Destination $unrelated -Recurse
$null = Invoke-Update $manyRoot
Assert-True ((Get-FileHash -LiteralPath (Join-Path $invalidOld $exeName)).Hash -eq $invalidBefore) 'Invalid old folder was changed.'
Assert-True (@(Get-ChildItem -LiteralPath $manyRoot -Directory -Filter 'native-restored-*').Count -eq 2) 'Old directory count changed.'
Write-Host 'PASS: bounded search skips an invalid old folder and finds a later valid folder, preserving both.'

foreach ($case in @('missing-source', 'bad-archive', 'missing-payload', 'changed-payload', 'missing-manifest')) {
    $bundle = New-Bundle $case
    switch ($case) {
        'missing-source' { Remove-Item -LiteralPath (Join-Path $bundle 'native-verified-package.zip') }
        'bad-archive' { [IO.File]::AppendAllText((Join-Path $bundle 'native-verified-package.zip'), 'tampered') }
        'missing-payload' { Remove-Item -LiteralPath (Join-Path $bundle $pckName) }
        'changed-payload' { [IO.File]::AppendAllText((Join-Path $bundle $pckName), 'tampered') }
        'missing-manifest' { Remove-Item -LiteralPath (Join-Path $bundle $manifestName) }
    }
    $null = Invoke-Update $bundle $false
    Assert-True (!(Test-Path -LiteralPath (Join-Path $bundle $targetName))) ('Invalid input created a final directory: ' + $case)
}
Write-Host 'PASS: missing/corrupt sources and update payload never launch.'

$notice = @($manifest.original.files | Where-Object { $_.path.StartsWith('THIRD-PARTY-NOTICES/') })[0].path
foreach ($member in @($exeName, $dllName, $notice)) {
    $bundle = New-Bundle ('bad restored ' + [Guid]::NewGuid().ToString('N').Substring(0, 8)) 'restored'
    $old = Join-Path (Join-Path $bundle 'native-restored-20261024-123456') $originalRootName
    [IO.File]::AppendAllText((Join-Path $old $member), 'tampered')
    $null = Invoke-Update $bundle $false
}
Write-Host 'PASS: restored EXE, DLL, and notice tampering is rejected.'

foreach ($case in @('pck', 'exe', 'dll', 'notice', 'missing-notice', 'manifest', 'forged-cache-manifest', 'extra-file', 'extra-directory', 'junction')) {
    $bundle = New-Bundle ('invalid update ' + $case)
    $null = Invoke-Update $bundle
    $destination = Join-Path $bundle $targetName
    switch ($case) {
        'pck' { [IO.File]::AppendAllText((Join-Path $destination $pckName), 'tampered') }
        'exe' { [IO.File]::AppendAllText((Join-Path $destination $exeName), 'tampered') }
        'dll' { [IO.File]::AppendAllText((Join-Path $destination $dllName), 'tampered') }
        'notice' { [IO.File]::AppendAllText((Join-Path $destination $notice), 'tampered') }
        'missing-notice' { Remove-Item -LiteralPath (Join-Path $destination $notice) }
        'manifest' { [IO.File]::AppendAllText((Join-Path $destination 'UPDATE-MANIFEST.json'), 'tampered') }
        'forged-cache-manifest' {
            $changedPck = Join-Path $destination $pckName
            [IO.File]::AppendAllText($changedPck, 'tampered')
            $forged = $manifestText | ConvertFrom-Json
            $forged.payload.sha256 = (Get-FileHash -LiteralPath $changedPck).Hash
            $forged.payload.bytes = (Get-Item -LiteralPath $changedPck).Length
            [IO.File]::WriteAllText((Join-Path $destination 'UPDATE-MANIFEST.json'), ($forged | ConvertTo-Json -Depth 8), $utf8)
        }
        'extra-file' { [IO.File]::WriteAllText((Join-Path $destination 'foreign.dll'), 'reject this') }
        'extra-directory' { New-Item -ItemType Directory -Path (Join-Path $destination 'foreign-empty') | Out-Null }
        'junction' { New-Item -ItemType Junction -Path (Join-Path $destination 'foreign-link') -Target $fixture | Out-Null }
    }
    $null = Invoke-Update $bundle $false
    Assert-True (@(Get-ChildItem -LiteralPath $bundle -Directory -Filter 'native-update-*').Count -eq 1) 'Invalid update must be preserved, not overwritten.'
}
Write-Host 'PASS: changed/missing/extra/reparse cache members are rejected, never silently launched.'

$junctionBundle = New-Bundle 'source junction rejection' 'none'
$linkRoot = Join-Path $junctionBundle 'native-restored-linked'
New-Item -ItemType Directory -Path $linkRoot | Out-Null
New-Item -ItemType Junction -Path (Join-Path $linkRoot $originalRootName) -Target $fixtureOriginal | Out-Null
$null = Invoke-Update $junctionBundle $false
Write-Host 'PASS: restored source junction is not followed.'
Write-Host 'ALL WINDOWS UPDATE TESTS PASSED.'
