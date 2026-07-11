<#
.SYNOPSIS
    Lit un fichier d'export « Écritures SAGE » (format d'import paramétrable,
    largeur fixe 88 caractères) et injecte les écritures dans SAGE 100
    Comptabilité via les Objets métiers (SDK On Premise).

.DESCRIPTION
    Deux étapes :
      1. Lecture / contrôle du fichier (toujours exécutée, testable sans SAGE) :
         - découpe chaque ligne de 88 caractères aux positions de la fiche Sage,
         - regroupe les lignes en pièces ÉQUILIBRÉES (débit = crédit),
         - refuse un fichier déséquilibré.
      2. Injection dans SAGE via Objets métiers (bloc à finaliser avec l'exemple
         du Kit OM de VOTRE version — voir le README).

    IMPORTANT : les Objets métiers Sage 100 sont 32 bits. Ce script DOIT être
    lancé avec le PowerShell 32 bits :
        C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe

.PARAMETER Fichier
    Chemin du fichier .txt exporté par l'application « Écritures SAGE ».

.PARAMETER ConfigPath
    Chemin du fichier de configuration JSON (défaut : config.json à côté du script).

.PARAMETER DryRun
    Analyse seulement : lit, contrôle et affiche les pièces SANS toucher à SAGE.
    À utiliser pour valider le pipeline avant de brancher les Objets métiers.

.EXAMPLE
    .\Importer-Ecritures-SAGE.ps1 -Fichier "C:\...\SAGE_ECRITURES_20260711.txt" -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Fichier,
    [string]$ConfigPath = "$PSScriptRoot\config.json",
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$INV = [System.Globalization.CultureInfo]::InvariantCulture

# ---------------------------------------------------------------------------
# Lecture du fichier : découpe largeur fixe aux positions exactes de la fiche.
#   Code journal   1..6   (6)     Date de pièce  7..12  (6, jjmmaa)
#   N° compte     13..25  (13)    Libellé        26..60 (35)
#   Débit         61..74  (14)    Crédit         75..88 (14)
# ---------------------------------------------------------------------------
function Read-SageEntries {
    param([string]$Path)

    # Le fichier est encodé en Windows-1252 (ANSI), comme l'attend SAGE.
    $enc = [System.Text.Encoding]::GetEncoding(1252)
    $lignes = [System.IO.File]::ReadAllLines($Path, $enc)

    $entries = @()
    $n = 0
    foreach ($ligne in $lignes) {
        $n++
        if ([string]::IsNullOrWhiteSpace($ligne)) { continue }
        if ($ligne.Length -lt 88) {
            throw "Ligne $n : longueur $($ligne.Length) < 88 caractères (fichier non conforme)."
        }

        $montant = {
            param($s)
            $s = $s.Trim()
            if ($s -eq '') { return [decimal]0 }
            return [decimal]::Parse($s.Replace(',', '.'), $INV)
        }

        $dateTxt = $ligne.Substring(6, 6)   # jjmmaa
        $entries += [pscustomobject]@{
            Ligne   = $n
            Journal = $ligne.Substring(0, 6).Trim()
            DateTxt = $dateTxt
            Date    = [datetime]::ParseExact($dateTxt, 'ddMMyy', $INV)
            Compte  = $ligne.Substring(12, 13).Trim()
            Libelle = $ligne.Substring(25, 35).TrimEnd()
            Debit   = & $montant $ligne.Substring(60, 14)
            Credit  = & $montant $ligne.Substring(74, 14)
        }
    }
    return , $entries
}

# ---------------------------------------------------------------------------
# Regroupement en pièces équilibrées : on accumule les lignes jusqu'à ce que
# le total débit égale le total crédit (une pièce = un mouvement équilibré).
# ---------------------------------------------------------------------------
function Group-Pieces {
    param([object[]]$Entries)

    $pieces = @()
    $courante = @()
    $d = [decimal]0; $c = [decimal]0
    foreach ($e in $Entries) {
        $courante += $e
        $d += $e.Debit; $c += $e.Credit
        if ($d -eq $c -and $d -gt 0) {
            $pieces += , $courante
            $courante = @(); $d = [decimal]0; $c = [decimal]0
        }
    }
    if ($courante.Count -gt 0) {
        throw "Fichier déséquilibré : $($courante.Count) ligne(s) finale(s) sans contrepartie (débit ≠ crédit)."
    }
    return , $pieces
}

