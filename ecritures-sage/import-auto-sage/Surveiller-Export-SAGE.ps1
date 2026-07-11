<#
.SYNOPSIS
    Surveille le dossier des exports « Écritures SAGE » et importe automatiquement
    dans SAGE 100 chaque nouveau fichier, sans clic manuel.

.DESCRIPTION
    Boucle en tâche de fond : dès qu'un fichier « SAGE_ECRITURES_*.txt » apparaît
    dans le dossier surveillé (votre clic sur « Exporter SAGE »), il est importé
    dans SAGE via Importer-Ecritures-SAGE.ps1, puis déplacé dans « Traités »
    (ou « Erreurs » en cas de problème). Tout est journalisé.

    À lancer avec le PowerShell 32 bits (Objets métiers Sage = 32 bits) :
        C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe

.PARAMETER ConfigPath
    Fichier de configuration JSON (défaut : config.json à côté du script).

.PARAMETER DryRun
    Analyse seulement (ne touche pas à SAGE) — pratique pour valider la
    surveillance et l'archivage avant de brancher les Objets métiers.

.PARAMETER IntervalleSecondes
    Fréquence de scrutation du dossier (défaut : 2 s).
#>
[CmdletBinding()]
param(
    [string]$ConfigPath = "$PSScriptRoot\config.json",
    [switch]$DryRun,
    [int]$IntervalleSecondes = 2
)

$ErrorActionPreference = 'Stop'
$importer = Join-Path $PSScriptRoot 'Importer-Ecritures-SAGE.ps1'

if (-not (Test-Path $ConfigPath)) { throw "Configuration introuvable : $ConfigPath (copiez config.exemple.json en config.json)." }
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json

foreach ($d in @($cfg.DossierTraites, $cfg.DossierErreurs)) {
    if ($d -and -not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

function Write-Log {
    param([string]$Message, [string]$Niveau = 'INFO')
    $ligne = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Niveau, $Message
    Write-Host $ligne
    if ($cfg.FichierLog) {
        $dossierLog = Split-Path $cfg.FichierLog -Parent
        if ($dossierLog -and -not (Test-Path $dossierLog)) { New-Item -ItemType Directory -Path $dossierLog -Force | Out-Null }
        Add-Content -Path $cfg.FichierLog -Value $ligne -Encoding UTF8
    }
}

# Attend qu'un fichier soit totalement écrit (taille stable + non verrouillé).
function Wait-FileReady {
    param([string]$Path, [int]$MaxSecondes = 30)
    $t = 0; $tailleAvant = -1
    while ($t -lt $MaxSecondes) {
        try {
            $taille = (Get-Item $Path).Length
            if ($taille -eq $tailleAvant -and $taille -gt 0) {
                $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'None')  # test de verrou
                $fs.Close()
                return $true
            }
            $tailleAvant = $taille
        } catch { }
        Start-Sleep -Seconds 1; $t++
    }
    return $false
}

function Process-File {
    param([string]$Path)
    $nom = Split-Path $Path -Leaf
    if (-not (Wait-FileReady -Path $Path)) { Write-Log "Fichier non prêt (verrouillé ?) : $nom" 'WARN'; return }

    try {
        Write-Log "Import en cours : $nom"
        if ($DryRun) { & $importer -Fichier $Path -ConfigPath $ConfigPath -DryRun | Out-Host }
        else         { & $importer -Fichier $Path -ConfigPath $ConfigPath          | Out-Host }

        $cible = Join-Path $cfg.DossierTraites ("{0:yyyyMMdd_HHmmss}_{1}" -f (Get-Date), $nom)
        Move-Item -Path $Path -Destination $cible -Force
        Write-Log "OK → archivé dans Traités : $nom" 'INFO'
    }
    catch {
        Write-Log "ÉCHEC $nom : $($_.Exception.Message)" 'ERROR'
        try {
            $cible = Join-Path $cfg.DossierErreurs ("{0:yyyyMMdd_HHmmss}_{1}" -f (Get-Date), $nom)
            Move-Item -Path $Path -Destination $cible -Force
        } catch { }
    }
}

Write-Log ("Surveillance démarrée : {0}\{1}  (intervalle {2}s{3})" -f $cfg.DossierSurveille, $cfg.MotifFichier, $IntervalleSecondes, $(if ($DryRun) { ', DryRun' } else { '' }))
Write-Log "Ctrl+C pour arrêter."

while ($true) {
    try {
        Get-ChildItem -Path $cfg.DossierSurveille -Filter $cfg.MotifFichier -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime |
            ForEach-Object { Process-File -Path $_.FullName }
    }
    catch { Write-Log "Erreur de scrutation : $($_.Exception.Message)" 'ERROR' }
    Start-Sleep -Seconds $IntervalleSecondes
}
