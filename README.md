# Fourmiz — prototype jouable

Jeu de conquête d'un jardin avec des colonies de fourmiz. La carte est générée (environ 1 550 cases hexagonales, flaques et cailloux). Pars d'un nid, prends des trésors, réussis des missions et fais le meilleur score.

Deux modes :
- **En ligne** : un monde partagé et persistant qui avance en continu, 24 h/24, sur un serveur Firebase. Il n'y a pas de tours. On se connecte avec son compte Google.
- **Solo** (`index.html?solo`) : contre 5 colonies IA, tout tourne dans le navigateur, avec une vitesse réglable.

Pour la mise en ligne, suis **`MISE_EN_LIGNE.md`**. Tant que `js/firebase-config.js` n'est pas rempli, le jeu démarre en solo.

## Lancer le jeu

- **Sur ton PC** : double-clique sur `index.html` (il faut une connexion internet). Le mode en ligne exige que le site soit publié sur GitHub Pages, car la connexion Google ne marche pas depuis un fichier local.
- **En ligne** : voir `MISE_EN_LIGNE.md`.

## Comment jouer

1. **Fonder sa colonie** : choisis un nom, puis touche une case libre du jardin (pas un trésor), à au moins 4 cases d'une autre colonie.
2. **But** : faire le meilleur **score**. Les **trésors** 🍬🍎🥖🍯🪲 rapportent des points tant que tu les tiens, les **missions** aussi. Le monde ne s'arrête jamais.
3. **Ta reine** vit au nid 👑. Si un ennemi le prend, ta colonie disparaît et ton score entre aux **records**. Tu recommences avec une nouvelle colonie.
4. **Ordres** : glisse d'une de tes cases vers une autre (ou touche une case, puis une case voisine). **Armée** (par défaut) envoie soldates, éclaireuses, scarabées et ouvrières en trop. **Rassembler ici** fait converger le surplus.
5. **Castes** : les ouvrières se répartissent toutes seules ; tu commandes l'armée (soldates, éclaireuses) et le **héros scarabée** 🪲, débloqué pour toujours par la **mission rare ⭐** (tenir le scarabée géant au centre du jardin). Le nid est protégé par une **garde royale**, et chaque trésor donne un **pouvoir**.
6. **Carte** : flaques et cailloux sont infranchissables ; tout le reste est relié. Molette ou pincement pour zoomer, boutons ＋/－.
7. **Survie, évolutions, saisons** : chaque fourmi mange ; l'hiver la récolte chute. Les évolutions s'achètent avec de la nourriture.
8. **En ligne** : ta colonie s'endort sous un **bouclier 🛡️** si tu pars plus de 10 minutes. Le bouton 📨 invite des amis.

## Structure

| Fichier | Rôle |
|---|---|
| `functions/shared/config.js` | **Toutes les valeurs de jeu** (biomes, coûts, vitesses, IA, rythme en ligne). |
| `functions/shared/sim.js` | Règles du jeu, sans affichage : utilisées **à la fois** par le site et par le serveur. |
| `functions/shared/ai.js`, `garden.js` | Colonies IA ; génération de la carte jardin. |
| `functions/index.js`, `engine.js` | Serveur Firebase : tour de jeu chaque minute, validation des ordres des joueurs. |
| `database.rules.json` | Règles de sécurité : les joueurs lisent le monde et envoient des ordres, seul le serveur écrit. |
| `js/backend.js` | Solo (simulation locale) ou en ligne (Firebase), avec la même interface. |
| `js/map.js`, `ui.js`, `main.js` | Carte, interface, clics. |
| `js/firebase-config.js` | La configuration de ton projet Firebase. |
| `tests/sim.test.js` | Tests : `node --test tests/sim.test.js` |

## Crédits

Carte générée par le jeu, dessinée sur un canvas : aucune donnée externe.
