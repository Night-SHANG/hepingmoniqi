#requires -Version 5.1
<#
Run with Windows PowerShell, not pwsh:
  powershell.exe -NoProfile -File tests/windows-launcher/test.ps1

This is an integration test of the delivered CMD -> Windows PowerShell ->
six-part ZIP -> Expand-Archive -> real EXE chain. No launcher commands are
mocked. Only the one pinned ZIP hash is substituted in a staged PS1 copy.
The original-script characterization runs first and must reproduce the bug.
#>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (!$Condition) { throw $Message }
}

Assert-True ($env:OS -eq 'Windows_NT') 'This test requires Windows and CMD.'
Assert-True (($PSVersionTable.PSEdition -eq 'Desktop') -and ($PSVersionTable.PSVersion.Major -eq 5)) 'Run this test in Windows PowerShell 5.1, not PowerShell Core/pwsh.'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$launcherSource = Join-Path $repositoryRoot 'tools/windows-launcher'
$batchName = '合并并启动.bat'
$scriptName = 'assemble-native.ps1'
$originalHash = 'FB32CAFEFD1FAA2A791C12C6DB24D8101F9EBA7F5101060DE615DD89177E8A38'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('Windows launcher 中文空格 regression ' + [Guid]::NewGuid().ToString('N'))
$callerDirectory = Join-Path $testRoot 'unrelated caller 非启动目录'
New-Item -ItemType Directory -Path $callerDirectory -Force | Out-Null
Write-Host ('Runtime: Windows PowerShell ' + $PSVersionTable.PSVersion)
Write-Host ('Fixture workspace (diagnostics retained): ' + $testRoot)

