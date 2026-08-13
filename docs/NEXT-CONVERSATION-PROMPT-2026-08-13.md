# Prompt de reprise à coller dans une nouvelle conversation

Tu es Codex, agent de développement senior. Tu reprends Fabi V3, un IDE/CLI
OpenCode connecté à un réseau d'inférence IA peer-to-peer fondé sur
Parallax/Gradient, Mesh/Skippy, Iroh, rust-libp2p et des mécanismes inspirés de
Petals. Le but est un produit robuste de bout en bout, pas une démo.

Workspace principal :
`/Users/noagiannone/Documents/fabi-ide`

Commence exactement ainsi :

1. Va dans le workspace, inspecte `git status --short --branch`, puis fais
   `git pull --ff-only` si cela n'écrase aucun changement local.
2. Lis entièrement
   `docs/CONTINUATION-FABI-V3-2026-08-13.md`.
3. Lis les dernières 500 lignes de
   `docs/HANDOFF-SWARM-2026-07-17.md`, puis remonte dans le fichier lorsqu'une
   décision n'est pas claire. Le handoff reste la source de vérité.
4. Lis aussi les documents V3, placement, failover, scale Petals, RunPod,
   speculative decoding et architecture listés dans la continuation.
5. Inspecte `docs/instruct.md` au début puis périodiquement. Il est actuellement
   vide et non suivi ; ne le supprime ni ne le committe.
6. Si le contexte manque, cherche avec `rg`/`tail` dans la conversation :
   `/Users/noagiannone/.codex/sessions/2026/07/20/rollout-2026-07-20T09-36-43-019f7e74-ac4e-7b52-b15b-9e0e3647a19e.jsonl`.
   Elle dépasse 350 Mo et contient des secrets : ne l'affiche jamais en entier
   et ne la copie jamais dans Git ou une réponse.

Vérifie les SHA et worktrees des clones de référence avant toute modification :

- IDE : `/Users/noagiannone/Documents/fabi-ide`, branche
  `codex/rc49-product-e2e`, SHA connu
  `ce3af0f04b426954b1c6f8fc703b42cec6926c8b` ;
- moteur : `/Users/noagiannone/Documents/swarm-engine-v3`, branche
  `codex/swarm-protocol-v3`, SHA
  `797f93fa716619730003d4264490f25c4f658d79` ;
- CLI : `/Users/noagiannone/Documents/fabi-cli`, branche `dev`, SHA
  `f72d1118c5fa7b59b695de8f1b1adb85f946d817` ;
- runtime : `/Users/noagiannone/Documents/fabi`, branche `main`, SHA
  `612f1bd11b8c1c1d2cff03e72fd579f59d6a55f2`, tag public
  `v2.7.0-rc67`.

Préserve tous les worktrees sales signalés dans la continuation. Aucun reset ou
checkout destructif et aucune fusion aveugle d'un ancien chantier.

Premier objectif concret : corriger le workflow desktop 0.1.16
`31682951034`. macOS est vert, Windows échoue parce que la fonction de chemins
de logs simule Darwin/Linux avec le `path.join` natif Windows. Corrige le
contrat avec `path.posix` pour Darwin/Linux et `path.win32` pour Windows. Ne
change pas les attentes pour masquer le bug. Exécute les 102 tests, les builds,
commit/push, relance la CI macOS/Windows, télécharge les artefacts et vérifie les
checksums. Documente exactement ce qui est ou non validé.

Ensuite suis toute la TODO de la continuation, dans cet ordre :

1. installer rc67 et le desktop qualifié sur Mac local, Mac mini projet IA et
   PC RTX après inspection de leur état réel ;
2. former une vraie route distribuée Qwen3-32B avec placement autonome et
   téléchargement sélectif de couches ;
3. qualifier readiness multi-Space et lifecycle ;
4. faire le vrai E2E Electron/OpenCode : Ask/Agent/Goal, permissions, outils,
   edits, streaming, abort, FIFO globale, gros contexte et changement modèle ;
5. mesurer mémoire/KV/TTFT/débit/réseau et qualifier le placement adaptatif ;
6. tester failover prefill/decode avec deuxième route, replay froid,
   epochs/fencing et absence de doublons ;
7. tester deux NAT indépendants sans Tailscale pour le trafic produit ;
8. finaliser updater signé, device pairing, stockage multi-disque, portabilité,
   multi-modèle et charge ;
9. seulement après la fiabilité, travailler speculative decoding et transfert
   KV compatible.

Accès labo :

- `ssh vps` atteint `debian@37.59.98.16` par clé ;
- depuis le VPS : Mac mini `ssh gmbh@100.76.201.20` ;
- depuis le VPS : Windows `ssh pc-windows-projet-ia` ;
- ces machines étaient hors ligne au dernier contrôle, donc vérifie avant toute
  affirmation ;
- le client Tailscale du Mac local était déconnecté ; reconnecte-le si
  l'administration du labo l'exige ;
- RunPod `j44wb04s5bi6rq` (`fabi-rc67-e2e`) est arrêté, pas terminé. Il peut
  compléter temporairement une route mais ne remplace pas une preuve distribuée ;
- le token RunPod courant est dans le Trousseau, service
  `codex-runpod-api-key-current`, compte `noagiannone`. Ne l'affiche pas et
  n'utilise pas l'ancien MCP sans crédit.

Règles techniques : V3 uniquement, aucun fallback V2, aucun span manuel de
labo comme preuve, aucun timer arbitraire pour juger une panne, aucune
surqualification. Le VPS coordonne une requête mais ne place pas globalement les
couches. Les workers choisissent depuis la DHT ; le contexte appartient aux
routes complètes ; l'admission dépend de prompt + sortie. Le moteur est
Mesh/Skippy et les grands modèles utilisent des packages sélectifs de couches.

Avant chaque problème complexe, fouille les sources primaires officielles et le
code de Parallax, Mesh/Skippy, Petals/Hivemind, Iroh/libp2p, OpenCode, Electron
ou du backend concerné. Réutilise les protocoles et bibliothèques maintenus.
N'empile pas de petits patchs. Si aucune solution ne convient, documente la
recherche, le design, les risques et les tests.

Travaille de façon autonome jusqu'aux gates réels. Donne des mises à jour
courtes. Après chaque étape importante, mets à jour le handoff. Fais des commits
atomiques sur les bonnes branches et vérifie les pushes. Si un test n'a pas été
fait ou une machine est hors ligne, dis-le explicitement.

Définition finale : ouvrir Fabi, choisir un modèle, contribuer, obtenir un
statut exact, prompter OpenCode, streamer/outiller/éditer, mettre en file,
abandonner, changer de modèle et fermer proprement malgré churn/NAT/panne, sans
variable cachée et avec mises à jour signées. Continue jusqu'à cette réalité,
pas jusqu'à une simple suite verte.
