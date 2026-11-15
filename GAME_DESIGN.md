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

## Règles (valeurs dans `functions/shared/config.js`)

- **Rythme** : un tick toutes les 0,2 s, en continu. Une saison dure 10 minutes.
- **Départ** : une case libre à au moins 4 cases d'une autre colonie, avec 24 ouvrières, 6 soldates et 100 de nourriture.
- **Castes** : ouvrière (force 1, mange 0,04/tick, coûte 1), soldate (force 3, mange 0,08, coûte 2,5), éclaireuse (force 0,6, mange 0,04, coûte 1,5, deux fois plus rapide). La reine pond selon une répartition choisie (Récolte 85/10/5, Équilibre 60/35/5, Guerre 30/65/5, Exploration 50/20/30).
- **Ponte** : 0,5 œuf/tick + 0,02 par territoire (max 3), modes arrêt / normal / intensif, ralentie en hiver.
- **Récolte** : valeur du biome × efficacité des ouvrières (idéal = biome × 10 ouvrières ; au-delà, +10 % × ln) × logistique (1 / (1 + (distance au nid − 2) / 10)) × saison.
- **Hiver** : récolte ×0,2 hors tropiques, la réserve perd 0,02 %/tick (réduit par les greniers).
- **Combat** : loi de Lanchester au carré sur les forces. Défense : ×1,25, × biome, ×1,5 sur le nid, ×1,3 à 2 cases du nid. Attaque : +15 % par côté en plus (max +60 %), fatigue −4 % par case au-delà de 3 (min −40 %).
- **Évolutions** (3 niveaux, coût ×2,5 par niveau) : Mandibules (+15 % récolte), Greniers (+50 % stock, −35 % pertes d'hiver), Champignonnière (hiver +15 points), Mâchoires (+15 % attaque), Carapace (+15 % défense), Acide formique (soldates +1 force), Fécondité (+20 % ponte), Phéromones de piste (+5 cases de logistique), Galeries (trajets −20 %).
- **Victoire** : 30 % des terres. En ligne, un nouveau monde naît une heure après.

## Architecture multijoueur (en place)

```
games/monde/state               tout l'état du monde (écrit uniquement par le serveur)
games/monde/orders/{id}         ordres des joueurs : join, send, lay, queen (écrits par les joueurs)
games/monde/results/{uid}       résultat du dernier ordre de chaque joueur (accepté ou refusé, avec la raison)
```

- **`tick`** (Cloud Function planifiée chaque minute) : rattrape le temps écoulé (300 ticks de 0,2 s) avec `SIM.step` et l'IA, dans une transaction. Elle crée le monde s'il n'existe pas, et recrée un nouveau monde une heure après une victoire.
- **`order`** (déclenchée à chaque ordre) : valide l'ordre avec `SIM.applyOrder` (bonne colonie, case voisine, assez de fourmiz…), l'applique dans une transaction, puis écrit le résultat.
- **Client** : écoute `state` en temps réel et envoie des ordres. Il ne calcule rien : impossible de tricher.
- **Sécurité** : les règles n'autorisent que la lecture de l'état et la création d'ordres signés de son propre `uid`.
- **Le même `sim.js`** tourne dans le navigateur (mode solo) et sur le serveur.

Rythme : pas de tours. Le monde avance d'un tick toutes les 0,2 s. Le serveur rattrape le temps écoulé chaque minute et à chaque ordre ; le navigateur prédit la suite entre deux mises à jour avec le même `sim.js` et applique tout de suite les ordres du joueur. Une saison dure 10 minutes, une année 40 minutes.

## Prochaines étapes

1. **Mettre en ligne** en suivant `MISE_EN_LIGNE.md`.
2. **Équilibrer** à partir des premières parties : vitesse d'expansion, famine, agressivité de l'IA.
3. **Idées de gameplay** : castes (ouvrières, soldates), routes de ravitaillement entre cases, alliances, phéromones (ordres automatiques), événements météo.
