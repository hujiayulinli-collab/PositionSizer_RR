[CmdletBinding()]
param(
    [string]$IncludeRoot = 'C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\MQL5',
    [string]$Editor = 'C:\Program Files\MetaTrader 5\metaeditor64.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'mt5'
$buildRoot = Join-Path $projectRoot '.build\MQL5'
$includeDestination = Join-Path $buildRoot 'Include'
$stageRoot = Join-Path $buildRoot 'Experts\PositionSizerRR'
$sourceName = 'Position Sizer RR.mq5'
$binaryName = 'Position Sizer RR.ex5'
$stageSource = Join-Path $stageRoot $sourceName
$stageBinary = Join-Path $stageRoot $binaryName
$stageLog = Join-Path $stageRoot 'Position Sizer RR.log'
$testRoot = Join-Path $projectRoot 'tests'
$logDestination = Join-Path $testRoot 'compile.log'

if (-not (Test-Path -LiteralPath $Editor -PathType Leaf)) {
    throw "MetaEditor not found: $Editor"
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $sourceName) -PathType Leaf)) {
    throw "EA source not found: $sourceRoot\$sourceName"
}

# Build 6205 rejects some embedded bitmap paths when the source is outside
# the MQL5 root supplied to /include. Stage both sources and the official
# standard library together; never write into the terminal's data folder.
$libraryMarkers = @('Trade\Trade.mqh', 'Controls\Dialog.mqh', 'Object.mqh')
$canReuseLibrary = $true
foreach ($marker in $libraryMarkers) {
    if (-not (Test-Path -LiteralPath (Join-Path $includeDestination $marker) -PathType Leaf)) {
        $canReuseLibrary = $false
    }
}
if (-not $canReuseLibrary) {
    $includeSource = Join-Path $IncludeRoot 'Include'
    foreach ($marker in $libraryMarkers) {
        if (-not (Test-Path -LiteralPath (Join-Path $includeSource $marker) -PathType Leaf)) {
            throw "Official MQL5 standard library missing: $includeSource\$marker. Set -IncludeRoot to the terminal's MQL5 folder."
        }
    }
    New-Item -ItemType Directory -Path $includeDestination -Force | Out-Null
    Get-ChildItem -LiteralPath $includeSource -Force | Copy-Item -Destination $includeDestination -Recurse -Force
}

New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
Get-ChildItem -LiteralPath $sourceRoot -Force | Copy-Item -Destination $stageRoot -Recurse -Force

# Remove only these two build outputs so an earlier successful compilation
# cannot masquerade as a successful run. Check the exact absolute paths.
$stagePrefix = [IO.Path]::GetFullPath($stageRoot).TrimEnd('\') + '\'
foreach ($outputFile in @($stageBinary, $stageLog)) {
    $absoluteOutput = [IO.Path]::GetFullPath($outputFile)
    if (-not $absoluteOutput.StartsWith($stagePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Build output is outside the staging directory: $absoluteOutput"
    }
    if (Test-Path -LiteralPath $absoluteOutput) {
        Remove-Item -LiteralPath $absoluteOutput -Force
    }
}

$startedAt = [DateTime]::UtcNow
$arguments = @(
    '/compile:"' + $stageSource + '"'
    '/include:"' + $buildRoot + '"'
    '/log'
)
$process = Start-Process -FilePath $Editor -ArgumentList $arguments -WorkingDirectory $stageRoot -WindowStyle Hidden -Wait -PassThru

if (-not (Test-Path -LiteralPath $stageLog -PathType Leaf)) {
    "Compilation failed: MetaEditor did not create a log. Exit code: $($process.ExitCode). Started UTC: $($startedAt.ToString('o'))." |
        Set-Content -LiteralPath $logDestination -Encoding UTF8
    throw "MetaEditor did not create a compilation log. See $logDestination"
}
Copy-Item -LiteralPath $stageLog -Destination $logDestination -Force
$logText = Get-Content -LiteralPath $stageLog -Raw
$resultMatches = [regex]::Matches($logText, '(?im)^\s*Result:\s*(\d+)\s+errors?,\s*(\d+)\s+warnings?\b')
if ($resultMatches.Count -eq 0) {
    throw "Compilation log has no final result. See $logDestination"
}
$result = $resultMatches[$resultMatches.Count - 1]
if ([int]$result.Groups[1].Value -ne 0 -or $logText -match '(?im)\s:\s*error\s+\d+\s*:') {
    throw "Compilation reported errors. See $logDestination"
}
if (-not (Test-Path -LiteralPath $stageBinary -PathType Leaf)) {
    throw "Compilation reported zero errors but produced no EX5. See $logDestination"
}
$binary = Get-Item -LiteralPath $stageBinary
$compileLog = Get-Item -LiteralPath $stageLog
if ($binary.Length -eq 0 -or $binary.LastWriteTimeUtc -lt $startedAt -or $compileLog.LastWriteTimeUtc -lt $startedAt) {
    throw "Compilation outputs are empty or older than this run. See $logDestination"
}

$binaryDestination = Join-Path $sourceRoot $binaryName
Copy-Item -LiteralPath $stageBinary -Destination $binaryDestination -Force
Write-Output "Compiled successfully: $binaryDestination"
Write-Output "Result: 0 errors, $($result.Groups[2].Value) warnings. Log: $logDestination"
