# Fourmiz — design et feuille de route

## Pitch

Un jeu web multijoueur persistant où chaque joueur dirige une colonie de fourmiz dans un **jardin** vu de haut, découpé en cases hexagonales. On va et on vient : le monde ne s'arrête jamais. Le but est de faire le meilleur **score** en tenant des **trésors** et en réussissant des **missions**. Si la reine meurt, la colonie disparaît, son score entre aux **records**, et on recommence.

## Choix techniques

| Sujet | Choix | Pourquoi |
|---|---|---|
| Carte | Jardin généré (`functions/shared/garden.js`) et dessiné sur un `<canvas>` (`js/map.js`) | Aucune bibliothèque ni téléchargement, rapide sur téléphone, thème « fourmi ». Une graine suffit pour recréer la même carte sur le serveur et dans les navigateurs. |
| Cases | Hexagones « pointe en haut », environ 52 × 36 (≈ 1 550 cases franchissables) | Assez petit pour se croiser vite, assez grand pour s'étendre. |
| Hébergement du client | GitHub Pages | Site statique gratuit. |
| Serveur | Firebase : Auth (Google) + Realtime Database + Cloud Functions | Temps réel intégré. |

## Règles (valeurs dans `functions/shared/config.js`)

- **Rythme** : en solo, un tick toutes les 0,2 s (une saison = 10 minutes). En ligne, le temps passe 8 fois moins vite (`online.slowdown`).
- **Carte** : terrains (fleurs, mousse, feuilles mortes, herbe, terre, racines, sable) et obstacles infranchissables (flaques, cailloux). Toutes les cases franchissables sont reliées : les zones séparées sont rattachées par des ponts de feuilles mortes.
- **Trésors** (environ un pour 140 cases, gardés par beaucoup d'insectes) : tant qu'on les tient, points, nourriture et un **pouvoir** (non cumulable par type) : 🍬 sucre ponte +40 %, 🍎 pomme récolte +25 % et réserve +50 %, 🥖 miettes entretien −25 %, 🍯 miel évolutions −30 %, 🪲 scarabée géant (unique, au centre) force +20 %.
- **Missions** : 3 à la fois par joueur (territoires, terrain, soldates, cases sauvages, cases ennemies, trésor, réserve, évolution). Réussie : points + nourriture, puis une nouvelle. **Mission rare ⭐** (20 % de chance à chaque nouvelle mission, tant qu'on ne l'a pas réussie) : tenir le scarabée géant 1 500 ticks d'affilée. Elle débloque le **héros scarabée** pour toujours (compte Google en ligne, navigateur en solo).
- **Score** : trésors tenus, missions, +1 par case sauvage prise, +3 par case ennemie prise. Classement des colonies vivantes et **records** des colonies disparues (10 meilleurs).
- **Castes** : ouvrière (force 1, **automatique** : elle se répartit seule pour récolter), soldate (force 3), éclaireuse (force 0,6, ×4 contre les insectes sauvages, jamais fatiguée, 2× plus rapide). Le joueur ne manipule que l'**armée** (soldates, éclaireuses, ouvrières en trop) et le héros.
- **Héros scarabée** 🪲 : pièce unique déplacée sur la carte (seul, ou avec l'armée). Force ×1,3 (+0,1 par niveau) et +10 (+8 par niveau) sur sa case en défense, ou pour l'armée qu'il accompagne. Niveaux à 3, 8, 15, 25 points d'expérience (combats gagnés). Vaincu : retour au nid après 600 ticks.
- **Garde royale** : chaque nid (joueurs et IA) a une garde gratuite de 30 + 4 par territoire (max 400) qui se régénère (plein en 600 ticks). Un raid trop petit échoue et l'entame seulement.
- **Reine** : si le nid est pris (garde royale comprise), la reine meurt et la colonie disparaît ; ses cases redeviennent sauvages.
- **Interface** : bandeau toujours visible (nourriture, fourmiz, score, mission la plus avancée) et panneau en onglets (Colonie, Missions, Évolutions, Monde, Aide).
- **IA** : les colonies IA disparues sont remplacées (une toutes les 1 500 ticks). Elles visent aussi les trésors. Elles n'attaquent pas un joueur pendant ses 1 500 premiers ticks, puis seulement avec une force double.
- **Bouclier d'absence** (en ligne) : sans signe de vie pendant 375 ticks (≈ 10 min), une colonie humaine s'endort : économie gelée (la garde royale se reconstitue quand même), et les cases à 2 cases ou moins du nid se défendent ×2,5. Le reste du territoire s'attaque normalement : tuer un absent est difficile, pas impossible. Le navigateur envoie un signal de présence toutes les 2 minutes tant que la page est ouverte.
- **Récolte, combat, évolutions, saisons** : inchangés (voir `config.js`).

## Architecture multijoueur

```
games/monde/state               tout l'état du monde (écrit uniquement par le serveur)
games/monde/orders/{id}         ordres des joueurs (écrits par les joueurs)
games/monde/results/{uid}       résultat du dernier ordre de chaque joueur
games/monde/presence/{uid}      heure du dernier signal « je suis là » (écrit par le joueur)
users/{uid}/unlocks             combattants débloqués (écrit par le serveur, lu par le joueur)
```

- **`tick`** (chaque minute) : lit d'abord la présence. **Si personne n'est venu depuis 15 minutes, il s'arrête là** (presque gratuit). Sinon il rattrape le temps écoulé (au plus 600 ticks), applique la présence (bouclier), et enregistre les déblocages.
- **`order`** : valide et applique l'ordre ; pour fonder une colonie, il lit les déblocages sur le compte du joueur (jamais ceux envoyés par le navigateur).
- **Robustesse** : l'état est nettoyé avant chaque écriture ; si la transaction échoue, le serveur relit et écrit directement.
- **Coût** : l'état fait quelques dizaines de Ko (au lieu de 230 Ko sur l'ancienne carte du monde). Changer `online.worldVersion` recrée le monde en ligne.

## Prochaines idées

Alliances, notifications (« ton nid est attaqué »), réactions rapides entre joueurs, d'autres combattants à débloquer (fourmi pot-de-miel, coccinelle…), événements (pluie qui inonde les flaques, fourmilier).