function Invoke-CmdLauncher {
    param([string]$BatchPath, [string]$LaunchToken = '')
    # The /s quoting is intentional: execute the actual Chinese-named BAT via
    # CMD, from a different working directory, rather than invoking its PS1.
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $env:ComSpec
    $start.Arguments = '/d /s /c ""' + $BatchPath + '""'
    $start.WorkingDirectory = $callerDirectory
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables['NATIVE_ASSEMBLY_NONINTERACTIVE'] = '1'
    $start.EnvironmentVariables['NATIVE_LAUNCH_TEST_TOKEN'] = $LaunchToken
    $start.EnvironmentVariables['NATIVE_LAUNCH_TEST_MARKER_ROOT'] = Join-Path (Split-Path -Parent $BatchPath) 'launch-evidence'
    $start.EnvironmentVariables['PATH'] = $PSHOME + ';' + $env:PATH
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    try {
        Assert-True ($process.Start()) ('Could not start CMD for ' + $BatchPath)
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        # The unmodified old BAT pauses on failure. An input line plus EOF
        # releases that pause without changing any of its production code.
        $process.StandardInput.WriteLine('')
        $process.StandardInput.Close()
        if (!$process.WaitForExit(30000)) {
            & (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID $process.Id /T /F | Out-Null
            throw ('CMD launcher timed out after 30 seconds: ' + $BatchPath)
        }
        Assert-True ($stdout.Wait(10000)) 'CMD standard output did not close.'
        Assert-True ($stderr.Wait(10000)) 'CMD standard error did not close.'
        $result = [PSCustomObject]@{
            ExitCode = $process.ExitCode
            Output = $stdout.Result + [Environment]::NewLine + $stderr.Result
        }
        Write-Host ('CMD exit: ' + $result.ExitCode)
        Write-Host $result.Output
        return $result
    }
    finally {
        $process.Dispose()
    }
}

# RED characterization: the first two PS1 lines and the complete BAT below
# are verbatim from the original six-part delivery. The BAT can mask its
# PowerShell exit code with PAUSE, so assert the actual root-binding error.
$legacyRoot = Join-Path $testRoot 'old failure 原版复现'
New-Item -ItemType Directory -Path $legacyRoot | Out-Null
$legacyScript = @'
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
'@
$legacyBatch = @'
@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "try { & ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path (Get-Location) 'assemble-native.ps1')))); exit 0 } catch { Write-Host $_; exit 1 }"
if errorlevel 1 pause
'@
[IO.File]::WriteAllText((Join-Path $legacyRoot $scriptName), $legacyScript, $utf8Bom)
[IO.File]::WriteAllText((Join-Path $legacyRoot $batchName), ($legacyBatch -replace "`r?`n", "`r`n") + "`r`n", [Text.Encoding]::ASCII)
$legacy = Invoke-CmdLauncher (Join-Path $legacyRoot $batchName)
Assert-True ($legacy.Output -match 'LiteralPath') 'Old launcher did not reproduce its LiteralPath binding error.'
Assert-True ($legacy.Output -match '(?i)(empty|null)') 'Old launcher did not report an empty/null root path.'
Write-Host 'PASS: original ScriptBlock launcher reproduces empty LiteralPath (RED).'

# Build a real, tiny .NET Framework executable with the compiler included in
# Windows PowerShell. It records its working directory in a per-launch marker outside the cache.
# There is no simulated Start-Process or substituted extraction operation.
$fixtureRootName = 'fixture payload 真实程序'
$fixtureRoot = Join-Path $testRoot $fixtureRootName
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
$fixtureExe = Join-Path $fixtureRoot 'nuclear-native-slice.exe'
$fixtureSource = @'
using System;
using System.IO;
using System.Text;
public static class LauncherFixture {
    public static int Main() {
        string cwd = Environment.CurrentDirectory;
        string token = Environment.GetEnvironmentVariable("NATIVE_LAUNCH_TEST_TOKEN");
        string marker = "fixture-started\n" + token + "\n" + cwd + "\n";
        string markers = Environment.GetEnvironmentVariable("NATIVE_LAUNCH_TEST_MARKER_ROOT");
        Directory.CreateDirectory(markers);
        File.WriteAllText(Path.Combine(markers, token + "-fixture-launch-marker.txt"), marker, new UTF8Encoding(false));
        return 0;
    }
}
'@
Add-Type -TypeDefinition $fixtureSource -Language CSharp -OutputAssembly $fixtureExe -OutputType ConsoleApplication
$readmeText = 'ZIP payload survived reconstruction and extraction.'
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'fixture-readme.txt'), $readmeText, $utf8)
$fixtureZip = Join-Path $testRoot 'fixture-original.zip'
# The production ZIP carries a manifest for every member except itself. The
# launcher must use that manifest from the SHA-verified ZIP, not its cached copy.
$fixtureManifest = [ordered]@{ files = [ordered]@{} }
foreach ($file in @(Get-ChildItem -LiteralPath $fixtureRoot -File)) {
    $fixtureManifest.files[$file.Name] = [ordered]@{
        bytes = $file.Length
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
}
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'PACKAGE-MANIFEST.json'), ($fixtureManifest | ConvertTo-Json -Depth 5), $utf8)
# Pin ZIP entry separators rather than depending on the runner's bundled
# Compress-Archive module version (older Windows modules used backslashes).
# Production still executes its real Expand-Archive operation.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fixtureArchive = [IO.Compression.ZipFile]::Open($fixtureZip, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in @(Get-ChildItem -LiteralPath $fixtureRoot -File)) {
        $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($fixtureArchive, $file.FullName, ($fixtureRootName + '/' + $file.Name), [IO.Compression.CompressionLevel]::Optimal)
    }
}
finally { $fixtureArchive.Dispose() }
$fixtureHash = (Get-FileHash -LiteralPath $fixtureZip -Algorithm SHA256).Hash
$fixtureBytes = [IO.File]::ReadAllBytes($fixtureZip)
$fixtureExeHash = (Get-FileHash -LiteralPath $fixtureExe -Algorithm SHA256).Hash
Assert-True ($fixtureBytes.Length -ge 6) 'Fixture ZIP must have six nonempty parts.'
Assert-True ($fixtureHash -ne $originalHash) 'Fixture unexpectedly has the production ZIP hash.'

# Preserve the production script byte-for-byte except its single expected
# hash literal, including its BOM and line endings. The BAT is copied as-is.
$productionScriptBytes = [IO.File]::ReadAllBytes((Join-Path $launcherSource $scriptName))
$productionScriptText = $utf8.GetString($productionScriptBytes)
$replacementCount = [regex]::Matches($productionScriptText, [regex]::Escape($originalHash)).Count
Assert-True ($replacementCount -eq 1) ('Expected exactly one production SHA literal; found ' + $replacementCount)
$stagedScriptText = $productionScriptText.Replace($originalHash, $fixtureHash)
$restoredSourceBytes = $utf8.GetBytes($stagedScriptText.Replace($fixtureHash, $originalHash))
Assert-True ([Convert]::ToBase64String($restoredSourceBytes) -ceq [Convert]::ToBase64String($productionScriptBytes)) 'Staging changed production PS1 bytes beyond the single expected SHA.'
$baselineScriptText = @'
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
'@
$baselineScriptText = $baselineScriptText.Replace($originalHash, $fixtureHash)

