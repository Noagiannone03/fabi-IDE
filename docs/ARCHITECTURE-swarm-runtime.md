# Architecture — Runtime du swarm Fabi dans l'IDE

> Comment le moteur d'inférence P2P (Parallax / `swarm-engine`) est **embarqué et
> géré par l'app**, sans installation "à côté", et avec **une seule source de
> vérité** : on modifie `swarm-engine`, et tout se met à jour via **un seul numéro
> de version**.

## Le problème
- `swarm-engine` (fork de Parallax) est en **Python** + dépendances lourdes
  (PyTorch, et selon la plateforme MLX / vLLM-SGLang). On ne peut pas le réécrire
  en TS dans l'IDE.
- On veut : (1) **rien à installer à la main**, (2) **prod-ready**, (3) ne pas
  dupliquer le code de `swarm-engine` dans l'IDE (sinon chaque amélioration =
  modifier dix endroits).

## Principe : artefact de runtime **versionné**, source unique = `swarm-engine`

```
  swarm-engine  (LA source de vérité — un seul repo)
       │   CI (release-build) construit un runtime RELOCATABLE par plateforme :
       │     fabi-runtime-darwin-arm64-mlx.tar.zst     (Mac Apple Silicon)
       │     fabi-runtime-linux-x64-cuda.tar.zst       (Linux NVIDIA)
       │     fabi-runtime-win-x64-cuda.tar.zst         (Windows NVIDIA, vLLM natif — pas de WSL)
       │   → publiés sur GitHub Releases, taggés  runtime-vX.Y.Z
       ▼
  Fabi IDE  (extension fabi-swarm)
       │   épingle UNE constante :  FABI_RUNTIME_VERSION = "X.Y.Z"
       │   RuntimeManager (backend Node) :
       │     1. détecte os/arch/accel
       │     2. cherche le runtime : (a) bundlé dans l'app, (b) caché en data-dir, (c) sinon télécharge l'artefact épinglé
       │     3. localise le binaire `parallax` dans le runtime
       │   Worker : spawn `parallax join -s <peer>` depuis ce runtime
```

### Pourquoi c'est DRY (modifier un seul endroit)
- Le code moteur vit **uniquement** dans `swarm-engine`. L'IDE n'en copie **rien**.
- Améliorer le moteur = commit sur `swarm-engine` → la CI publie `runtime-vX.Y.Z+1`
  → on **bump une seule constante** (`FABI_RUNTIME_VERSION`) dans l'IDE → tous les
  utilisateurs récupèrent la mise à jour au prochain lancement.
- Aucune logique moteur dupliquée côté IDE : l'IDE ne fait que **résoudre, fetcher,
  lancer**.

## Par plateforme — **aucun backend moteur custom** (c'est la décision clé)

| OS | Device détecté | Backend `swarm-engine` | `--gpu-backend` | Bundlé / fetché | WSL ? |
|---|---|---|---|---|---|
| **macOS (Apple Silicon)** | `mlx` | **MLX** | — (auto) | léger → bundlé | non |
| **Linux (NVIDIA)** | `cuda` | **SGLang** (défaut) | `sglang` | >2 Go → fetché | non |
| **Windows (NVIDIA)** | `cuda` | **vLLM** | `vllm` | fetché au 1er usage | **non** |

> **Les trois plateformes utilisent du code moteur 100 % existant de `swarm-engine`.**
> On n'ajoute **aucun** backend Python. `factory.py` route déjà `device=="cuda"` +
> `--gpu-backend vllm` → `VLLMExecutor` (674 lignes, complet, hérite du `run_loop`
> de `BaseExecutor`). Le seul "support Windows" est : (1) un **artefact de runtime**
> qui `pip install` le wheel **vLLM-Windows**, et (2) le worker qui passe
> `--gpu-backend vllm` sur Windows (`FabiRuntimeManager.joinArgs()`).

## Pourquoi vLLM natif sur Windows (et pas un backend PyTorch custom)
Décision révisée après recherche (juin 2026). Le plan initial était d'écrire un
backend PyTorch "portable" pour Windows. **Abandonné** car :
- **vLLM tourne maintenant nativement sur Windows** via les wheels communautaires
  [`SystemPanic/vllm-windows`](https://github.com/SystemPanic/vllm-windows)
  (v0.22.x, juin 2026 : Python 3.12, CUDA 13, Blackwell, **pipeline parallelism +
  NCCL sur Windows**, API drop-in). Plus de WSL, plus de reboot.
- Écrire notre propre runner torch = **réinventer la roue** : on reperdrait
  PagedAttention / continuous batching (donc lent), et on maintiendrait un backend
  de plus, non testé, alors que `VLLMExecutor` existe et est éprouvé.
- **Cohérence** : `cuda → vLLM` sur Linux comme sur Windows ; un chemin CPU n'existe
  sur aucune plateforme (contribuer demande Apple Silicon ou NVIDIA), donc on n'en
  invente pas un pour Windows seul.

> On **épingle** la version exacte du wheel vLLM-Windows dans l'artefact de runtime
> (c'est un fork communautaire — le pin garantit la reproductibilité). Consommer
> l'IA (chat) ne dépend de rien de tout ça : c'est de l'HTTP, natif partout.

## Cycle de vie (inchangé vs le CLI)
`Se connecter` → RuntimeManager garantit le runtime → spawn `parallax join` (on
contribue) → `Se déconnecter` / fermeture → kill du process group (on quitte).
Consommer l'IA (chat) ne dépend de **rien** de tout ça : c'est de l'HTTP vers le
scheduler, natif sur tous les OS.

## Sécurité / intégrité
- Artefacts vérifiés par **SHA256** (déjà produit par `release-build.sh`).
- Runtime caché par version dans le data-dir de l'app → plusieurs versions
  coexistent, rollback trivial.
