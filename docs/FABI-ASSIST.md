# Fabi Assist — Jarvis GPU

## Méthode pédagogique

`assist-pedagogy.ts` décrit comment enseigner. OpenCode reçoit ce contrat, l’exercice actif, les six derniers échanges pédagogiques du même fil et les notions arrivées à leur date de révision. Les acquis sont communs au projet ; les activités restent propres à chaque discussion.

- **PRIMM** : lire un petit exemple, prédire, comparer à une exécution réellement observée, expliquer, modifier puis réutiliser ailleurs. Les étapes se répartissent sur plusieurs échanges. [Raspberry Pi Foundation](https://www.raspberrypi.org/teach/pedagogy), [formation PRIMM](https://training-hub.raspberrypi.org/en/courses/using-primm-to-teach-programming).
- **Exemple résolu puis aide décroissante** : montrer les étapes utiles avant un exercice analogue, puis proposer du code à compléter et une adaptation autonome. Une seule nouveauté à la fois. [Guide du NSW Department of Education](https://education.nsw.gov.au/about-us/education-data-and-research/cese/publications/practical-guides-for-educators/cognitive-load-theory-in-practice.html).
- **Rappel actif et espacement** : faire retrouver une notion avant de réafficher le rappel, corriger, puis la réutiliser dans un cas différent. Les délais du carnet sont un réglage produit, pas une durée optimale démontrée pour chacun. [The Learning Scientists](https://www.learningscientists.org/retrieval-practice).
- **Métacognition située** : expliciter une hypothèse, la vérification choisie et les éléments permettant de conclure, notamment face à une erreur du terminal. [Guide EEF](https://educationendowmentfoundation.org.uk/education-evidence/guidance-reports/metacognition).

Exemple : pour `export`, expliquer son rôle avec deux fichiers ; en mode professeur, faire prédire si une valeur peut être importée, puis compléter un import dans un cas voisin. Corriger précisément une confusion entre exportation et exécution si elle apparaît. Une sélection demandant « ça sert à quoi ? » reçoit une réponse directe sans exercice imposé.

Après deux essais infructueux, apporter une correction expliquée puis simplifier le cas suivant. L’utilisateur peut demander la solution ou passer. Un quiz réussi ne prouve pas une maîtrise générale. Les révisions doivent rester pertinentes pour la demande actuelle.

Ces méthodes sont adaptées à un IDE individuel à partir de recherches et de guides souvent issus de l’enseignement en classe. Leur présence dans le contrat ne valide pas à elle seule l’efficacité pédagogique de Fabi. Les tests vérifient le contexte transmis et son isolation. Des parcours réels sur Jarvis vérifient aussi les citations, la génération des étapes et leur persistance ; ils ne mesurent pas une progression pédagogique à long terme.

## Moteur

Fabi Assist utilise **OpenCode 1.3.13**, lancé localement comme serveur authentifié sur loopback, avec Qwen sur le GPU Jarvis comme fournisseur d’inférence. OpenCode gère les sessions, les outils et la sortie structurée ; Fabi fournit la politique pédagogique et le carnet. Chaque fil Fabi correspond à une session distincte. Freebuff n’est plus utilisé.

## Utilisation

- Dans un terminal, la capsule **Fabi** ouvre un espace de compréhension dans tout l’onglet. Le terminal reste monté à ses dimensions initiales ; maintenir l’icône œil permet de le voir, **Revenir au CLI** ou Échap rend le focus. Aucun panneau partagé n’est créé. Une génération observée depuis au moins six secondes peut déplier une invitation : **On regarde** ouvre une explication, **Pas maintenant** la replie. Une seule invitation à la fois, repli après 25 secondes et pause de cinq minutes après interaction. La sélection des invitations ne fait aucun appel LLM ; l’explication démarre après acceptation. La découverte initiale du projet dispose de sa propre file de fond.
- Surligner affiche un petit renard près de la sélection. Cliquer dessus ou appuyer brièvement sur `⌥ Option` déploie un éventail de trois actions depuis le curseur : **Explique-moi**, **Voir les liens**, **Ma question**. La sélection seule ne fait aucun appel IA.
- Un appui long sur le code ou un fichier, ou `Ctrl/Cmd+Alt+I`, ouvre aussi ces actions. Une question ouvre ensuite une petite surface de lecture ancrée au même endroit. Échap ferme et rend le focus ; les animations respectent la préférence de mouvement réduit.
- **Vérifier le GPU** teste réellement `/v1/models`, avec la clé d’inférence et le nom du modèle attendu. Aucun login navigateur.
- La question et les acquis précédents sont conservés en cas d’erreur ou d’annulation. Les leçons réussies sont enregistrées par projet.

## Fournisseur et secrets

Configuration backend uniquement : `~/.config/fabi/assist/jarvis-provider.json`, mode 0600 dans un dossier privé. Champs : `apiKey`, `model`, `baseURL` ; `pausedReason` permet de suspendre les requêtes lorsque le pod n’existe plus. La configuration est relue à chaque demande.

La clé **d’administration RunPod reste sur le VPS**. Fabi ne possède que la clé d’inférence vLLM. Le renderer ne reçoit ni clé ni configuration privée. HTTPS obligatoire hors localhost ; pas de redirections avec les credentials, pas de repli automatique vers un fournisseur tiers. Les erreurs HTTP sont remplacées par des messages contrôlés, sans corps brut du serveur. Annulation et délai maximal de trois minutes.

Le backend actif contient `opencode-harness.ts` (serveur natif et plugin de taille des extraits), `assist-prompts.ts` et `assist-pedagogy.ts` (enseignement), `assist-learning.ts` (carnet validé), `assist-service.ts` (validation, isolation et sauvegarde atomique). L’ancien `assist-harness.ts` n’est plus appelé par le service.

Les lectures natives read/glob/grep/list ont été remplacées par les outils protégés **fabi_read**, **fabi_files**, **fabi_search** et **fabi_diff** : ils contrôlent le projet, les chemins privés, les liens extérieurs et les limites des extraits. **fabi_context**, websearch/webfetch et **StructuredOutput** restent autorisés. Ce dernier doit explicitement rester autorisé malgré le refus global des autres outils, sinon le moteur continue à rechercher sans pouvoir conclure. Bash et les outils d’écriture sont désactivés. Un plugin natif plafonne les résultats d’outils à 9 000 caractères sans plafonner le nombre d’appels. Le modèle décide quand conclure ; annulation et délai de réponse restent disponibles. Une sortie absente ou invalide produit un message contrôlé, jamais une erreur Zod brute. Le transport utilise prompt_async et observe la réponse native ; un StructuredOutput terminé est récupéré même si le flux du fournisseur tarde à se fermer. Les étapes en cours sont affichées et l’annulation interrompt la session native. Le runtime épinglé et sa licence sont copiés par prepare-assist-runtime.mjs puis embarqués via extraResources.

## Contexte partagé de l’IDE

`AssistIdeObserver` observe les changements de fichier actif, les modifications en éditeur, les fermetures, les créations/modifications/suppressions signalées par le filesystem et les changements d’état des agents. Il conserve au maximum 120 événements par racine via le stockage local de Theia ; les 50 derniers accompagnent une question. Les événements indiquent ce qui a été observé, sans attribuer arbitrairement un changement à un agent.

À chaque envoi : fichiers ouverts et état non enregistré, extrait de 60 lignes autour du curseur actif (10 000 caractères maximum), changements SCM, agents visibles et aperçu de leur activité. Les chemins privés usuels sont exclus. L’extrait actif est revalidé côté backend contre les sorties du projet par symlink. Le panneau **Contexte du projet** expose cet aperçu. Le modèle peut élargir sa lecture avec les outils protégés du projet ; la capture n’est pas un écran enregistré ni un historique exhaustif des actions antérieures au lancement de l’observateur.

Sélectionner du texte dans une réponse ouvre une question ciblée sur ce passage. Le titre et l’extrait sont transmis séparément du code dans `replyExcerpt`. La discussion conserve son fil et ses sources. Les définitions, schémas, quiz et exercices restent disponibles dans la lecture.

## Chargement de Git

`FabiElectronMainApplication.startBackend` localise les plugins intégrés en développement et dans Resources/app/plugins en application packagée, puis renseigne THEIA_DEFAULT_PLUGINS avant le fork du backend. Un lancement Electron direct sans `--plugins` charge ainsi aussi vscode.git. Le dépôt, les diffs et le champ de commit restent les composants SCM réels, pas des données recréées pour l’accueil.

## Déploiement retrouvé le 13 octobre 2026

Dossier du VPS : `/home/debian/projets/jarvis/ai-project/runpod/`.

- GPU : une **NVIDIA RTX PRO 6000 Blackwell Server Edition, 96 Go**, Secure Cloud.
- Modèle : `happypatrick/Qwen3.5-122B-A10B-heretic-int4-AutoRound`.
- Révision : `b7460e1ee8b55c6bcb68fd77e12a6c0a8b08880c`.
- Nom servi : `jarvis-heretic-122b` ; contexte 65 536 ; quatre séquences simultanées.
- Volume conservé : `41h3pbvu9x`, 200 Go, EUR-IS-1.
- Ancien pod `2r040hj3ri4z43` supprimé. **Ne pas réutiliser son endpoint.**
- Nouveau pod actif : `1slypnjaxjs5xa`, même volume, **2,49 USD/h** hors stockage.
- Endpoint : `https://1slypnjaxjs5xa-8000.proxy.runpod.net/v1`.

Après recharge par l’utilisateur, le pod a été recréé avec le cache persistant. Le modèle et quatre séquences concurrentes d’appels d’outils ont été vérifiés sur vLLM. Fabi utilise la clé d’inférence existante. Le fournisseur Hermes sur le Mac Jarvis pointe également sur ce pod ; gateway et Telegram étaient connectés après redémarrage, avec mémoire conservée. Sa configuration précédente est sauvegardée dans `~/.hermes/maintenance-backups/runpod-20261013/`.

L’auto-pay était toujours désactivé lors du dernier contrôle après recharge ; aucun réglage de facturation n’a été modifié. Ne pas réutiliser l’ancien endpoint, ni rejouer `switch-hermes.py` qui contient des assertions de migration initiale.

## Vérification locale

Avec Node 22 :

```sh
yarn --cwd fabi-swarm test:assist
yarn build:electron
node tools/check-assist-ui.mjs
# Test explicite consommant de l’inférence, avec projet et carnet temporaires :
node tools/check-assist-gpu.cjs
```

Les tests utilisent le vrai serveur OpenCode et un serveur HTTP local simulant vLLM en streaming : outils disponibles, six lectures avec les outils toujours disponibles puis conclusion, persistance, isolation, annulation et erreurs du GPU. Ce test ne remplace pas la validation sur Qwen réel.

Le scénario UI utilise une application Electron lancée avec le port CDP 9224 ; les réponses injectées restent en mémoire et le terminal de test est fermé après contrôle. Il vérifie notamment la réutilisation du même PTY et du même onglet.

Références : [OpenCode](https://opencode.ai/docs/server/), [RunPod billing](https://docs.runpod.io/accounts-billing/billing).

## Direction de l’interaction contextuelle

Références consultées : [Refero Styles](https://styles.refero.design/), [Apple — Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/), [Raycast Quick AI](https://manual.raycast.com/ai/quick-ai).

Éventail à trois languettes près de la sélection, curseur renforcé, fiche de lecture à la demande, surfaces graphite, logo monochrome, hiérarchie typographique et animations transform/opacity avec mouvement réduit. Aucune cascade de bulles ni lignes de liaison. Référence d’interaction : [Marking menus — Autodesk Research](https://www.research.autodesk.com/publications/the-design-and-evaluation-of-marking-menus/). L’accueil reprend les mêmes tons, avec la signature Fabi discrète en fond. Les captures de tests UI sont des fixtures explicitement séparées des essais GPU réels.

## Captures et apprentissage

Les captures distinguent fichier, sélection non enregistrée, dossier et terminal. Le terminal transmet la sélection ou les 80 dernières lignes (12 000 caractères maximum), jamais le fichier de l’éditeur précédent. Le backend résout les dossiers et filtre leurs entrées privées. Les explorations ne réutilisent que les conversations du même contexte. Les identifiants d’exercice sont attribués par l’application.

Une question contextuelle (`explore`) ne modifie pas le parcours et ne propose pas d’exercice : les prérequis pédagogiques ne peuvent pas bloquer une explication. La sélection est accompagnée de 35 lignes avant et après, plafonnées à 14 000 caractères, capturées depuis l’éditeur pour inclure le code non enregistré. Les outils peuvent élargir cette lecture à d’autres plages et fichiers.

### Interaction fixes (October 2026)

- Contextual Assist and terminal Assist now own separate frontend models (draft, thread, progress, error and active request). They share a single RPC connection, which dispatches progress by request ID, and retain the project's durable notebook. History menus filter by surface kind.
- Clicking elsewhere dismisses only the action fan. A question, error or response stays open until explicit close/Escape. Long press can reopen an in-flight contextual request. Enlarging a contextual response keeps it in the contextual surface.
- The hold affordance traces a progress ring around a larger monochrome mark, with a light-gathering animation and staggered fan release. Reduced motion disables the animation.
- The navigator's virtualized view reveals only when the focused row identity changes. The upstream ref callback otherwise re-reveals the selected row on every agent-driven render, interrupting manual scrolling.
- `tools/check-assist-ui.mjs` checks passive agent refreshes while scrolled, outside clicks during generation, reopening an active contextual request, and independent terminal/context models. These checks use renderer fixtures, not GPU inference.

### Dernières corrections de réception et d’interaction

Le toggle monte immédiatement la vue : aucune attente du chargement du carnet ou de la vérification GPU. Le clic bref ne déclenche plus l’effet d’appui long (seuil visuel 180 ms, ouverture toujours à 560 ms). `tools/check-assist-interaction.mjs` vérifie ce comportement dans Electron avec une préparation volontairement bloquée. Les connexions Puppeteer doivent toujours utiliser `defaultViewport: null`, indispensable pour préserver les dimensions des WebContentsView natives.

La réponse normalise les citations web placées par Qwen dans `sources` ; une référence locale inexistante ne supprime plus l’explication complète. Le frontend libère son état occupé après un échec sans attendre la vérification du fournisseur et possède un délai RPC de secours. Le dernier essai réel complet a produit une explication et deux sources web en 53 secondes : réception validée, latence encore à améliorer. Les tests locaux (14) ne mesurent pas cette latence GPU.

### Prompt contracts and provenance (2026-10-15)

The native OpenCode harness continues to execute tools. Fabi does not implement
an additional ReAct loop or hide read/fetch tools to force the first search.
Exploration receives direct explanation instructions and worked examples; only
learning receives the full PRIMM/retrieval/feedback policy. Brief and review have
separate output contracts. Technical facts should be checked against primary
sources, with another query or documentation page after a recoverable failure.

Sources inspected for this iteration:
- [Claude Code Learning plugin](https://github.com/anthropics/claude-code/blob/main/plugins/learning-output-style/hooks-handlers/session-start.sh), Git blob `0489074abad81a48abf1ce6b3fe96ee91137f246`: prepare meaningful participation and explain the decision, rather than repetitive exercises. Fabi adapts this method to read-only exercises; it does not copy the shell hook or modify project files to create TODOs. The repository license is all-rights-reserved/commercial terms, not MIT.
- [ChatGPT study mode](https://openai.com/index/chatgpt-study-mode/): gradual support, active participation, checks with feedback and adaptation. This describes published behavior, not access to an official complete system prompt. No unofficial leaked prompt is incorporated.
- [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): scoped instructions, concrete examples and just-in-time retrieval rather than a large universal prompt.
- [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents): actionable tool outcomes and evaluation of execution traces.

The local trace now records sanitized failure categories before output validation,
including malformed-output turns. Web citations must appear in successful native
search results or be the URL of a successfully fetched nonempty page. An empty
search does not count as verification. This establishes source access, not semantic
proof of every sentence; relevance remains a model task.

Observed before this change: among the latest 3,000 local events, 99 searches and
43 fetches completed; two searches timed out and eight fetches failed (timeouts,
403/404 or connection failure). Therefore web access was intermittent, not wholly
absent. Do not describe the upstream services as unconditionally reliable.

### Full Learning plugin integration (supersedes the adaptation-only note above)

At the user's explicit request, the complete `learning-output-style` plugin is
now retained in `fabi-swarm/src/node/assist/vendor/learning-output-style/`.
`SOURCE.json` records the upstream Git blob IDs and checksums; the original manifest,
README, hook declaration, script and upstream license are preserved. This is
third-party material under Anthropic's stated terms, not relicensed as Fabi code.
No publication or redistribution was performed by this integration.

`context.json` is extracted from the script's literal JSON heredoc. No downloaded
shell script runs in the IDE. `assist-learning-plugin.ts` injects the full original
`additionalContext` for `learn` requests; the appui-long, brief and review modes
remain separate. Fabi-specific instructions map file-writing activities into
read-only `starterCode` exercises, translate the interaction to French, use the
existing response components and prevent a new exercise during answer assessment.
The plugin supplies teaching instructions; OpenCode still executes tool calls and
Fabi's notebook still records demonstrated learning. The upstream plugin itself
contains neither a web engine nor a learning database.

The integration test checks every upstream file checksum, exact prompt extraction,
full inclusion in learning and absence from the other modes.

### Optional explicit dispatch to an existing terminal session

The session view now opens from the Fabi capsule (see Utilisation). Its
welcome uses the existing monochrome Fabi mark and one composer. Understanding is the default responsibility; dispatch remains an explicit, reviewed action. Development
requests can be drafted by selecting the CLI destination inside the composer or proposed by the model
in `developerPrompt`. A separate editable preview includes the teaching preamble;
rephrasing is optional and confirming is the only dispatch entry point. The exact
reviewed text is sent, with no invisible additions after editing.

Existing interactive CLI processes use Theia's native PTY `sendText`, bracketed
paste and one submit. No clipboard automation, shell interpolation or second
`--resume` process runs alongside the terminal. Dispatch checks the selected
widget, session, idle state and a foreground Claude/Codex/OpenCode executable in
that terminal's process ancestry. An unavailable process check blocks sending.
The input should be empty; Fabi does not erase a user's partially typed input.
Windows process validation is not implemented and fails closed. Node-wrapped
executables without a recognizable process name also fail closed.

Claude and Codex JSONL histories are read by exact session ID, checked against the
workspace path, bounded to the latest twelve visible user/assistant messages and
excluded from other projects. An unbound or unavailable history is not described
as an empty/new conversation. OpenCode and other unbound terminal sessions currently
use the terminal snapshot; direct OpenCode history discovery is not implemented.
The source roots are the standard ~/.claude/projects and ~/.codex/sessions on the
workspace backend, so the remote backend reads remote histories.

`fabi_context` is a native OpenCode plugin tool, with no path argument. Its result
is the private, timestamped snapshot associated with that OpenCode session and
current Fabi request. It is a request-time snapshot, not a live screen stream.
Native `read/glob/grep/websearch/webfetch` remain available; the model selects tools.
The CLI's observed hooks drive work/permission/completion states. After an Assist
submission finishes, review is requested immediately or queued behind an ongoing
lesson. A status transition does not prove tests passed or work was correct.

Primary protocol references reviewed:
- https://developers.openai.com/codex/app-server/ (structured Codex integrations)
- https://code.claude.com/docs/en/headless (programmatic Claude sessions)
- https://opencode.ai/docs/server/ (OpenCode session API)
- https://opencode.ai/docs/custom-tools/ (native tool extension)
These APIs are alternatives for managed sessions, not a universal attachment API
for an already running interactive CLI. Fabi keeps that existing process intact.

Validation: CLI history/dispatch unit tests, native OpenCode fixture calling
`fabi_context`, and `tools/check-assist-control.mjs` with a real terminal widget
and mocked writes (no prompt sent to an actual coding session). Live Qwen called
`fabi_context`, grep, glob and read and correctly identified the synthetic session's
filtering task. This validates tool plumbing, not every factual sentence or visual
preference. UI screenshots are written to /tmp/fabi-assist-control-*.png.


The session composer now uses `assist` mode instead of implicitly invoking a
lesson for every sentence. Its structured `intent` distinguishes answer, relay,
develop and clarify. Relay/develop require a developerPrompt and open confirmation;
answer/clarify cannot retain a dispatch proposal. Exercises are excluded from this
mode's schema. The full Learning plugin is reserved for explicit lessons. Only
implementation proposals receive the visible plan/verification preamble; greetings
and questions relayed to a CLI are preserved as short messages. Coordination does
not display a spurious “not verified on the web” warning.

Live regression: “demande lui comment ça va” returned intent=relay and exactly
“Comment ça va ?” (~6s); a negative-number guard request returned intent=develop
and a concrete proposal after reading the function (~5s). These checks run without
sending the resulting proposals to a live coding agent.

Visual reference consulted for restrained segmented controls and inset surfaces:
https://styles.refero.design/style/3f296d6e-6a1c-45db-829b-afb078d49ab4
This is an adapted component pattern, not an imported Refero UI library.

### Conversation et activité (15 octobre 2026)

Le message utilisateur apparaît dès le départ de la requête et libère le champ. Un brouillon saisi pendant l’attente reste intact à la réception du résultat. En cas d’échec, la demande reste visible avec une action de nouvelle tentative. Les bilans CLI et les reformulations portent une origine persistée : leurs instructions internes ne sont pas présentées comme des messages utilisateur.

L’activité Fabi reçoit les phases réelles du moteur OpenCode (connexion, attente du modèle, outil actif, mise en forme). Un outil terminé rend la main à l’indicateur de préparation ; aucune progression fictive ni raisonnement privé n’est affiché. L’état du CLI reste indépendant, avec attente de prise en charge, travail, autorisation, fin et erreur. Les animations respectent la réduction des mouvements.

Le bilan commence par répondre à la demande adressée au CLI. Une identification de projet n’impose plus un rapport de modifications/tests. Les bilans ne créent ni exercice ni nouvelle proposition de commande. Un simple relais ne conserve pas de citations décoratives.

Références d’interaction consultées : [Carbon AI Chat — messages système](https://chat.carbondesignsystem.com/tag/latest/docs/enums/Type_reference.MessageResponseTypes.html), [Carbon — identité des interactions IA](https://www.carbondesignsystem.com/building-blocks/foundations/carbon-for-ai), [Dribbble — interfaces de conversation](https://dribbble.com/search/ai-chat-interface). Les composants utilisent React/CSS existants, sans nouvelle dépendance de design.

Validation : 21 tests de service/harness ; `tools/check-assist-control.mjs` vérifie l’envoi optimiste, la conservation du brouillon, les erreurs, les activités et les origines dans Electron (transport CLI simulé). `FABI_ASSIST_CASES=review node tools/check-assist-gpu.cjs` exerce un vrai bilan GPU sur un projet temporaire.

### Espace centré sur les sessions

Le panneau utilise une navigation hiérarchique avec ouverture du détail (« drill-in »). Chaque dossier contient directement ses sessions IA ; aucune liste de projets ne surmonte une seconde liste déconnectée, et il n’y a plus de grand en-tête ni de bascule globale Sessions/Code. Le nom du dossier et son chemin parent restent liés aux sessions. Chaque dossier peut se replier ; son activité reste signalée. Les sujets de conversation sont au premier plan, le fournisseur et l’état sur la ligne secondaire.

Le bouton de code de chaque dossier ouvre ses fichiers sur toute la hauteur du panneau, avec un retour aux sessions. La liste des sessions reste montée pour conserver son défilement. Le retour restitue le focus à l’action du dossier concerné. Le projet des fichiers et les dossiers repliés sont mémorisés. Les fichiers conservent leurs identifiants, menus et opérations Theia ; les lignes et la navigation clavier sont limitées au projet choisi.

Références examinées : [Core 2.0 — navigation hiérarchique de Tran Mau Tri Tam / UI8](https://dribbble.com/shots/25790810-Sidebar-Navigation-for-Core-2-0-Dashboard-Builder) (liaison visuelle entre parent et enfants), [Dribbble — navigation latérale](https://dribbble.com/search/sidebar-navigation) (comparaison des navigations simples et doubles), [Refero](https://refero.design/) (catalogue de patterns). Aucun asset ou composant payant n’est copié. Les colonnes multiples ont été écartées pour garder les noms lisibles dans un panneau étroit.

Chaque clic sur le Terminal du dock crée un nouveau terminal dans la zone des onglets. Les ouvertures sont séquencées pour conserver aussi les clics rapprochés, sans réutiliser un terminal existant.

Référence accessible consultée : [Linear for Agents](https://linear.app/agents), notamment l’identité distincte des agents et le contexte associé aux demandes. Dribbble n’a pas fourni de page exploitable pendant cette session ; Refero était accessible uniquement via son shell HTML. Aucun composant de ces produits n’est copié ou ajouté comme dépendance.

Validation : `project-tree-state.test.js` vérifie la migration des anciens espaces ; `check-session-workspace.mjs` contrôle dans Electron l’ouverture des sessions, les dossiers affichés, les fichiers natifs et leurs menus, le défilement lors des mises à jour, et trois clics rapides créant trois vrais PTY dans les onglets. Les états IA de démonstration sont injectés seulement pour la capture visuelle, puis retirés.

Le focus Fabi utilise une variation de surface au clavier au lieu d’un contour. Les tokens de focus Theia/Monaco et les styles de la barre native suivent cette règle ; les couleurs de validation et de diagnostic restent distinctes.

### Couleurs des terminaux — cause et correction

Le backend lancé directement depuis un environnement d’automatisation héritait de `NO_COLOR=1` et `TERM=dumb`. La palette xterm était correcte, mais les CLI émettaient du texte sans attributs de couleur. Le nettoyage de `tools/start-electron.mjs` ne couvrait pas ce lancement direct.

`FabiTerminalEnvironmentContribution.initialize` applique désormais les capacités de l’IDE avant les créations de PTY : `TERM=xterm-256color`, `COLORTERM=truecolor`, sans la politique NO_COLOR/FORCE_COLOR héritée du lanceur. Les environnements explicites des terminaux et les fichiers de configuration du shell restent appliqués ensuite par Theia. Les processus déjà démarrés doivent être relancés pour recevoir ce nouvel environnement ; une palette ne peut pas recolorer rétroactivement du texte émis sans couleur.

Référence : [convention NO_COLOR](https://no-color.org/). Vérification : `tools/check-terminal-capabilities.mjs` lance un vrai shell, mesure `isTTY` et `getColorDepth()`, puis contrôle les attributs de cellules xterm issus de `util.inspect` avec détection automatique. Un deuxième PTY vérifie qu’un `NO_COLOR=1` explicitement demandé reste respecté.

Les raccords du navigateur de sessions utilisent un chemin SVG unique construit avec [d3-path](https://d3js.org/d3-path). ResizeObserver mesure les lignes réelles ; les arcs tangents rejoignent une seule tige, qui se termine au dernier élément. Aucune bordure CSS ne double le trait. Le bouton de code reçoit une surface discrète et un contraste permanent.

### Sessions, lecture et génération de commits

- Le bouton de fermeture d’un onglet CLI détache le widget sans disposer son PTY. La session reste dans la liste et se rouvre avec le même processus. Le menu contextuel natif offre « Renommer… » (nom stocké dans le binding) et « Fermer la session » (dispose le PTY et retire le binding). Un ancien snapshot de hooks ne doit pas recréer une session fermée.
- Le menu d’appui prolongé utilise une silhouette SVG unique : aucun contour ne se superpose à la jonction. Les réponses des deux modes partagent le rendu Markdown Theia, des blocs de code colorisés par Monaco avec copie du texte original et des diagrammes Mermaid en mode strict. Un schéma invalide conserve sa source lisible ; aucun code suggéré n’est exécuté.
- Le prompt demande des exemples courts, commandes clôturées avec langage, résultats attendus distincts et schémas seulement quand ils expliquent une relation. Conventions de lecture consultées : [Streamdown](https://streamdown.ai/docs/interactivity), [Mermaid](https://mermaid.js.org/config/usage).
- Les messages de commit utilisent les changements indexés en priorité, sinon les changements suivis non indexés. Les fichiers non suivis doivent être ajoutés à l’index. Historique récent + statistiques + extraits répartis entre au plus 20 fichiers ; pas de lecture intégrale du dépôt, ni de contenu de lockfile. Méthode de référence : [Cursor — AI commit message](https://docs.cursor.com/features/generate-commit-message).
- Diagnostic local : Claude renvoyait « OAuth session expired and could not be refreshed », puis le fallback Codex attendait silencieusement. Le budget total est maintenant de 45 secondes, l’annulation arrête le groupe de processus, et les erreurs d’authentification sont rendues lisibles. Les logs `[fabi-commit]` indiquent uniquement fournisseur, taille du contexte et durée. Une réponse tardive ne remplace pas un message modifié par l’utilisateur. Vérification réelle sur ce dépôt : réponse Codex obtenue en 33 secondes, aucun commit exécuté.
- Contrôles : `node --test fabi-swarm/test/agent-cli.test.js` et `node tools/check-assist-session-polish.mjs` (CDP 9226, fixtures temporaires, aucun appel de modèle pour le test UI).


## Compagnon contextuel — état de l’implémentation, octobre 2026

### Choix d’expérience

La division terminal / professeur a été écartée : elle réduisait la place du CLI et ajoutait un panneau permanent. La capsule réutilise le renard et les couleurs du produit, puis propose une transition volontaire vers la lecture. Le terminal réel reste monté, son processus actif et sa grille inchangée. Pendant la lecture, il est rendu inerte pour éviter une frappe accidentelle ; le maintien de l’œil le révèle, le retour rend le focus. Les mouvements respectent `prefers-reduced-motion`.

L’invitation repose sur l’état de travail observé par Maestro. Un chemin issu d’un événement récent fournit le sujet, sinon un changement indexé, un parcours ou un point d’entrée encore inexpliqué peut servir de point de départ ; sans candidat pertinent, aucune invitation automatique n’apparaît. Le délai est un seuil UX, pas une simulation de progression. Le système ne connaît pas les raisonnements privés de l’agent. La sélection reste déterministe, avec déduplication, refus persistants, notions à renforcer, parcours actifs et temporisation. La planification d’un parcours intervient avec le professeur après une demande explicite.

Inspirations étudiées : [Raycast Quick AI](https://manual.raycast.com/ai/quick-ai), pour le passage volontaire d’une présence légère à une conversation complète ; [Ticker](https://dribbble.com/shots/27545186-ticker-an-ambient-ai-companion-in-the-dynamic-island), pour la présence discrète qui se développe à la demande. Ces principes sont adaptés aux composants existants, sans reprendre une maquette.

### Mémoire et provenance

`assist-project-index.ts` ajoute `project-index.json` dans le stockage privé par projet déjà utilisé pour le carnet. Aucun nouveau dossier obligatoire dans le repository. L’inventaire suit les fichiers Git suivis et non ignorés, avec parcours de secours hors Git, exclusions des dépendances, artefacts et chemins sensibles. Les limites de volume et lectures impossibles sont visibles dans la couverture. Les corps de fichiers ne sont pas conservés dans cet index.

Les métadonnées comprennent empreintes, dates, imports et déclarations TypeScript/JavaScript, dépendances déclarées et historique borné des changements. Les ouvertures suivantes réutilisent les entrées inchangées. Les événements disque déclenchent une actualisation différée ; les requêtes récupèrent au plus huit entrées pertinentes et revalident leur empreinte. Les déclarations syntaxiques ne constituent pas un graphe d’appels résolu ni la preuve d’un flux métier. Les changements de branche sont pris en compte par le contenu courant ; les worktrees à chemins distincts ont des mémoires distinctes.

Les écritures sont atomiques et protégées par des verrous interprocessus renouvelables. Les synthèses de modules puis la vue globale sont mises en cache par empreinte des fichiers et de leurs relations directes. Les branches sont suivies par leur contenu courant ; les worktrees restent isolés par leur chemin canonique. Aucun graphe sémantique multilangage ni base de versions parallèle à Git n’est introduit. L’index entier peut être lu localement ; il n’est pas transmis intégralement au modèle. Le texte courant du dépôt demeure prioritaire sur les notes.

### Observation et pédagogie

Les hooks Maestro existants sont réutilisés : session, fournisseur, outil, phase et chemin relatif, sans mémoriser les arguments bruts. L’association exacte à la session précède celle au terminal ; une correspondance par dossier reste approximative et n’expose pas ses observations comme certaines. Les changements disque ne sont pas attribués automatiquement à l’agent. L’[App Server Codex](https://developers.openai.com/codex/app-server/) a été étudié : il convient à une session gérée par Fabi. Pour conserver les CLI interactifs existants, cette intégration observe leurs rollouts structurés et les [hooks Claude](https://code.claude.com/docs/en/hooks), sans lancer un second agent ou reprendre une session à son insu.

Le contrat pédagogique utilise l’index borné et les événements de session. Les explications et exercices existants sont conservés. Les diagrammes peuvent se découvrir étape par étape. Un événement affectant une source depuis une explication propose son actualisation. Les empreintes des citations et des sélections sont également revalidées à la réouverture du carnet, y compris après une modification hors session. Le carnet distingue découverte, explication, compréhension partielle, application et besoin de renforcement. Réussir un exemple ne marque plus une maîtrise générale ; **À revoir** enregistre explicitement une demande de renforcement.

### Terminal et validation

Le redimensionnement utilise la géométrie proposée par FitAddon, sans soustraire arbitrairement une ligne, puis transmet exactement cette grille au PTY. Un ResizeObserver, le retour à la visibilité et la fin du chargement des polices déclenchent une nouvelle mesure. L’override CSS global de police xterm a été retiré pour laisser les options du terminal gouverner sa mesure. Aucune transformation CSS ne corrige artificiellement son rendu.

Validation : build Electron ; tests Node de mémoire incrémentale, récupération, suppression de fichiers, exclusions et séparation des hooks ; scripts `check-companion-terminal.mjs` et `check-companion-presence.mjs` sur Electron via CDP. Le second injecte un événement contrôlé pour vérifier invitation et refus sans consommer une génération. Les démarrages réels de Codex et Claude et les dimensions PTY sont vérifiés par le premier. Les buffers alternatifs, les séquences ANSI, les caractères Unicode, les changements d’onglet et le retour vers le terminal sont également exercés. Le parcours GPU réel est vérifié séparément. Ces contrôles ciblés ne constituent pas une validation universelle de toutes les TUI, plateformes ou qualités d’explication.

## Mécanismes du compagnon — 16 octobre 2026

Le design capsule / pleine surface / aperçu du terminal est conservé. Les responsabilités ci-dessous complètent le moteur et les composants existants, sans service supplémentaire ni second professeur.

- **Relations du projet** : le compilateur TypeScript extrait paramètres, plages des symboles, appels syntaxiques, imports statiques/dynamiques et `require`. La résolution utilise les configurations TypeScript et un inventaire fermé, sans parcourir les dépendances installées. Les imports résolus constituent des relations de modules ; ils ne sont pas présentés comme un graphe d’exécution certain. Les autres langages restent consultables et explicables, sans extraction syntaxique spécialisée.
- **Découverte approfondie** : `assist-project-understanding.ts` explore les modules en arrière-plan avec le moteur existant, conserve des interprétations sourcées par empreinte et distingue fichiers inventoriés / effectivement consultés. Une seule synthèse de module est produite à la fois ; une vue globale relie ensuite les synthèses valides. Les dossiers composés uniquement de contenus non indexables ne déclenchent pas d’inférence. Les changements déclenchent l’index rapide ; la réexploration est différée après une période de calme. Une lecture interactive a priorité avant le départ du prochain module. Les synthèses inchangées sont réutilisées ; les sources obsolètes sont écartées de la récupération. Les échecs restent visibles comme couverture partielle.
- **Récupération et lecture** : recherche dans chemins, symboles et titres documentaires, relations voisines, passages courts effectivement lus et interprétations pertinentes. Les outils `fabi_files`, `fabi_search`, `fabi_read` et `fabi_diff` réutilisent les lecteurs et l’inventaire contrôlés. Les lecteurs natifs non filtrés sont désactivés pour le professeur. La recherche est paginée et indique sa couverture ; ce n’est pas une recherche vectorielle. Aucun modèle d’embeddings ni moteur supplémentaire n’est requis. Les clés reconnaissables sont masquées dans les extraits ; cette mesure ne remplace pas l’exclusion des fichiers privés.
- **Évolution observée** : différences de dépendances et d’imports conservées avec les changements ; comparaison Git à HEAD disponible en lecture seule, sans attribution automatique. L’adaptateur Codex lit les événements structurés des rollouts déjà surveillés par Maestro (outil commencé / résultat reçu), sans arguments bruts, raisonnement ou contenu de patch. Les hooks Claude sont conservés. Une association approximative par dossier ne peut plus supplanter un hook lié au terminal exact.
- **Mémoire pédagogique** : parcours persistants avec étapes, prérequis, pause et reprise ; objectifs du projet ou généraux dans la même interface. Préférences de profondeur, temps disponible et invitations modifiables. Les refus sont mémorisés. Une explication peut enregistrer une exposition sans exercice imposé ; « compris » ne suffit pas à faire progresser le niveau. Des réponses espacées ajustent les dates de révision. La navigation dans les étapes ne modifie pas la compétence. Les notions peuvent être remises à revoir ou réinitialisées.
- **Recommandations** : score déterministe croisant changements, dépendances nouvelles, événements exacts, parcours, prérequis, difficultés, temps disponible et refus antérieurs. La sélection précède tout appel LLM. En l’absence de preuve ou d’un point d’entrée pertinent, Fabi reste discret. Le délai n’est pas une simulation de compréhension.
- **Validité** : les citations gardent une empreinte ; une modification pendant la réponse ou hors session est détectée. Les sélections conservent version de document, plage exacte et état non enregistré. Une synthèse est une interprétation, jamais un fait éternel. Le panneau existant permet de consulter les notes et d’ajouter une correction utilisateur, distincte du code et de la documentation.
- **Concurrence** : verrous `proper-lockfile` distincts pour index, carnet, découverte, sessions du moteur et corrections. Bail renouvelé, écritures atomiques, refus de commit après perte de bail. Cette séparation a été validée après correction d’une collision de clés internes révélée par le test GPU. Le carnet conserve les 400 derniers échanges et 20 parcours ; les refus sont bornés à 100 entrées.

Validations reproductibles :

- `yarn --cwd fabi-swarm test` compile l’extension et exécute les tests du backend, du moteur natif, des graphes, de la mémoire, des verrous et de la séparation des sessions.
- `yarn build:electron` construit l’application.
- `node tools/check-companion-presence.mjs` vérifie une invitation issue d’un événement contrôlé, refus, acceptation, géométrie inchangée, aperçu clavier/souris et retour du focus.
- `node tools/check-companion-memory-ui.mjs` utilise les vrais RPC depuis le tiroir existant et vérifie la persistance des préférences, de la pause, de la navigation, du renforcement et de la réinitialisation. Les données de test sont temporaires.
- `node tools/check-companion-terminal.mjs` vérifie xterm/FitAddon/PTY, réduction de taille, changement d’onglet, buffer alternatif ANSI/Unicode et démarrages interactifs réels de Codex/Claude.
- `node tools/check-companion-learning.cjs` utilise le vrai GPU sur un petit projet temporaire : explication de deux fichiers liés, citations vérifiées, parcours persistant, aucune acquisition automatique, invalidation hors session et découverte approfondie avec constats structurés.
- `node tools/check-companion-goal.cjs` permet de vérifier un objectif d’apprentissage indépendant avec le vrai GPU. Après une interruption réseau, une nouvelle exécution GPU a réussi : parcours général persistant, aucune acquisition automatique ni demande de modification de code. Le contrat et sa réparation sont aussi vérifiés avec le moteur natif et un fournisseur de test.

Le test du parcours réel a aussi révélé une omission de citation : le contrat exige désormais les sources de chaque fichier expliqué, y compris les opérations déléguées. La validation ne garantit pas que chaque réponse future du modèle sera exacte. Les sorties incohérentes font au maximum deux tentatives de correction du contrat, sans relancer les recherches, puis échouent sans écraser le carnet.

Le script global `build:electron` a rencontré un timeout Open VSX pendant le téléchargement des dépendances d’extensions. La compilation des extensions et `yarn --cwd electron-app theia build --mode production` passent avec les extensions présentes ; le pipeline de téléchargement n’a pas été modifié pour masquer cette indisponibilité.

Les scripts UI attendent Electron avec `--remote-debugging-port=9226`. Les scripts GPU sont volontaires, nécessitent le fournisseur configuré et consomment une inférence réelle. Aucun secret de configuration n’est imprimé.

Codex a exécuté une lecture réelle avec événements et résultat. La génération réelle Claude reste empêchée par l’expiration de l’authentification OAuth du compte, bien que ses hooks et son démarrage interactif fonctionnent. Cette validation ne doit pas être présentée comme passée avant reconnexion.

Sources de conception supplémentaires : [verrouillage proper-lockfile](https://github.com/moxystudio/node-proper-lockfile), [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp), [Satori](https://github.com/ham-zax/satori), [App Server Codex](https://learn.chatgpt.com/docs/app-server). L’App Server convient à une exécution gérée nativement ; cette évolution conserve les CLI existants et leurs événements disponibles plutôt que de démarrer un second agent sur leur tâche.

Maintenance des validations : le test `maestro-animation-runtime` référençait une implémentation supprimée par le commit `36a869b` lors du remplacement de l’ancienne interface Maestro. Ce test orphelin et sa référence de compilation ont été retirés ; la commande de test compile désormais le module actuel au complet avant d’exécuter ses tests. Les tests de cycle de vie du backend Maestro sont conservés et renforcés.


### Runtime distribué et régression du chargement

Le sous-processus OpenCode ne doit pas importer `./assist-store` relativement au bundle Electron : ce fichier n’existe pas à côté de `main.js`. `assist-runtime-tools.ts` est une entrée autonome, construite en ESM avec Zod et les lecteurs protégés existants. Elle exclut le parseur TypeScript ; les fonctions de lecture/recherche/comparaison sont partagées via `assist-project-tools.ts`, sans seconde implémentation. Le module de 486 Ko est copié par `prepare-assist-runtime.mjs` à côté du binaire OpenCode, hors `app.asar`, avec la licence Zod incluse. Aucun chemin absolu de la machine de développement n’est embarqué dans ce module.

`assist-bundle.test.js` construit un backend isolé, sans fichiers sources voisins ni `node_modules`, démarre le vrai moteur OpenCode avec le module distribué et un fournisseur de test, puis vérifie la lecture et la citation d’un fichier. Ce test couvre spécifiquement la régression `Cannot find module './assist-store'`, absente des tests chargeant directement les modules compilés. La suite complète passe **163 tests** après ce correctif. `check-companion-runtime-ui.mjs` vérifie aussi le vrai RPC de l’application Electron relancée : le moteur démarre sans module manquant, puis la demande de test est annulée avant la réponse GPU.


### Durée de vie des analyses et précision des invitations

Les captures envoyées aux outils sont temporaires et supprimées après la demande, y compris après les corrections de format. Une découverte de module conserve sa synthèse sourcée ; sa session de travail native est ensuite arrêtée et supprimée avec l’[API de sessions OpenCode](https://opencode.ai/docs/server/#sessions). Les conversations pédagogiques conservent leur session pour les questions suivantes. Un échec de nettoyage ne fait pas échouer une explication valide. La suppression des anciennes sessions accumulées avant ce changement n’est pas déclenchée arbitrairement.

L’index conserve une empreinte des déclarations et leur portée. Les invitations peuvent identifier une fonction ou méthode changée et orienter l’explication vers ses paramètres, son résultat et ses appels. Ce sont des différences syntaxiques, pas une affirmation sur l’intention de l’agent ou un changement de comportement démontré. Les empreintes ne contiennent pas le corps du code. La migration d’index ne crée pas artificiellement une liste de fonctions modifiées.

Validation supplémentaire : **165 tests passent**, dont changement réel de branche et worktree Git, conservation des conversations pendant le nettoyage des analyses, et invitation visant uniquement la fonction modifiée. Les deux scripts GPU (projet et objectif indépendant) ont réussi après rétablissement de Jarvis. La génération Claude reste non validée : un nouvel essai réel renvoie une expiration OAuth.

### Références pédagogiques et choix d’intégration

L’[étude Anthropic sur l’apprentissage du code](https://www.anthropic.com/research/AI-assistance-coding-skills) distingue production assistée et compréhension, sur une petite population et un test à court terme. Elle motive ici les questions conceptuelles et la lecture active ; elle ne prouve pas l’efficacité de Fabi ni des agents autonomes dans toutes les situations. La [revue de Carpenter, Pan et Butler](https://www.nature.com/articles/s44159-022-00089-1), dont le résumé éditeur est accessible, soutient l’espacement et le rappel actif. Les délais retenus restent un réglage produit, pas une formule optimale issue de cette publication.

La description de [Learning App Journey sur Behance](https://www.behance.net/gallery/224737009/Learning-App-Journey) propose une progression visible, des modules verrouillés et des invitations contextuelles. Fabi retient l’étape courante et la reprise explicite ; il ne verrouille pas le développement derrière des cours. La description indexée est accessible, pas le prototype complet. Les références Raycast/Ticker citées plus haut orientent la présence légère et le développement volontaire. Le panneau permanent a été écarté après le retour utilisateur ; le remplacement automatique de l’onglet aurait volé le focus ; la capsule ouvrant volontairement toute la surface conserve l’accès au vrai terminal. Ces choix ont été vérifiés dans Electron, sans modifier le design désormais validé.


### Fin d’un tour pendant l’apprentissage

Le bilan automatique après une demande transmise au CLI a été remplacé par une action explicite dans le signal de fin de tour. **Comprendre le résultat** demande une explication ; **Revenir au résultat** rend le terminal. Aucun appel LLM ni ajout de réponse n’est déclenché simplement parce que l’agent termine. Le signal disparaît quand un nouveau tour commence. Cela préserve la leçon et le brouillon en cours, conformément à la séparation entre développement et apprentissage. `check-companion-session-end.mjs` vérifie ces transitions dans Electron avec un événement contrôlé, sans génération réelle. Après reconstruction et redémarrage, les contrôles de fin de tour, de présence et de chargement du runtime passent. Le contrôle de présence simule aussi le chargement du carnet et du compte pour rester indépendant du réseau ; le chargement réel est vérifié séparément par le contrôle RPC du runtime et les parcours GPU.

### Invitation absente pendant une vraie génération Codex — 16 octobre 2026

Diagnostic de la session observée : le rollout contient un début à 11:16:29 UTC et une fin à 11:16:57, mais la ligne Maestro reste associée approximativement au terminal, sans observations exposées. L’inventaire courant comporte 384 fichiers indexés, aucun point d’entrée reconnu par les anciens noms conventionnels et aucune modification de moins de trente minutes. Le choix de sujet pouvait donc rester vide même avec une génération détectée. Les tests UI précédents injectaient un chemin `src/session.ts` et ne couvraient pas ce projet calme sans point d’entrée conventionnel.

Correction : le helper de hooks transmet aussi les PID de ses ancêtres, bornés et sans arguments de commandes. Le bridge peut vérifier la relation au processus du terminal sans dépendre de l’héritage de `FABI_AGENT_TERMINAL`. Les événements natifs `task_started`, `task_complete` et `turn_aborted` définissent l’état du tour Codex ; une fin de hook ancienne ne remplace pas un début natif plus récent de la même session. Les associations par dossier restent explicitement approximatives.

Pour un projet sans activité de fichier exploitable, l’index expose jusqu’à douze fichiers de code ayant des symboles, classés par leurs relations d’import. Les tests et scripts sont exclus de cette sélection de découverte. Ces sujets sont proposés comme découverte du projet, jamais comme une action attribuée à l’agent. Une source déjà expliquée n’est pas reproposée. Les limites de fréquence et le respect du focus sont conservés. Le diagnostic `[fabi-assist] invitation` journalise les changements de motif d’affichage ou de suppression, sans contenu de prompt.

Validation : 169 tests passent, dont l’exécution du vrai helper sans variable de terminal, l’isolation de deux terminaux du même dossier, le début natif après un ancien hook de fin, et la sélection d’un sujet dans un projet calme sans `main`/`index`. Le bundle Electron compile. `tools/check-companion-codex-observation.cjs` permet un contrôle explicite avec une vraie génération Codex dans un projet temporaire en lecture seule et un socket de test privé ; il n’envoie rien aux sessions utilisateur. Le bundle chargé par une application déjà ouverte nécessite un redémarrage ; aucune session utilisateur n’est fermée automatiquement.

Le contrôle Codex réel a réussi : hook de début reçu, association exacte par ascendance, sélection d’un sujet à partir de fichiers réels, puis hook de fin. Il vérifie la chaîne backend de décision ; il ne simule pas un clic utilisateur et ne remplace pas les contrôles visuels. Sur le dépôt Fabi courant, sans modification récente ni point d’entrée conventionnel, la sélection retient désormais `fabi-swarm/src/browser/fabi-swarm-frontend-module.ts` grâce à ses relations, au lieu de rester vide.

### Délais cumulés sur un tour court — diagnostic en fenêtre utilisateur

Après redémarrage, l’instance utilisait bien la nouvelle sélection de fichiers. Le tour du 16 octobre à 11:42:38–11:42:46 UTC durait 8,6 secondes ; le problème restant était le cumul scan backend (4 s), attente calculée depuis la découverte (6 s), puis passage du timer d’interface (5 s). Le test natif précédent validait la chaîne backend, mais pas cette échéance dans le renderer.

`turnStartedAt` traverse maintenant l’événement natif / hook, Maestro et la ligne de session. L’invitation attend six secondes depuis ce début réel, avec un réveil programmé à l’échéance. Sans horodatage vérifiable, elle conserve le début observé localement. Un nouveau tour possède sa propre échéance ; une fin avant l’offre annule son affichage. Une invitation déjà offerte conserve sa durée de lecture de 25 secondes, même si Codex termine, sans ouvrir de cours. La fin de découverte du projet réévalue aussi les sujets disponibles.

`assist-presence-timing.test.js` exécute la méthode de production extraite par l’AST TypeScript, avec horloge et frontières DOM contrôlées : détection tardive, fin avant échéance, nouveau tour, conservation après la fin puis expiration. Contrôle supplémentaire dans un renderer Electron isolé avec la méthode et le CSS réels : après une découverte à t+4 s, l’offre est visible au contrôle t+6,3 s, reste visible après la fin et conserve le focus. La fenêtre utilisateur et ses sessions restent intactes. Ce contrôle de rendu utilise un événement contrôlé ; la génération Codex réelle et ses hooks sont vérifiés séparément.

### Long press : lire un mécanisme par étapes (16 octobre 2026)

Le texte intégral précédait le parcours interactif et certaines réponses affichaient des doubles échappements `\\n\\n`. `ReplyContent`, partagé par le long press et l’espace d’apprentissage, affiche désormais une orientation courte (`takeaway`, facultative, 360 caractères maximum), les titres du parcours existant `diagram`, puis le détail de l’étape choisie. Toutes les étapes sont directement accessibles, avec précédent/suivant, exemple et source vérifiée. La couleur accompagne des numéros et des libellés, sans être le seul repère. Les termes restent explorables dans le résumé et les étapes. Les précisions sont repliables sous « Pourquoi ça fonctionne » lorsque résumé et parcours existent ; les anciennes réponses gardent leur texte accessible.

Le contrat pédagogique demande ce format pour un déroulement, mais conserve une réponse courte pour une définition et Mermaid pour des relations non linéaires. Aucun ordre d’exécution n’est inventé à partir d’une liste de fichiers. Un nom de callback ne prouve pas l’origine du signal ou une confirmation de stockage. Aucun composant HTML produit par le modèle n’est exécuté : le rendu Markdown Theia existant reste utilisé. La réparation des paragraphes doublement échappés préserve les blocs clôturés et le code en ligne.

Références examinées : [Explorable Explanations](https://worrydream.com/ExplorableExplanations/) et [Learnable Programming](https://worrydream.com/LearnableProgramming/) pour la progression contrôlée par le lecteur et les précisions contextuelles ; [recherche Interactive Learning sur Dribbble](https://dribbble.com/search/interactive-learning) pour le panorama des interfaces. Le choix retenu réutilise le parcours et les termes de Fabi, sans tableau de bord scolaire supplémentaire.

Validation reproductible : `yarn --cwd fabi-swarm test` ; `node tools/check-assist-presentation.mjs` vérifie le composant React et la CSS réels dans Chromium isolé (adaptateur Markdown de test, aucun état de l’IDE modifié), navigation clavier, sources, remplacement de réponse, compatibilité des anciennes réponses, largeur 360 px et captures dans `/tmp/fabi-explanation-{wide,narrow}.png`. `node tools/check-assist-visual-generation.cjs` effectue une inférence réelle sur un projet synthétique temporaire, vérifie résumé, étapes et citation lue. Ce dernier nécessite le GPU configuré ; il ne valide pas automatiquement tous les types de questions ou projets.

Résultat de cette intervention : 175 tests passent, contrôle Chromium isolé réussi et compilation Electron de production réussie. L’inférence réelle a d’abord omis `diagram` lors d’une réparation de sortie ; le contrat décrit maintenant explicitement la structure et la réparation conserve les étapes au lieu de les supprimer. Le test réel suivant a produit résumé, quatre étapes et source vérifiée. Ce succès valide le transport et la présentation des données ; la formulation et la pertinence pédagogique restent dépendantes du modèle, et les réponses historiques ne sont pas régénérées automatiquement.

### Invitation et espace de lecture compact (16 octobre 2026)

L’invitation terminal conserve le déclenchement et les actions existants, avec une surface de 360 px maximum bornée par la largeur du terminal, le renard Fabi, un titre plus lisible et l’action « Explorer ensemble ». Le conteneur transparent laisse passer les interactions vers le terminal ; seuls le déclencheur et l’invitation visible captent la souris. Aucun redimensionnement du PTY ni prise de focus automatique. Vérification visuelle Chromium à 900, 320 et 260 px, maintien du focus et fermeture, plus les quatre tests du cycle de déclenchement.

Dans l’espace assistant, le sous-titre permanent et les lignes sous la saisie ont été retirés. Les notions, le contexte et la reconnexion restent accessibles dans le menu « … » de l’en-tête (repère ambre et libellé accessible lorsque l’assistant est indisponible). La saisie commence sur une ligne et grandit jusqu’à 112 px. Contrôle isolé du composant réel : en-tête ~50 px, zone basse 110 px, reconnexion, fermeture clavier du menu, saisie multiligne et absence de débordement à 360 px. Le rendu pédagogique reste partagé avec le long press via `ReplyContent`.

### Distribution sans moteur Swarm (16 octobre 2026)

`src/common/fabi-product-features.ts` fixe `SWARM_ENGINE_ENABLED = false` à la
compilation. Cette édition conserve Assist/RunPod, son runtime OpenCode dédié,
la mémoire pédagogique et les hooks des CLI externes. Le moteur Swarm historique
(Parallax, Request Agent et sidecar Fabi AI) est suspendu : aucun launcher,
téléchargement, reconnexion au registry, monitoring machine ou démarrage local.
Les appels explicites d'installation/connexion échouent immédiatement avec un
message explicite. Les données déjà présentes sur disque sont conservées.

Les façades RPC restent disponibles pour les dispositions sauvegardées ; les
agents et entrées UI Swarm ne sont plus activés. Maestro conserve son observation
des CLI externes, mais ne cherche plus le sidecar Swarm et ne le sonde plus.
Le flag nécessite une nouvelle compilation pour réactiver cette fonctionnalité ;
une préférence sauvegardée ou une variable d'environnement ne la réactive pas.
Tests de non-régression : `test/swarm-disabled.test.js`.

Cela évite le travail du moteur local ; cela ne constitue pas une mesure de gain
d'autonomie. Electron, l'éditeur, les extensions et les CLI ouverts consomment
encore de la mémoire et du CPU.

Validation de cette édition : 183 tests passent ; `node tools/check-no-swarm.mjs`
a démarré le `.app` packagé dans un profil isolé et vérifié via RPC le runtime
désactivé, l'absence de swarms et de métriques, ainsi que la disponibilité des
contributions Assist et terminaux. La signature ad hoc et l'intégrité du DMG ont
été vérifiées. Ce contrôle ne remplace pas un test de génération RunPod complet.