$productionBatchHash = (Get-FileHash -LiteralPath (Join-Path $launcherSource $batchName) -Algorithm SHA256).Hash

function New-StagedBundle {
    param([string]$Name)
    $root = Join-Path $testRoot $Name
    New-Item -ItemType Directory -Path $root | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $root $scriptName), $utf8.GetBytes($stagedScriptText))
    Copy-Item -LiteralPath (Join-Path $launcherSource $batchName) -Destination (Join-Path $root $batchName)
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $root $batchName) -Algorithm SHA256).Hash -eq $productionBatchHash) 'Staged BAT is not byte-identical to production.'
    $partLength = [int][Math]::Ceiling($fixtureBytes.Length / 6.0)
    for ($number = 1; $number -le 6; $number++) {
        $offset = ($number - 1) * $partLength
        $length = [Math]::Min($partLength, $fixtureBytes.Length - $offset)
        Assert-True ($length -gt 0) 'A fixture part was empty.'
        $partBytes = New-Object byte[] $length
        [Array]::Copy($fixtureBytes, $offset, $partBytes, 0, $length)
        [IO.File]::WriteAllBytes((Join-Path $root ('native-package.part{0:D2}' -f $number)), $partBytes)
    }
    return $root
}

function Assert-NoExtractionOrLaunch {
    param([string]$Root)
    Assert-True (@(Get-ChildItem -LiteralPath $Root -Directory -Filter 'native-restored-*').Count -eq 0) 'A failed bundle must not be extracted.'
    Assert-True (@(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter '*-fixture-launch-marker.txt').Count -eq 0) 'A failed bundle must not launch the fixture EXE.'
}

