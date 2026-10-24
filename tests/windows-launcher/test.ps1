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
# Windows PowerShell. It writes a per-launch marker in its working directory.
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
        File.WriteAllText(Path.Combine(cwd, "fixture-launch-marker.txt"), marker, new UTF8Encoding(false));
        return 0;
    }
}
'@
Add-Type -TypeDefinition $fixtureSource -Language CSharp -OutputAssembly $fixtureExe -OutputType ConsoleApplication
$readmeText = 'ZIP payload survived reconstruction and extraction.'
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'fixture-readme.txt'), $readmeText, $utf8)
$fixtureZip = Join-Path $testRoot 'fixture-original.zip'
Compress-Archive -LiteralPath $fixtureRoot -DestinationPath $fixtureZip
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
    Assert-True (@(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter 'fixture-launch-marker.txt').Count -eq 0) 'A failed bundle must not launch the fixture EXE.'
}

function Wait-LaunchMarker {
    param([string]$Directory, [string]$Token)
    $marker = Join-Path $Directory 'fixture-launch-marker.txt'
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
$firstMarker = Wait-LaunchMarker $firstGameDirectory $firstToken
$firstMarkerContent = [IO.File]::ReadAllText($firstMarker)
Assert-True ([IO.File]::ReadAllText((Join-Path $firstGameDirectory 'fixture-readme.txt')) -ceq $readmeText) 'Extracted payload contents were not preserved.'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $firstGameDirectory 'nuclear-native-slice.exe') -Algorithm SHA256).Hash -eq $fixtureExeHash) 'Extracted EXE differs from the compiled fixture.'
Write-Host 'PASS: six parts reconstruct, verify, extract and launch a real EXE (GREEN).'

# A repeat must launch again without overwriting the earlier restored package
# or modifying any supplied parts. A fresh token rules out a stale marker.
$secondToken = [Guid]::NewGuid().ToString('N')
$second = Invoke-CmdLauncher (Join-Path $successRoot $batchName) $secondToken
Assert-True ($second.ExitCode -eq 0) 'Repeating a successful launcher run failed.'
$allRestorations = @(Get-ChildItem -LiteralPath $successRoot -Directory -Filter 'native-restored-*')
Assert-True ($allRestorations.Count -eq 2) 'Repeated run must preserve the first restoration and create one new restoration.'
$newRestorations = @($allRestorations | Where-Object { $_.FullName -ne $firstRestorations[0].FullName })
Assert-True ($newRestorations.Count -eq 1) 'Repeated run did not produce one distinct restoration.'
$secondGameDirectory = Join-Path $newRestorations[0].FullName $fixtureRootName
$null = Wait-LaunchMarker $secondGameDirectory $secondToken
Assert-True ([IO.File]::ReadAllText($firstMarker) -ceq $firstMarkerContent) 'Repeated run modified the first launch marker.'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $firstGameDirectory 'nuclear-native-slice.exe') -Algorithm SHA256).Hash -eq $fixtureExeHash) 'Repeated run modified the first restored EXE.'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $successRoot 'native-verified-package.zip') -Algorithm SHA256).Hash -eq $fixtureHash) 'Repeated reconstruction changed the ZIP.'
foreach ($name in $partHashes.Keys) {
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $successRoot $name) -Algorithm SHA256).Hash -eq $partHashes[$name]) ('Launcher modified input part ' + $name)
}
Write-Host 'PASS: repeated run launches again and preserves earlier restoration and all six parts.'
Write-Host 'WINDOWS_LAUNCHER_TESTS_PASSED: old-root-red, missing-part, checksum, actual-exe-green, repeated-run; Windows PowerShell 5.1 + CMD.'
