# Mettre Fourmiz en ligne (multijoueur)

Il y a trois étapes, à faire dans cet ordre. Compte environ 30 minutes la première fois.

1. **Firebase** : le serveur et la base de données, sur console.firebase.google.com.
2. **Déployer le serveur** depuis ton PC, avec quelques commandes PowerShell.
3. **GitHub Pages** : le site du jeu, sur github.com.

---

## 1. Créer le projet Firebase

1. Va sur <https://console.firebase.google.com> et connecte-toi avec ton compte Google.
2. **Créer un projet** et nomme-le `fourmiz`. Tu peux désactiver Google Analytics.
3. **Passer au forfait Blaze** : clique sur l'engrenage ⚙️, puis *Utilisation et facturation*, *Détails et paramètres*, *Modifier le forfait* et choisis **Blaze**.
   - Une carte bancaire est demandée, mais le quota gratuit couvre normalement un petit jeu (au pire quelques centimes par mois).
   - Crée tout de suite une **alerte de budget** à 5 € quand c'est proposé, pour être prévenu au moindre dépassement.
4. **Realtime Database** : dans le menu *Créer*, choisis *Realtime Database* puis *Créer une base de données*.
   - Emplacement : **États-Unis (us-central1)**. C'est important, le serveur est réglé sur cette région.
   - Mode : **verrouillé**. Les bonnes règles seront envoyées à l'étape 2.
5. **Connexion Google** : dans le menu *Créer*, choisis *Authentication* puis *Commencer*. Dans *Google*, clique sur **Activer**, choisis ton e-mail d'assistance et enregistre.
   - Toujours dans Authentication, ouvre l'onglet **Paramètres**, puis *Domaines autorisés*, *Ajouter un domaine* et saisis `TON-PSEUDO-GITHUB.github.io`.
6. **Configuration web** : clique sur l'engrenage ⚙️, *Paramètres du projet*, puis l'icône **</>** (Web) dans *Vos applications*.
   - Nomme l'application `fourmiz-web`. Inutile de cocher Hosting.
   - Firebase affiche un bloc `firebaseConfig`. Recopie ses valeurs dans **`js/firebase-config.js`** (apiKey, authDomain, databaseURL, projectId, appId), ou envoie-les à Claude pour qu'il le fasse.
   - Ces clés ne sont pas secrètes : elles peuvent être publiques sur GitHub.

## 2. Déployer le serveur (Cloud Functions + règles)

Sur ton PC Windows :

1. Installe **Node.js** (version LTS) depuis <https://nodejs.org>, puis redémarre ton PC.
2. Ouvre **PowerShell** et tape les commandes une par une :

```powershell
cd "$HOME\Documents\Claude-Code-Game-Studios\prototypes\fourmiz"
npm install -g firebase-tools
firebase login
firebase use --add
cd functions
npm install
cd ..
firebase deploy --only "functions,database"
```

Quelques précisions :

- `firebase login` ouvre ton navigateur : connecte-toi avec le même compte Google.
- `firebase use --add` : choisis ton projet `fourmiz`, puis tape `default` comme alias.
- Le premier déploiement prend quelques minutes. Si une erreur parle de permissions ou d'API « en cours d'activation », attends 2 minutes et relance la dernière commande.
- Si PowerShell refuse d'exécuter `npm` ou `firebase` (« l'exécution de scripts est désactivée »), tape `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, réponds `O`, puis recommence.

Ensuite, le serveur fait avancer le monde **toutes les minutes, 24 h/24**. Le monde est créé automatiquement à la première minute.

## 3. Publier le site sur GitHub Pages

1. Va sur <https://github.com/new>.
   - Nom du dépôt : `fourmiz`.
   - Visibilité : **Public** (GitHub Pages gratuit l'exige).
   - Ne coche rien d'autre, puis clique sur *Create repository*.
2. Sur la page du dépôt vide, clique sur **uploading an existing file**.
3. Ouvre le dossier `prototypes\fourmiz` dans l'Explorateur, sélectionne **tout son contenu** et glisse-le dans la page GitHub.
   - Ne mets **pas** le dossier `functions\node_modules` : il est énorme et inutile en ligne. Le plus simple est d'ouvrir `functions` et d'y glisser tout sauf `node_modules`.
4. Clique sur *Commit changes*.
5. Dans le dépôt, va dans **Settings**, puis **Pages**. Sous *Build and deployment*, choisis *Deploy from a branch*, la branche `main` et le dossier `/ (root)`, puis clique sur **Save**.
6. Après 1 à 2 minutes, le jeu est en ligne sur `https://TON-PSEUDO-GITHUB.github.io/fourmiz/`.

## 4. Jouer

- Ouvre l'adresse du jeu et clique sur **Se connecter avec Google**.
- Choisis le nom de ta colonie, puis clique sur une case libre pour la fonder.
- Envoie le lien à tes amis : tout le monde joue dans le même monde.
- Le lien **Jouer en solo** reste disponible pour s'entraîner contre l'ordinateur.

## Mettre à jour plus tard

- **Le site** (fichiers `index.html`, `js/`, `css/`, `functions/shared/`) : renvoie les fichiers modifiés sur GitHub avec *Add file* puis *Upload files*. Ils remplacent les anciens.
- **Les règles du jeu ou le serveur** (`functions/`) : relance `firebase deploy --only "functions,database"`. Comme `functions/shared/` est utilisé par le site **et** par le serveur, mets à jour les deux.
- **Recommencer un monde de zéro** : dans la console Firebase, ouvre *Realtime Database*, survole `games`, puis clique sur 🗑️. Un nouveau monde naît à la minute suivante.
