# Generic resumable-by-chunk downloader used by the Windows runtime lab. The
# caller must provide the expected size and verify the final artifact hash.
param(
  [Parameter(Mandatory = $true)]
  [string]$Url,

  [Parameter(Mandatory = $true)]
  [string]$Destination,

  [Parameter(Mandatory = $true)]
  [long]$ExpectedSize,

  [ValidateRange(1, 64)]
  [int]$Chunks = 16
)

$ErrorActionPreference = "Stop"
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
$destinationDirectory = [System.IO.Path]::GetDirectoryName($destinationPath)
$temporaryDirectory = "$destinationPath.fabi-parts"
$assembledPath = "$destinationPath.fabi-download"

if (Test-Path -LiteralPath $destinationPath) {
  $existingSize = (Get-Item -LiteralPath $destinationPath).Length
  if ($existingSize -eq $ExpectedSize) {
    Write-Output "already-complete:${destinationPath}:$existingSize"
    exit 0
  }
}

[System.IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null
Remove-Item -LiteralPath $assembledPath -Force -ErrorAction SilentlyContinue
[System.IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null

$chunkSize = [long][Math]::Ceiling($ExpectedSize / [double]$Chunks)
$transfers = @()

for ($index = 0; $index -lt $Chunks; $index++) {
  $start = [long]$index * $chunkSize
  if ($start -ge $ExpectedSize) {
    break
  }

  $end = [Math]::Min($ExpectedSize - 1, $start + $chunkSize - 1)
  $partPath = Join-Path $temporaryDirectory ("part-{0:D3}" -f $index)
  $expectedPartSize = $end - $start + 1
  if ((Test-Path -LiteralPath $partPath) -and (Get-Item -LiteralPath $partPath).Length -eq $expectedPartSize) {
    $transfers += [PSCustomObject]@{
      Index = $index
      Start = $start
      End = $end
      Path = $partPath
      Process = $null
    }
    continue
  }

  Remove-Item -LiteralPath $partPath -Force -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath "curl.exe" -ArgumentList @(
    "--fail",
    "--location",
    "--retry", "5",
    "--retry-all-errors",
    "--silent",
    "--show-error",
    "--range", "$start-$end",
    "--output", $partPath,
    $Url
  ) -NoNewWindow -PassThru

  $transfers += [PSCustomObject]@{
    Index = $index
    Start = $start
    End = $end
    Path = $partPath
    Process = $process
  }
}

foreach ($transfer in $transfers) {
  if ($null -ne $transfer.Process) { $transfer.Process.WaitForExit() }
}

foreach ($transfer in $transfers) {
  $expectedPartSize = $transfer.End - $transfer.Start + 1
  $actualPartSize = if (Test-Path -LiteralPath $transfer.Path) {
    (Get-Item -LiteralPath $transfer.Path).Length
  } else {
    0
  }
  if ($actualPartSize -ne $expectedPartSize) {
    throw "range $($transfer.Start)-$($transfer.End) returned $actualPartSize bytes; expected $expectedPartSize"
  }
}

$output = [System.IO.File]::Open(
  $assembledPath,
  [System.IO.FileMode]::CreateNew,
  [System.IO.FileAccess]::Write,
  [System.IO.FileShare]::None
)

try {
  foreach ($transfer in ($transfers | Sort-Object Index)) {
    $input = [System.IO.File]::OpenRead($transfer.Path)
    try {
      $input.CopyTo($output)
    } finally {
      $input.Dispose()
    }
  }
} finally {
  $output.Dispose()
}

$assembledSize = (Get-Item -LiteralPath $assembledPath).Length
if ($assembledSize -ne $ExpectedSize) {
  throw "assembled file has $assembledSize bytes; expected $ExpectedSize"
}

Move-Item -LiteralPath $assembledPath -Destination $destinationPath -Force
Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
Write-Output "download-complete:${destinationPath}:$assembledSize"