function Wait-LaunchMarker {
    param([string]$Directory, [string]$Token, [string]$Root)
    $marker = Join-Path (Join-Path $Root 'launch-evidence') ($Token + '-fixture-launch-marker.txt')
    $expected = "fixture-started`n$Token`n$Directory`n"
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        if (Test-Path -LiteralPath $marker -PathType Leaf) {
            try {
                if ([IO.File]::ReadAllText($marker) -ceq $expected) { return $marker }
            }
            catch [IO.IOException] { } # The asynchronous EXE may still be writing.
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw ('No complete real-EXE launch marker with the expected working directory/token after 15 seconds: ' + $marker)
}

# Exercise the exact previous helper twice with the same real CMD/WinPS chain.
# The new cache-reuse assertion must fail for the known redundant-extraction
# behavior, not for a setup error. This RED characterization and the GREEN
# production cases below run together on the same Windows runner.
$baselineRoot = New-StagedBundle 'baseline redundant extraction 原先重复解压'
[IO.File]::WriteAllText((Join-Path $baselineRoot $scriptName), $baselineScriptText, $utf8Bom)
$baselineFirstToken = [Guid]::NewGuid().ToString('N')
$baselineFirst = Invoke-CmdLauncher (Join-Path $baselineRoot $batchName) $baselineFirstToken
Assert-True ($baselineFirst.ExitCode -eq 0) 'Baseline first real launch failed before the cache assertion.'
$baselineFirstDirectories = @(Get-ChildItem -LiteralPath $baselineRoot -Directory -Filter 'native-restored-*')
Assert-True ($baselineFirstDirectories.Count -eq 1) 'Baseline first launch did not extract exactly once.'
$null = Wait-LaunchMarker (Join-Path $baselineFirstDirectories[0].FullName $fixtureRootName) $baselineFirstToken $baselineRoot
$baselineSecondToken = [Guid]::NewGuid().ToString('N')
$baselineSecond = Invoke-CmdLauncher (Join-Path $baselineRoot $batchName) $baselineSecondToken
Assert-True ($baselineSecond.ExitCode -eq 0) 'Baseline second real launch failed before the cache assertion.'
$baselineDirectories = @(Get-ChildItem -LiteralPath $baselineRoot -Directory -Filter 'native-restored-*')
Assert-True ($baselineDirectories.Count -eq 2) 'Baseline did not reproduce its redundant second extraction.'
$baselineNewDirectory = @($baselineDirectories | Where-Object { $_.FullName -ne $baselineFirstDirectories[0].FullName })
$null = Wait-LaunchMarker (Join-Path $baselineNewDirectory[0].FullName $fixtureRootName) $baselineSecondToken $baselineRoot
$expectedCacheFailure = $false
try {
    Assert-True ($baselineDirectories.Count -eq 1) 'Valid cache must be reused instead of re-extracting another directory.'
}
catch {
    if ($_.Exception.Message -ne 'Valid cache must be reused instead of re-extracting another directory.') { throw }
    $expectedCacheFailure = $true
}
Assert-True $expectedCacheFailure 'The new reuse assertion did not detect the baseline redundant-extraction bug.'
Write-Host 'PASS: cache-reuse assertion fails against two successful baseline launches (RED).'

# Removing the part-existence check must fail this test before any output ZIP
# or extraction is created. Run from the unrelated caller directory again.
$missingRoot = New-StagedBundle 'missing part 缺少分片'
Remove-Item -LiteralPath (Join-Path $missingRoot 'native-package.part06')
$missing = Invoke-CmdLauncher (Join-Path $missingRoot $batchName)
Assert-True ($missing.ExitCode -ne 0) 'Missing part must return a nonzero CMD exit code.'
Assert-True ($missing.Output -match 'Missing native-package\.part06') 'Missing-part error did not identify part06.'
Assert-True (!(Test-Path -LiteralPath (Join-Path $missingRoot 'native-verified-package.zip'))) 'Missing part must be rejected before reconstruction.'
Assert-NoExtractionOrLaunch $missingRoot
Write-Host 'PASS: missing sixth part fails safely through the actual BAT.'

# Flip a byte without changing filenames or sizes. Bypassing hash validation
# must fail the checksum-specific assertion, even if ZIP extraction also fails.
$corruptRoot = New-StagedBundle 'checksum failure 校验损坏'
$corruptPart = Join-Path $corruptRoot 'native-package.part03'
$corruptBytes = [IO.File]::ReadAllBytes($corruptPart)
$corruptOffset = [int][Math]::Floor($corruptBytes.Length / 2.0)
$corruptBytes[$corruptOffset] = [byte]($corruptBytes[$corruptOffset] -bxor 1)
[IO.File]::WriteAllBytes($corruptPart, $corruptBytes)
$corrupt = Invoke-CmdLauncher (Join-Path $corruptRoot $batchName)
Assert-True ($corrupt.ExitCode -ne 0) 'Corrupt part must return a nonzero CMD exit code.'
Assert-True ($corrupt.Output -match 'Checksum mismatch') 'Corrupt bytes did not reach the checksum rejection.'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $corruptRoot 'native-verified-package.zip') -Algorithm SHA256).Hash -ne $fixtureHash) 'Corruption did not alter the reconstructed ZIP.'
Assert-NoExtractionOrLaunch $corruptRoot
Write-Host 'PASS: checksum corruption is rejected before extraction or launch.'

# GREEN: all six parts are consumed in order, verified, extracted and launched
# by the unchanged production BAT/PS1 chain in a Chinese path with spaces.
$successRoot = New-StagedBundle 'successful launch 中文和空格'
$partHashes = @{}
1..6 | ForEach-Object {
    $name = 'native-package.part{0:D2}' -f $_
    $partHashes[$name] = (Get-FileHash -LiteralPath (Join-Path $successRoot $name) -Algorithm SHA256).Hash
}
$firstToken = [Guid]::NewGuid().ToString('N')
$first = Invoke-CmdLauncher (Join-Path $successRoot $batchName) $firstToken
Assert-True ($first.ExitCode -eq 0) 'Valid six-part bundle failed through the actual CMD launcher.'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $successRoot 'native-verified-package.zip') -Algorithm SHA256).Hash -eq $fixtureHash) 'Six-part reconstruction was not byte-exact.'
$firstRestorations = @(Get-ChildItem -LiteralPath $successRoot -Directory -Filter 'native-restored-*')
Assert-True ($firstRestorations.Count -eq 1) 'First run must create exactly one restored package.'
$firstGameDirectory = Join-Path $firstRestorations[0].FullName $fixtureRootName
$firstMarker = Wait-LaunchMarker $firstGameDirectory $firstToken $successRoot
$firstMarkerContent = [IO.File]::ReadAllText($firstMarker)
Assert-True ([IO.File]::ReadAllText((Join-Path $firstGameDirectory 'fixture-readme.txt')) -ceq $readmeText) 'Extracted payload contents were not preserved.'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $firstGameDirectory 'nuclear-native-slice.exe') -Algorithm SHA256).Hash -eq $fixtureExeHash) 'Extracted EXE differs from the compiled fixture.'
Write-Host 'PASS: six parts reconstruct, verify, extract and launch a real EXE (GREEN).'

