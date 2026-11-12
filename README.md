# 🎄 Secret Santa de Noël

Application web complète et festive de **Secret Santa** (Père Noël Secret) avec gestion de comptes, création & adhésion à des sessions privées, tirage au sort 100 % secret et interface immersive aux couleurs de Noël.

---

## ✨ Fonctionnalités

- 🎅 **Ambiance de Noël immersive** :
  - Flocons de neige animés en continu (activables / désactivables d'un clic).
  - Guirlande lumineuse scintillante.
  - Avatars de Noël au choix (Père Noël, Mère Noël, Renne, Bonhomme de neige, Lutin, Sapin, Biscuit, Renard).
  - Thème givré, rouge velours et or scintillant.

- 🎁 **Création de compte & Sessions dès l'inscription** :
  - **Rejoindre une session** : Entrez simplement le code d'invitation (ex: `NOEL-TW5K`).
  - **Créer une session** : Définissez le nom, le budget indicatif et la date de l'échange.
  - **Espace personnel** : Si vous oubliez qui vous avez tiré au sort, connectez-vous pour retrouver vos sessions et votre cible.

- 🔒 **Tirage au sort 100 % secret et confidentiel** :
  - **Confidentialité totale côté serveur** : L'API ne renvoie jamais les attributions des autres participants.
  - **Anti-curieux à l'écran** : Le résultat du tirage est dissimulé derrière un cadeau animé `🎁` qu'on clique pour afficher ou masquer.
  - **Exclusions personnalisées** : Possibilité pour l'organisateur d'exclure certains tirages (par exemple pour éviter que deux conjoints se tirent mutuellement).
  - **Liste de souhaits secrète** : Chaque participant peut renseigner ses idées cadeaux, visibles **uniquement** par son Père Noël attitré.

---

## 🚀 Démarrage rapide

### Prérequis
- [Node.js](https://nodejs.org/) (v16 ou supérieur)

### Lancement
```bash
# Cloner le dépôt
git clone <url-du-repo>
cd secret-santa

# Démarrer le serveur
node server.js
# ou npm start
```

L'application est immédiatement accessible sur **http://localhost:3000** !

---

## 🛠️ Architecture & Technologies

- **Backend** : Node.js (modules natifs `http`, `crypto`, `fs`, `path`) — aucune dépendance externe requise !
- **Frontend** : HTML5, CSS3 animé moderne (animations de neige Canvas, guirlandes lumineuses, flexbox/grid responsive), JavaScript Vanilla SPA.
- **Stockage** : Persistance JSON sécurisée avec hachage de mot de passe Scrypt (`data/db.json`).
