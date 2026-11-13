# Fourmiz - installe Git et publie le dossier sur GitHub
$dir = Join-Path $HOME 'Documents\Claude-Code-Game-Studios\prototypes\fourmiz'
$repo = 'https://github.com/michelristic11-hub/fourmiz.git'
Set-Location $dir
$log = Join-Path $dir 'publier-log.txt'
"Publication Fourmiz - $(Get-Date)" | Out-File $log -Encoding utf8

function Log($msg) { Write-Host ''; Write-Host "=== $msg ===" -ForegroundColor Cyan; "=== $msg ===" | Out-File $log -Append -Encoding utf8 }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
function Fin($code) { Write-Host ''; Read-Host 'Appuie sur Entree pour fermer'; exit $code }
function Run { $out = & git @args 2>&1; $out | Out-File $log -Append -Encoding utf8; $out | ForEach-Object { Write-Host $_ }; return $LASTEXITCODE }

Log '1/4 Git'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'Installation de Git (accepte la fenetre de Windows si elle apparait)...'
  winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements 2>&1 | Tee-Object -FilePath $log -Append
  Refresh-Path
  $env:Path = $env:Path + ';C:\Program Files\Git\cmd'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'Git est introuvable. Installe-le depuis https://git-scm.com/download/win puis relance ce script.' -ForegroundColor Red
  'ECHEC: git introuvable' | Out-File $log -Append -Encoding utf8
  Fin 1
}
Run --version | Out-Null

Log '2/4 Liaison avec le depot GitHub'
if (-not (Test-Path (Join-Path $dir '.git'))) {
  Run init -b main | Out-Null
  Run remote add origin $repo | Out-Null
}
Run config user.name 'michelristic11-hub' | Out-Null
Run config user.email 'michelristic11-hub@users.noreply.github.com' | Out-Null
Run fetch origin | Out-Null
$hasRemote = (& git rev-parse --verify --quiet origin/main 2>$null)
if ($hasRemote -and -not (& git rev-parse --verify --quiet HEAD 2>$null)) { Run reset origin/main | Out-Null }

Log '3/4 Enregistrement des fichiers'
Run add -A | Out-Null
Run status --short | Out-Null
$msg = 'Mise a jour de Fourmiz - ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
Run commit -m $msg | Out-Null

Log '4/4 Envoi sur GitHub (une fenetre de connexion GitHub peut s ouvrir)'
Write-Host 'Si une fenetre GitHub s ouvre, choisis "Sign in with your browser" et autorise.' -ForegroundColor Yellow
$code = Run push -u origin main
if ($code -eq 0) {
  Write-Host ''
  Write-Host 'TERMINE ! Le site sera a jour dans 1 a 2 minutes : https://michelristic11-hub.github.io/fourmiz/' -ForegroundColor Green
  'OK: push reussi' | Out-File $log -Append -Encoding utf8
} else {
  Write-Host ''
  Write-Host 'L envoi n a pas abouti. Dis-le a Claude : il lira le fichier publier-log.txt.' -ForegroundColor Red
}
Fin 0