# Cache-hit regression: re-expanding or rewriting the verified ZIP must fail
# these checks. The real EXE writes markers outside the immutable cache tree.
$mergedZip = Join-Path $successRoot 'native-verified-package.zip'
$preservedZipTime = [DateTime]::SpecifyKind([DateTime]'2020-01-02T03:04:05', [DateTimeKind]::Utc)
[IO.File]::SetLastWriteTimeUtc($mergedZip, $preservedZipTime)
$secondToken = [Guid]::NewGuid().ToString('N')
$second = Invoke-CmdLauncher (Join-Path $successRoot $batchName) $secondToken
Assert-True ($second.ExitCode -eq 0) 'Repeating a successful launcher run failed.'
$allRestorations = @(Get-ChildItem -LiteralPath $successRoot -Directory -Filter 'native-restored-*')
Assert-True ($allRestorations.Count -eq 1) 'Valid cache must be reused instead of re-extracting another directory.'
$null = Wait-LaunchMarker $firstGameDirectory $secondToken $successRoot
Assert-True ([IO.File]::GetLastWriteTimeUtc($mergedZip) -eq $preservedZipTime) 'Valid cache hit rewrote the merged ZIP.'
Assert-True ([IO.File]::ReadAllText($firstMarker) -ceq $firstMarkerContent) 'Repeated run modified the first launch marker.'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $firstGameDirectory 'nuclear-native-slice.exe') -Algorithm SHA256).Hash -eq $fixtureExeHash) 'Repeated run modified the first restored EXE.'
Write-Host 'PASS: valid cache relaunches the real EXE without extraction or ZIP writes.'

function Assert-FreshCacheAfterDamage {
    param([string]$DamagedDirectory, [string]$Description)
    $before = @(Get-ChildItem -LiteralPath $successRoot -Directory -Filter 'native-restored-*')
    $token = [Guid]::NewGuid().ToString('N')
    $result = Invoke-CmdLauncher (Join-Path $successRoot $batchName) $token
    Assert-True ($result.ExitCode -eq 0) ($Description + ': valid source package must recover safely.')
    $after = @(Get-ChildItem -LiteralPath $successRoot -Directory -Filter 'native-restored-*')
    Assert-True ($after.Count -eq ($before.Count + 1)) ($Description + ': must create a fresh cache without overwriting the damaged one.')
    $new = @($after | Where-Object { $_.FullName -notin $before.FullName })
    Assert-True ($new.Count -eq 1) ($Description + ': expected one fresh extraction.')
    $directory = Join-Path $new[0].FullName $fixtureRootName
    $null = Wait-LaunchMarker $directory $token $successRoot
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $directory 'nuclear-native-slice.exe') -Algorithm SHA256).Hash -eq $fixtureExeHash) ($Description + ': recovered EXE must be the authentic ZIP member.')
    Assert-True (Test-Path -LiteralPath $DamagedDirectory -PathType Container) ($Description + ': previous directory was removed.')
    Write-Host ('PASS: ' + $Description + ' triggers fresh verified extraction, preserving the old directory.')
    return $directory
}

# Hash only the manifest or trust file sizes and this altered executable will
# be incorrectly reused. Deliberately preserve the EXE size and timestamp.
$damagedExe = Join-Path $firstGameDirectory 'nuclear-native-slice.exe'
$exeTime = [IO.File]::GetLastWriteTimeUtc($damagedExe)
$damagedBytes = [IO.File]::ReadAllBytes($damagedExe)
$damagedBytes[$damagedBytes.Length - 1] = [byte]($damagedBytes[$damagedBytes.Length - 1] -bxor 1)
[IO.File]::WriteAllBytes($damagedExe, $damagedBytes)
[IO.File]::SetLastWriteTimeUtc($damagedExe, $exeTime)
$damagedHash = (Get-FileHash -LiteralPath $damagedExe -Algorithm SHA256).Hash
$recoveredDirectory = Assert-FreshCacheAfterDamage $firstGameDirectory 'Same-size altered EXE'
Assert-True ((Get-FileHash -LiteralPath $damagedExe -Algorithm SHA256).Hash -eq $damagedHash) 'Recovery overwrote the user-altered EXE.'

