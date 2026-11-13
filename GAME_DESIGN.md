# Fourmiz — design et feuille de route

## Pitch

Un jeu web multijoueur persistant (temps réel lent, façon OGame) où chaque joueur dirige une colonie de fourmiz sur la vraie carte du monde. Le monde est découpé en cases hexagonales. On part de quelques fourmiz, on produit, on se nourrit et on conquiert les cases voisines jusqu'à dominer la planète.

## Choix techniques

| Sujet | Choix | Pourquoi |
|---|---|---|
| Carte | MapLibre GL JS + OpenFreeMap | Gratuit, sans clé API ni carte bancaire, open source. Google Maps impose un compte de facturation et ses conditions limitent les surcouches. |
| Territoires | Grille H3, résolution 3 (≈ 10 800 cases de terre) | Chaque case a 6 voisines (sauf 12 pentagones), identifiants stables, parfaits comme clés de base de données. |
| Hébergement du client | GitHub Pages | Site statique gratuit. |
| Serveur | Firebase : Auth (Google) + Realtime Database + Cloud Functions | Temps réel intégré. La Realtime Database est facturée au volume et non à l'écriture, ce qui convient à un monde qui change chaque minute. |

## Règles du prototype (valeurs dans `js/config.js`)

- **Départ** : on fonde sa colonie sur n'importe quelle case libre, à au moins 4 cases d'une autre colonie, avec 30 fourmiz et 60 de nourriture.
- **Ponte** : 0,5 fourmi/tick, plus 0,02 par territoire (maximum 3), 1 nourriture par fourmi. Les modes arrêt, normal (x1) et intensif (x2, coût x1,5) sont au choix. En hiver, hors tropiques, la ponte passe à x0,4.
- **Nourriture** : chaque case occupée récolte selon son biome (de 0,05 pour la glace à 1,6 pour la jungle), multiplié par la saison. L'entretien est de 0,04 par fourmi et par tick. Le stockage maximal vaut 200 + 20 par territoire. En famine, 2 % des fourmiz meurent par tick.
- **Biomes** : jungle, forêt, savane, prairie, désert, montagne, taïga, toundra et glace. Chacun a sa récolte, sa défense, son temps de trajet et sa garnison d'insectes sauvages.
- **Combat** : loi de Lanchester au carré. Le défenseur est multiplié par un bonus (x1,25), par la défense du biome et par x1,5 sur un nid.
- **Saisons** : 120 ticks chacune. L'hémisphère sud est décalé de deux saisons. Pas d'hiver sous 23° de latitude.
- **Reine** : la prise du nid tue la reine. On peut en élever une nouvelle pour 150 de nourriture sur une case de 25 fourmiz ou plus.
- **Victoire** : 20 % des terres. En ligne, un nouveau monde naît une heure après.

## Architecture multijoueur (en place)

```
games/monde/state               tout l'état du monde (écrit uniquement par le serveur)
games/monde/orders/{id}         ordres des joueurs : join, send, lay, queen (écrits par les joueurs)
games/monde/results/{uid}       résultat du dernier ordre de chaque joueur (accepté ou refusé, avec la raison)
```

- **`tick`** (Cloud Function planifiée chaque minute) : fait avancer le monde d'un tour avec `SIM.step` et l'IA, dans une transaction. Elle crée le monde s'il n'existe pas, et recrée un nouveau monde une heure après une victoire.
- **`order`** (déclenchée à chaque ordre) : valide l'ordre avec `SIM.applyOrder` (bonne colonie, case voisine, assez de fourmiz…), l'applique dans une transaction, puis écrit le résultat.
- **Client** : écoute `state` en temps réel et envoie des ordres. Il ne calcule rien : impossible de tricher.
- **Sécurité** : les règles n'autorisent que la lecture de l'état et la création d'ordres signés de son propre `uid`.
- **Le même `sim.js`** tourne dans le navigateur (mode solo) et sur le serveur.

Rythme : 1 tour par minute. Une saison dure environ 2 heures, une année 8 heures, et un trajet quelques minutes. Tout se règle dans `config.js` (`online.ticksPerRun`, `seasons.lengthTicks`…).

## Prochaines étapes

1. **Mettre en ligne** en suivant `MISE_EN_LIGNE.md`.
2. **Équilibrer** à partir des premières parties : vitesse d'expansion, famine, agressivité de l'IA.
3. **Idées de gameplay** : castes (ouvrières, soldates), routes de ravitaillement entre cases, alliances, phéromones (ordres automatiques), événements météo.
