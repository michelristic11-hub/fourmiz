# Fourmiz — prototype jouable

Jeu de conquête du monde avec des colonies de fourmiz. La carte du monde est découpée en environ 10 800 cases hexagonales (grille H3) sur la terre ferme. Pars d'un nid, nourris ta colonie et répands-toi sur toute la planète.

Deux modes :
- **En ligne** : un monde partagé et persistant qui avance en continu, 24 h/24, sur un serveur Firebase. Il n'y a pas de tours. On se connecte avec son compte Google.
- **Solo** (`index.html?solo`) : contre 5 colonies IA, tout tourne dans le navigateur, avec une vitesse réglable.

Pour la mise en ligne, suis **`MISE_EN_LIGNE.md`**. Tant que `js/firebase-config.js` n'est pas rempli, le jeu démarre en solo.

## Lancer le jeu

- **Sur ton PC** : double-clique sur `index.html` (il faut une connexion internet). Le mode en ligne exige que le site soit publié sur GitHub Pages, car la connexion Google ne marche pas depuis un fichier local.
- **En ligne** : voir `MISE_EN_LIGNE.md`.

## Comment jouer

1. **Fonder sa colonie** : choisis un nom, puis clique sur une case libre de la terre ferme, à au moins 4 cases d'une autre colonie. Ta reine s'y installe avec 30 fourmiz.
2. **Ordres** :
   - **glisse** d'une de tes cases vers une autre pour y envoyer des fourmiz, même loin : elles passent par tes galeries, plus vite que sur un terrain inconnu. La cible peut être une de tes cases (renfort) ou une case qui touche ton territoire (attaque) ;
   - ou **touche** une de tes cases, puis une case voisine surlignée (jaune : renfort, rouge : attaque) ;
   - choisis la part envoyée (25 %, 50 %, 75 % ou tout) dans la barre d'action ;
   - on peut viser **n'importe quelle case du monde**, même sur un autre continent : c'est une **expédition** 🌊 (plus lente, au toucher il faut confirmer en touchant deux fois) ;
   - **Rassembler ici** fait venir vers la case choisie les fourmiz en trop de tout ton territoire.
   - Les boutons 👑, 🐜 et 🗺️ te ramènent à ton nid, à ta plus grosse armée ou à tout ton territoire.
3. **Castes** : la reine pond des **ouvrières** (elles récoltent), des **soldates** (force 3, mangent deux fois plus) et des **éclaireuses** (deux fois plus rapides). Tu choisis la répartition : Récolte, Équilibre, Guerre ou Exploration. Les éclaireuses sont ×4 contre les insectes sauvages et jamais fatiguées. Dans la barre d'action, **Armée** (par défaut) envoie soldates, éclaireuses et ouvrières en trop sans vider la récolte. La **répartition automatique** envoie les ouvrières inutiles là où il en manque.
4. **Récolte** : chaque case a un **nombre idéal d'ouvrières** (16 en jungle, 3 en désert…) ; en dessous elle rapporte moins, au-delà presque rien de plus. Plus une case est **loin du nid**, moins elle rapporte (logistique).
5. **Combat** : chaque attaque compare des forces. **Encercler** une case (l'attaquer en possédant plusieurs cases autour) donne un bonus ; un **long trajet** fatigue ; les cases **proches d'un nid** se défendent mieux. L'aperçu pendant le glisser-déposer annonce le résultat probable.
6. **Survie** : chaque fourmi mange. En **hiver** (hors tropiques), la récolte chute fortement et la réserve se gâte : prévois des stocks. En famine, les soldates meurent en premier. Si un ennemi prend ton nid, ta reine meurt : élève-en une nouvelle.
7. **Évolutions** : dépense ta nourriture pour améliorer ta colonie (récolte, greniers, champignonnière, mâchoires, carapace, acide, fécondité, phéromones de piste, galeries), jusqu'au niveau 3.
8. **Bouclier** (en ligne) : quitte le jeu plus de 10 minutes et ta colonie s'endort, intouchable mais gelée, jusqu'à ton retour. Le bouton 📨 copie le lien du jeu pour inviter des amis.
9. **Victoire** : la première colonie qui contrôle 30 % des terres gagne l’ère.

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