# A self-consistent counterfeit cached manifest must not bless changed bytes.
$counterfeitReadme = Join-Path $recoveredDirectory 'fixture-readme.txt'
[IO.File]::WriteAllText($counterfeitReadme, 'Counterfeit cached payload', $utf8)
$cachedManifestPath = Join-Path $recoveredDirectory 'PACKAGE-MANIFEST.json'
$cachedManifest = [IO.File]::ReadAllText($cachedManifestPath) | ConvertFrom-Json
$cachedManifest.files.'fixture-readme.txt'.bytes = (Get-Item -LiteralPath $counterfeitReadme).Length
$cachedManifest.files.'fixture-readme.txt'.sha256 = (Get-FileHash -LiteralPath $counterfeitReadme -Algorithm SHA256).Hash
[IO.File]::WriteAllText($cachedManifestPath, ($cachedManifest | ConvertTo-Json -Depth 5), $utf8)
$counterfeitManifestHash = (Get-FileHash -LiteralPath $cachedManifestPath -Algorithm SHA256).Hash
$recoveredDirectory = Assert-FreshCacheAfterDamage $recoveredDirectory 'Counterfeit cached manifest'
Assert-True ((Get-FileHash -LiteralPath $cachedManifestPath -Algorithm SHA256).Hash -eq $counterfeitManifestHash) 'Recovery overwrote the counterfeit cached manifest.'

# A partial extraction cannot be considered complete merely because EXE exists.
$partialReadme = Join-Path $recoveredDirectory 'fixture-readme.txt'
Remove-Item -LiteralPath $partialReadme
$recoveredDirectory = Assert-FreshCacheAfterDamage $recoveredDirectory 'Missing cached member'
Assert-True (!(Test-Path -LiteralPath $partialReadme)) 'Recovery repaired a prior directory in place.'

# Reject unexpected members too: an additional DLL beside an authentic EXE
# must not be trusted simply because all listed original files still hash.
$extraFile = Join-Path $recoveredDirectory 'unexpected-library.dll'
[IO.File]::WriteAllText($extraFile, 'User-created file, preserve it.', $utf8)
$extraHash = (Get-FileHash -LiteralPath $extraFile -Algorithm SHA256).Hash
$recoveredDirectory = Assert-FreshCacheAfterDamage $recoveredDirectory 'Unexpected cached member'
Assert-True ((Get-FileHash -LiteralPath $extraFile -Algorithm SHA256).Hash -eq $extraHash) 'Recovery removed or overwrote an extra user file.'

# The full archive SHA is the cache key, even though directory names stay
# short for Windows PowerShell 5.1 path compatibility. A key is never proof.
$wrongKeyPath = Join-Path (Split-Path -Parent $recoveredDirectory) '.native-archive-sha256'
[IO.File]::WriteAllText($wrongKeyPath, ('0' * 64), $utf8)
$recoveredDirectory = Assert-FreshCacheAfterDamage $recoveredDirectory 'Wrong full archive cache key'
Assert-True ([IO.File]::ReadAllText($wrongKeyPath) -ceq ('0' * 64)) 'Recovery rewrote a prior cache key.'

