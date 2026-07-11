# Import automatique dans SAGE 100 — « surveillant » des exports

Cet outil supprime le clic manuel **Fichier → Importer → Format paramétrable**
de SAGE. Il tourne en tâche de fond sur le poste Windows et, **dès que
l'application « Écritures SAGE » dépose un fichier `SAGE_ECRITURES_*.txt`**, il
l'importe automatiquement dans SAGE 100 via les **Objets métiers** (SDK).

```
[App web] --clic "Exporter SAGE"--> fichier .txt dans le dossier surveillé
                                          │
                              [Surveillant] détecte le fichier
                                          │
                        importe dans SAGE via Objets métiers
                                          │
                          déplace le fichier dans "Traités"
```

## Ce qui est fourni

| Fichier | Rôle |
| --- | --- |
| `Surveiller-Export-SAGE.ps1` | Surveille le dossier et enchaîne les imports (à lancer au démarrage) |
| `Importer-Ecritures-SAGE.ps1` | Lit un fichier, contrôle l'équilibre, injecte dans SAGE |
| `config.exemple.json` | Modèle de configuration (à copier en `config.json`) |

La **lecture, le contrôle d'équilibre, la surveillance et l'archivage sont
complets et testables tout de suite** (mode `-DryRun`). Seul le **bloc
d'injection Objets métiers** est à finaliser avec l'exemple du Kit OM de votre
version exacte (voir §5) — c'est une quinzaine de lignes.

## 1. Prérequis — installer les Objets métiers On Premise

Installez le **Redistribuable OM** correspondant à **votre version de SAGE 100**
(menu **? → À propos** dans la Comptabilité). Correspondances principales :

| SAGE 100 | Objets métiers |
| --- | --- |
| v8.0 (i7) | **v8.05** |
| v9.0 | v9.02 |
| v10.0 | v10.05 / 10.10 |
| v11.0 | v11.0 |
| v12.0 | v12.0 |

> Récupérez aussi le **Kit OM** (« inclus les fichiers Exemple ») : ses exemples
> de création d'écriture servent à finaliser le §5. Téléchargements sur votre
> Espace Partenaires Sage / Sage Partner Hub (aucune clé d'authenticité requise).

## 2. Configuration

1. Copiez `config.exemple.json` en **`config.json`** (dans ce dossier).
2. Renseignez :
   - `DossierSurveille` : là où arrivent les exports (souvent `...\Downloads`).
   - `FichierSociete` : chemin complet du fichier société **`.mae`**.
   - `Utilisateur` / `MotDePasse` : identifiants SAGE (le mot de passe peut être vide).
   - `DossierTraites`, `DossierErreurs`, `FichierLog` : créés automatiquement.

## 3. Tester SANS toucher à SAGE (recommandé d'abord)

Ouvrez le **PowerShell 32 bits** :
`C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe`

```powershell
cd "C:\chemin\vers\import-auto-sage"
# Test sur un fichier déjà exporté :
.\Importer-Ecritures-SAGE.ps1 -Fichier "C:\Users\VOUS\Downloads\SAGE_ECRITURES_20260711.txt" -DryRun
```
Vous devez voir le nombre d'écritures, le découpage en **pièces équilibrées** et
« DryRun : aucune écriture envoyée ». Le format est validé.

Testez ensuite la **surveillance** (toujours sans SAGE) :
```powershell
.\Surveiller-Export-SAGE.ps1 -DryRun
```
Cliquez « Exporter SAGE » dans l'app : le fichier est détecté, analysé, puis
déplacé dans **Traités**. Le pipeline complet est prouvé.

## 4. Lancer au démarrage de Windows (import réel)

Une fois le §5 finalisé, planifiez le surveillant au démarrage :

1. **Planificateur de tâches** → Créer une tâche.
2. Déclencheur : **À l'ouverture de session**.
3. Action : Démarrer un programme
   - Programme : `C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe`
   - Arguments : `-ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\chemin\vers\import-auto-sage\Surveiller-Export-SAGE.ps1"`
4. Cochez « Exécuter avec les autorisations maximales ».

Désormais : **clic « Exporter SAGE » → écritures dans SAGE en ~1 seconde**, sans
aucun clic d'import.

## 5. Finaliser le bloc Objets métiers (~15 lignes)

Dans `Importer-Ecritures-SAGE.ps1`, fonction `Invoke-SageImport`, remplacez le
bloc marqué **« À COMPLÉTER »** par la création d'écriture de l'**exemple du Kit
OM** de votre version. Toutes les valeurs sont déjà prêtes pour chaque ligne :

| Variable | Contenu |
| --- | --- |
| `$lig.Journal` | code journal (VT, AC, OD…) |
| `$lig.Date` | date de pièce (`[datetime]`) |
| `$lig.Compte` | n° compte général |
| `$lig.Libelle` | libellé (≤ 35 car.) |
| `$sens` | `0` = débit, `1` = crédit |
| `$montant` | montant (> 0) |

Le schéma-type (noms de propriétés à confirmer sur votre version) est commenté
dans le script. Envoyez-moi l'exemple de création d'écriture de votre Kit OM et
je vous livre le bloc exact.

## Notes

- **32 bits obligatoire** : les Objets métiers Sage 100 sont 32 bits ; le script
  refuse de s'exécuter en 64 bits et vous rappelle le bon PowerShell.
- **Fichier encodé Windows-1252** : lu tel quel, comme l'attend SAGE.
- **Sécurité** : un fichier déséquilibré (débit ≠ crédit) est refusé et rangé
  dans `Erreurs` — jamais importé à moitié.
- **PC séparés** : si l'app et SAGE ne sont pas sur le même poste, faites pointer
  `DossierSurveille` vers un dossier réseau partagé (ou synchronisé) où arrivent
  les exports.
