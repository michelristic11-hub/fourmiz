# Fourmiz — prototype jouable

Jeu de conquête du monde avec des colonies de fourmiz. La carte du monde est découpée en environ 10 800 cases hexagonales (grille H3) sur la terre ferme. Pars d'un nid, nourris ta colonie et répands-toi sur toute la planète.

Deux modes :
- **En ligne** : un monde partagé et persistant, qui avance d'un tour par minute, 24 h/24, sur un serveur Firebase. On se connecte avec son compte Google.
- **Solo** (`index.html?solo`) : contre 5 colonies IA, tout tourne dans le navigateur, avec une vitesse réglable.

Pour la mise en ligne, suis **`MISE_EN_LIGNE.md`**. Tant que `js/firebase-config.js` n'est pas rempli, le jeu démarre en solo.

## Lancer le jeu

- **Sur ton PC** : double-clique sur `index.html` (il faut une connexion internet). Le mode en ligne exige que le site soit publié sur GitHub Pages, car la connexion Google ne marche pas depuis un fichier local.
- **En ligne** : voir `MISE_EN_LIGNE.md`.

## Comment jouer

1. **Fonder sa colonie** : choisis un nom, puis clique sur une case libre de la terre ferme, à au moins 4 cases d'une autre colonie. Ta reine s'y installe avec 30 fourmiz.
2. **Ordres** : clique sur une de tes cases, choisis la part de fourmiz à envoyer (25 %, 50 %, 75 % ou tout), puis clique sur une case voisine surlignée :
   - en jaune, c'est une de tes cases : **renfort** ;
   - en rouge, c'est une case sauvage ou ennemie : **attaque**. Survole une case pour voir combien de fourmiz il faut pour la prendre.
3. **Nourriture** : chaque case occupée par au moins une fourmi récolte de la nourriture selon son biome et la saison. Chaque fourmi en consomme. Si le stock tombe à zéro, c'est la **famine** et tes fourmiz meurent.
4. **Reine** : elle pond des fourmiz au nid en consommant de la nourriture (ponte arrêtée, normale ou intensive). Si un ennemi prend ton nid, la reine meurt. Tu pourras en élever une nouvelle sur une case avec assez de fourmiz et de nourriture.
5. **Saisons** : en hiver, la récolte chute et la reine pond moins (sauf sous les tropiques). L'hémisphère sud a les saisons inversées.
6. **Victoire** : la première colonie qui contrôle 20 % des terres gagne l’ère.

En solo, la partie est sauvegardée dans le navigateur. En ligne, le monde vit sur le serveur. Après une victoire, un nouveau monde (une nouvelle « ère ») naît une heure plus tard. Si ta colonie disparaît, tu peux en refonder une.

## Structure

| Fichier | Rôle |
|---|---|
| `functions/shared/config.js` | **Toutes les valeurs de jeu** (biomes, coûts, vitesses, IA, rythme en ligne). |
| `functions/shared/sim.js` | Règles du jeu, sans affichage : utilisées **à la fois** par le site et par le serveur. |
| `functions/shared/ai.js`, `world.js` | Colonies IA ; grille H3 et biomes. |
| `functions/index.js`, `engine.js` | Serveur Firebase : tour de jeu chaque minute, validation des ordres des joueurs. |
| `database.rules.json` | Règles de sécurité : les joueurs lisent le monde et envoient des ordres, seul le serveur écrit. |
| `js/backend.js` | Solo (simulation locale) ou en ligne (Firebase), avec la même interface. |
| `js/map.js`, `ui.js`, `main.js` | Carte, interface, clics. |
| `js/firebase-config.js` | La configuration de ton projet Firebase. |
| `tests/sim.test.js` | Tests : `node --test tests/sim.test.js` |

## Crédits

Carte : MapLibre GL JS, tuiles OpenFreeMap, données © contributeurs OpenStreetMap. Terres : Natural Earth (domaine public). Grille : H3 (Uber, licence Apache 2.0).
