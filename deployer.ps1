# Fourmiz - deploiement automatique du serveur Firebase
$dir = Join-Path $HOME 'Documents\Claude-Code-Game-Studios\prototypes\fourmiz'
Set-Location $dir
$log = Join-Path $dir 'deploiement-log.txt'
"Deploiement Fourmiz - $(Get-Date)" | Out-File $log -Encoding utf8

function Log($msg) { Write-Host ''; Write-Host "=== $msg ===" -ForegroundColor Cyan; "=== $msg ===" | Out-File $log -Append -Encoding utf8 }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
function Fin($code) { Write-Host ''; Read-Host 'Appuie sur Entree pour fermer'; exit $code }

Log '1/5 Node.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Installation de Node.js (accepte la fenetre de Windows si elle apparait)...'
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements 2>&1 | Tee-Object -FilePath $log -Append
  Refresh-Path
}
node --version 2>&1 | Tee-Object -FilePath $log -Append
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js est introuvable. Installe-le depuis https://nodejs.org (version LTS), redemarre le PC et relance ce script.' -ForegroundColor Red
  'ECHEC: node introuvable' | Out-File $log -Append -Encoding utf8
  Fin 1
}

Log '2/5 Outils Firebase'
npm install -g firebase-tools 2>&1 | Tee-Object -FilePath $log -Append
Refresh-Path
$env:Path = $env:Path + ';' + (Join-Path $env:APPDATA 'npm')
firebase --version 2>&1 | Tee-Object -FilePath $log -Append

Log '3/5 Connexion a Firebase (ton navigateur va s ouvrir)'
Write-Host 'Connecte-toi avec le meme compte Google que pour Firebase.' -ForegroundColor Yellow
Write-Host 'Si on te demande d autoriser la collecte d informations, reponds n.' -ForegroundColor Yellow
firebase login
firebase projects:list 2>&1 | Tee-Object -FilePath $log -Append

Log '4/5 Dependances du serveur'
Push-Location functions
npm install 2>&1 | Tee-Object -FilePath $log -Append
Pop-Location

Log '5/5 Deploiement (2 a 5 minutes)'
firebase deploy --only "functions,database" --force 2>&1 | ForEach-Object { "$_"; "$_" | Out-File $log -Append -Encoding utf8 }
$ok = ($LASTEXITCODE -eq 0)

if ($ok) {
  Write-Host ''
  Write-Host 'TERMINE ! Attends 1 minute puis ouvre https://michelristic11-hub.github.io/fourmiz/' -ForegroundColor Green
  'OK: deploiement reussi' | Out-File $log -Append -Encoding utf8
} else {
  Write-Host ''
  Write-Host 'Le deploiement n a pas abouti. Dis-le a Claude : il lira le fichier deploiement-log.txt.' -ForegroundColor Red
  'ECHEC: deploiement' | Out-File $log -Append -Encoding utf8
}
Fin 0