# ---------------------------------------------------------------------------
# Injection dans SAGE via les Objets métiers.
#   >>> C'est LE bloc à aligner sur l'exemple du Kit OM de votre version <<<
#   Le reste du script (lecture, contrôle, surveillance, archivage) est complet.
# ---------------------------------------------------------------------------
function Invoke-SageImport {
    param([object[]]$Pieces, [object]$Config)

    # Les Objets métiers sont 32 bits : vérifier qu'on tourne bien en 32 bits.
    if ([Environment]::Is64BitProcess) {
        throw "Ce processus est 64 bits. Relancez avec le PowerShell 32 bits : C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
    }

    # 1) Ouverture de la société comptable (.mae) via les Objets métiers.
    #    Le ProgID peut varier légèrement selon la version installée.
    $cpta = New-Object -ComObject "Objets100c.cptApplication100c"
    $cpta.Name = $Config.FichierSociete
    $cpta.Loggable.UserName = $Config.Utilisateur
    $cpta.Loggable.UserPwd  = $Config.MotDePasse
    $cpta.Open()

    try {
        foreach ($piece in $Pieces) {
            foreach ($lig in $piece) {

                # Valeurs déjà prêtes à injecter (issues du fichier) :
                #   $lig.Journal  : code journal (ex. VT, AC, OD)
                #   $lig.Date     : [datetime] de la pièce
                #   $lig.Compte   : n° de compte général
                #   $lig.Libelle  : libellé (≤ 35 car.)
                #   $lig.Debit / $lig.Credit : un seul des deux est > 0
                #   $sens = 0 (débit) ou 1 (crédit) ; $montant = le montant > 0
                $estDebit = ($lig.Debit -gt 0)
                $sens     = if ($estDebit) { 0 } else { 1 }
                $montant  = if ($estDebit) { $lig.Debit } else { $lig.Credit }

                # ================= À COMPLÉTER (Kit OM de votre version) ============
                # Recopiez ici la création d'écriture de l'exemple fourni dans le
                # Kit Objets métiers (dossier « Exemples »), en branchant les
                # variables ci-dessus. Schéma type (noms de propriétés à vérifier
                # sur votre version — ils reflètent la table F_ECRITURE) :
                #
                #   $ecr = $cpta.FactoryEcriture.Create()
                #   $ecr.SetDefaultValue()
                #   $ecr.JournalCode      = $lig.Journal
                #   $ecr.Date             = $lig.Date
                #   $ecr.CompteGeneral    = $lig.Compte
                #   $ecr.Intitule         = $lig.Libelle
                #   $ecr.Sens             = $sens
                #   $ecr.Montant          = [double]$montant
                #   $ecr.Write()
                # ===================================================================

                throw "Bloc d'injection Objets métiers à compléter (voir README + Kit OM). Utilisez -DryRun en attendant."
            }
        }
    }
    finally {
        $cpta.Close() | Out-Null
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($cpta) | Out-Null
    }
}

# ------------------------------- Programme ---------------------------------
if (-not (Test-Path $ConfigPath)) { throw "Configuration introuvable : $ConfigPath (copiez config.exemple.json en config.json)." }
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json

Write-Host "Lecture : $Fichier"
$entries = Read-SageEntries -Path $Fichier
$pieces  = Group-Pieces -Entries $entries

$totalD = ($entries | Measure-Object -Property Debit  -Sum).Sum
$totalC = ($entries | Measure-Object -Property Credit -Sum).Sum
Write-Host ("  {0} écriture(s) → {1} pièce(s) équilibrée(s) — débit {2} = crédit {3}" -f $entries.Count, $pieces.Count, $totalD, $totalC)

if ($DryRun) {
    $i = 0
    foreach ($p in $pieces) {
        $i++
        $pd = ($p | Measure-Object -Property Debit -Sum).Sum
        Write-Host ("  Pièce {0} : journal {1} · {2} · {3} ligne(s) · {4}" -f $i, $p[0].Journal, $p[0].DateTxt, $p.Count, $pd)
    }
    Write-Host "DryRun : aucune écriture n'a été envoyée à SAGE." -ForegroundColor Yellow
    return
}

Invoke-SageImport -Pieces $pieces -Config $cfg
Write-Host "Import terminé : $($entries.Count) écriture(s) injectée(s) dans SAGE." -ForegroundColor Green