# Do not follow junctions while checking caches, even if their target files
# are readable. A user-created target and its bytes must remain untouched.
$externalDirectory = Join-Path $successRoot 'external user files'
New-Item -ItemType Directory -Path $externalDirectory | Out-Null
$externalSentinel = Join-Path $externalDirectory 'keep.txt'
[IO.File]::WriteAllText($externalSentinel, 'External user content must remain unchanged.', $utf8)
# Keep the target empty so only the reparse guard can reject it; an extra
# file-count mismatch must not accidentally make this regression pass.
$emptyExternalTarget = Join-Path $externalDirectory 'empty linked target'
New-Item -ItemType Directory -Path $emptyExternalTarget | Out-Null
$junctionPath = Join-Path $recoveredDirectory 'linked-user-folder'
New-Item -ItemType Junction -Path $junctionPath -Target $emptyExternalTarget | Out-Null
Assert-True (((Get-Item -LiteralPath $junctionPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) 'Junction fixture was not a reparse point.'
$recoveredDirectory = Assert-FreshCacheAfterDamage $recoveredDirectory 'Reparse-point cache'
Assert-True ([IO.File]::ReadAllText($externalSentinel) -ceq 'External user content must remain unchanged.') 'Cache validation changed files beyond its root.'
Assert-True (Test-Path -LiteralPath $junctionPath) 'Cache recovery removed the user-created junction.'

# Re-authenticate the merged ZIP too: existence, length and a valid cache do
# not make an altered archive trustworthy. Intact parts may reconstruct it.
$alteredZip = [IO.File]::ReadAllBytes($mergedZip)
$alteredZip[0] = [byte]($alteredZip[0] -bxor 1)
[IO.File]::WriteAllBytes($mergedZip, $alteredZip)
$archiveRepairToken = [Guid]::NewGuid().ToString('N')
$archiveRepairBefore = @(Get-ChildItem -LiteralPath $successRoot -Directory -Filter 'native-restored-*').Count
$archiveRepair = Invoke-CmdLauncher (Join-Path $successRoot $batchName) $archiveRepairToken
Assert-True ($archiveRepair.ExitCode -eq 0) 'Intact source parts did not repair an altered merged ZIP.'
Assert-True ((Get-FileHash -LiteralPath $mergedZip -Algorithm SHA256).Hash -eq $fixtureHash) 'Altered merged ZIP was not reconstructed byte-exactly.'
Assert-True (@(Get-ChildItem -LiteralPath $successRoot -Directory -Filter 'native-restored-*').Count -eq $archiveRepairBefore) 'Archive repair unnecessarily re-extracted an authentic cache.'
$null = Wait-LaunchMarker $recoveredDirectory $archiveRepairToken $successRoot
Write-Host 'PASS: altered merged ZIP is re-authenticated and repaired from intact parts before cache reuse.'

# Cached bytes do not excuse corrupt source parts. Restoring the damaged part
# below is a fixture action only, never behavior requested of the launcher.
$warmPart = Join-Path $successRoot 'native-package.part03'
$warmOriginal = [IO.File]::ReadAllBytes($warmPart)
$warmDamaged = [byte[]]$warmOriginal.Clone()
$warmDamaged[0] = [byte]($warmDamaged[0] -bxor 1)
[IO.File]::WriteAllBytes($warmPart, $warmDamaged)
$warmToken = [Guid]::NewGuid().ToString('N')
$warmBeforeCount = @(Get-ChildItem -LiteralPath $successRoot -Directory -Filter 'native-restored-*').Count
$warmCorrupt = Invoke-CmdLauncher (Join-Path $successRoot $batchName) $warmToken
Assert-True ($warmCorrupt.ExitCode -ne 0) 'Valid cache must not bypass corrupt source-part validation.'
Assert-True ($warmCorrupt.Output -match 'Checksum mismatch') 'Warm corrupt source must report its checksum rejection.'
Assert-True (@(Get-ChildItem -LiteralPath $successRoot -Directory -Filter 'native-restored-*').Count -eq $warmBeforeCount) 'Corrupt warm source triggered extraction.'
Assert-True (!(Test-Path -LiteralPath (Join-Path (Join-Path $successRoot 'launch-evidence') ($warmToken + '-fixture-launch-marker.txt')))) 'Corrupt warm source launched a cached EXE.'
[IO.File]::WriteAllBytes($warmPart, $warmOriginal)
Write-Host 'PASS: valid cache cannot bypass source-part checksum validation.'

foreach ($name in $partHashes.Keys) {
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $successRoot $name) -Algorithm SHA256).Hash -eq $partHashes[$name]) ('Launcher modified input part ' + $name)
}
Assert-True ((Get-FileHash -LiteralPath $mergedZip -Algorithm SHA256).Hash -eq $fixtureHash) 'Cache operations changed the verified ZIP.'
Write-Host 'WINDOWS_LAUNCHER_TESTS_PASSED: old-root-red, missing-part, checksum, actual-exe-green, valid-cache-reuse, altered-exe, counterfeit-manifest, partial-cache, extra-member, wrong-key, reparse-point, altered-archive, warm-source-checksum; Windows PowerShell 5.1 + CMD.'
