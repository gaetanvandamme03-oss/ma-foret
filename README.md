# 🐝 Ma Forêt - Système de Gestion des Stocks

## 📋 Installation et Démarrage

### 1. **Démarrer le serveur backend**

Ouvrez un terminal et naviguez vers le dossier `server` :

```bash
cd server
npm start
```

Le serveur écoute le port `3000` par défaut (ou la variable d’environnement `PORT`).

### 2. **Page d’administration (stocks)**

Une fois le serveur démarré, ouvrez dans le navigateur :

`http://localhost:3000/admin`

(L’admin est servie par le même serveur Node que l’API.)

### 3. **Ouvrir le site vitrine**

Ouvrez les fichiers HTML du dossier `site ma foret` comme d’habitude. Le panier charge **`api-config.js`** puis **`cart-updated.js`** : vérifiez l’URL de l’API (voir section Mise en ligne).

### Mise en production

Guide pas à pas (Render + Netlify, variables, disque persistant) : **`../DEPLOY.md`** (à la racine du dossier `2026-04-29`).

## 🔄 Comment ça fonctionne ?

### Flux de réservation de stock :

1. **Quand un client ajoute un produit au panier** :
   - Le frontend (`cart-updated.js`) envoie une requête au serveur
   - Le serveur vérifie si le stock est suffisant
   - Si oui : le stock est immédiatement réduit de 1 dans `stocks.json`
   - Si non : une alerte s'affiche "Stock insuffisant"

2. **Quand on modifie la quantité** :
   - `+` : réserve la quantité supplémentaire du serveur
   - `-` : libère la quantité au serveur

3. **Quand on supprime un article** :
   - Le stock complète est libéré

4. **Quand on valide la commande** :
   - L’email est envoyé avec les détails
   - Le panier est vidé ; le stock **reste** celui déjà diminué pendant la navigation (pas de double réservation à l’envoi)

## 📊 Fichiers importants

| Fichier | Utilité |
|---------|---------|
| `server/server.js` | Serveur HTTP (Node) : API `/api/...` + page `/admin` |
| `server/stocks.json` | Stocks (mis à jour par l’API et l’admin) |
| `site ma foret/api-config.js` | URL publique de l’API en production |
| `site ma foret/cart-updated.js` | Panier (réservation / libération côté serveur) |
| `server/admin.html` | Gabarit HTML de l’admin (servi sur `/admin`) |

## 🔧 API du serveur

### GET /api/stocks
Récupère tous les stocks.

**Réponse :**
```json
[
  {
    "id": "miel-printemps",
    "name": "Miel de printemps",
    "stock": 49
  }
]
```

### GET /api/stocks/:id
Récupère le stock d'un produit spécifique.

### POST /api/stocks/reserve/:id
Réserve (réduit) le stock.

**Body :**
```json
{
  "quantity": 1
}
```

### POST /api/stocks/release/:id
Libère (augmente) le stock.

### POST /api/stocks/:id/update
Met à jour manuellement le stock (admin).

## 🌐 Mise en ligne (hébergeur)

Guide détaillé (Render, Netlify, `CORS_ORIGIN`, disque persistant, `api-config.js`) : fichier **`DEPLOY.md`** dans le dossier parent (`2026-04-29/DEPLOY.md`).

## 🔐 Changer l'email de commande

Dans `site ma foret/cart-updated.js`, modifiez la constante `ORDER_EMAIL` (FormSubmit).

## 📝 Personnaliser les produits

Éditez le fichier `server/stocks.json` pour ajouter ou modifier les produits :

```json
{
  "stocks": [
    {
      "id": "miel-nouveau",
      "name": "Miel Nouveau Produit",
      "stock": 100
    }
  ]
}
```

Mettez à jour aussi le mapping dans `cart-updated.js` :

```javascript
const PRODUCT_STOCK_MAP = {
  "Miel Nouveau Produit": "miel-nouveau",
};
```

## ⚠️ Notes importantes

- Le serveur doit être joignable pour ajouter au panier ou modifier les quantités (le stock est réservé côté serveur à chaque ajout).
- Les stocks sont dans `server/stocks.json` (fichier JSON sur le serveur ; pensez aux sauvegardes sur votre hébergement).

## 🆘 Troubleshooting

### "Impossible de se connecter au serveur"
→ Vérifiez que `npm start` a été lancé dans le dossier `server`

### Les stocks ne se mettent pas à jour
→ Vérifiez que `http://localhost:3000/api/health` répond OK dans votre navigateur

## 📞 Support

Pour toute question, consultez les logs de la console du navigateur (F12 → Console).
