# Legacy Windows lab bootstrap. This downloads the pinned NVIDIA CUDA 12.6.3
# installer and verifies its SHA256 before execution. The final Fabi installer
# must perform platform detection and must not blindly rerun this script.
$ErrorActionPreference = "Stop"

$root = Join-Path $env:LOCALAPPDATA "fabi"
$downloader = Join-Path $root "parallel-range-download.ps1"
$installer = Join-Path $root "cuda_12.6.3_windows.exe"
$log = Join-Path $root "cuda-install-e2e.log"
$url = "https://developer.download.nvidia.com/compute/cuda/12.6.3/local_installers/cuda_12.6.3_561.17_windows.exe"
$expectedSize = 3227678920
$sha256 = "D73E937C75AAA8114DA3AFF4EEE96F9CAE03D4B9D70A30B962CCF3C9B4D7A8E1"

try {
  "run-start:$([DateTimeOffset]::Now.ToString('o'))" | Add-Content $log
  if (-not (Test-Path $installer) -or (Get-Item $installer).Length -ne $expectedSize) {
    & $downloader -Url $url -Destination $installer -ExpectedSize $expectedSize -Chunks 24 *>> $log
    if ($LASTEXITCODE -ne 0) {
      throw "CUDA installer download failed with exit code $LASTEXITCODE"
    }
  }

  $actualSha256 = (Get-FileHash $installer -Algorithm SHA256).Hash
  if ($actualSha256 -ne $sha256) {
    throw "CUDA installer checksum mismatch: $actualSha256"
  }
  "checksum-ok:$actualSha256" | Add-Content $log

  $process = Start-Process -FilePath $installer -ArgumentList "-y", "-gm2", "-s", "-n" -Wait -PassThru
  "installer-exit:$($process.ExitCode)" | Add-Content $log
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "CUDA installer failed with exit code $($process.ExitCode)"
  }
} catch {
  "error:$($_.Exception.GetType().FullName):$($_.Exception.Message)" | Add-Content $log
  "position:$($_.InvocationInfo.PositionMessage)" | Add-Content $log
  throw
}
