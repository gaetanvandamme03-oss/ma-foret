
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url';

// Chargement sécurisé des variables d'environnement (PayPal, etc.)
try {
  const dotenvPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
  if (fs.existsSync(dotenvPath)) {
    const dotenv = await import('dotenv');
    dotenv.config({ path: dotenvPath });
  }
} catch (e) {
  console.warn('dotenv non chargé (optionnel en prod):', e.message);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const STOCKS_FILE = process.env.STOCKS_FILE
  ? path.resolve(process.env.STOCKS_FILE)
  : path.join(__dirname, 'stocks.json');
const ADMIN_FILE = path.join(__dirname, 'admin.html');
const STOCKS_SEED = path.join(__dirname, 'stocks.json');

function ensureStocksFile() {
  try {
    if (fs.existsSync(STOCKS_FILE)) return;
    const dir = path.dirname(STOCKS_FILE);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(STOCKS_SEED) && path.resolve(STOCKS_SEED) !== path.resolve(STOCKS_FILE)) {
      fs.copyFileSync(STOCKS_SEED, STOCKS_FILE);
    } else {
      fs.writeFileSync(STOCKS_FILE, JSON.stringify({ stocks: [] }, null, 2), 'utf8');
    }
  } catch (error) {
    console.error('Impossible de préparer le fichier stocks:', error);
  }
}

ensureStocksFile();

function normalizePositiveInt(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || Math.floor(n) !== n) return null;
  return n;
}

function normalizeNonNegativeInt(raw) {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) return null;
  return n;
}

function readStocks() {
  try {
    const data = fs.readFileSync(STOCKS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Erreur lecture stocks:', error);
    return { stocks: [] };
  }
}

function writeStocks(data) {
  try {
    fs.mkdirSync(path.dirname(STOCKS_FILE), { recursive: true });
    fs.writeFileSync(STOCKS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Erreur écriture stocks:', error);
    return false;
  }
}

function setHeaders(res, statusCode = 200, contentType = 'application/json') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
}

function serveAdminPage(res) {
  fs.readFile(ADMIN_FILE, 'utf8', (err, html) => {
    if (err) {
      setHeaders(res, 500, 'text/plain; charset=utf-8');
      res.end('Impossible de charger la page admin.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': CORS_ORIGIN,
    });
    res.end(html);
  });
}

function parseBody(req, callback) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    try {
      const parsed = body.trim() ? JSON.parse(body) : {};
      callback(null, parsed);
    } catch {
      callback(new Error('JSON invalide'), null);
    }
  });
}

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const PENDING_PAYPAL_FILE = path.join(__dirname, 'pending-paypal-orders.json');
const SHIPPING_THRESHOLD = 50;
const SHIPPING_FEE = 5;

/** Prix unitaires (€) — doivent correspondre aux boutons du site */
const CATALOG_PRICES = {
  'miel-debut-250': 6,
  'miel-debut-500': 11,
  'tradition-250': 6,
  'tradition-500': 11,
  'vanille-orange-250': 7,
  'cerise-griotte-250': 7,
  'noisette-chocolat-250': 7,
  'propolis-250': 8,
  'miel-ete-250': 6,
  'miel-ete-500': 11,
  'miel-foret-250': 6,
  'miel-foret-500': 11,
};

function resolveStockId(product, size) {
  const direct = {
    'Miel début saison 250g': 'miel-debut-250',
    'Miel début saison 500g': 'miel-debut-500',
    'Tradition 250g': 'tradition-250',
    'Tradition 500g': 'tradition-500',
    'Vanille orange 250g': 'vanille-orange-250',
    'Cerise griotte 250g': 'cerise-griotte-250',
    'Noisette chocolat 250g': 'noisette-chocolat-250',
    "À l'extrait de propolis 250g": 'propolis-250',
  };
  if (direct[product]) return direct[product];
  if (size) {
    const composite = `${product}|${size}`;
    const bySize = {
      "Miel d'été|250g": 'miel-ete-250',
      "Miel d'été|500g": 'miel-ete-500',
      "Miel de forêt|250g": 'miel-foret-250',
      "Miel de forêt|500g": 'miel-foret-500',
    };
    if (bySize[composite]) return bySize[composite];
  }
  return null;
}

function validateCartLines(cartLines) {
  if (!Array.isArray(cartLines) || cartLines.length === 0) {
    return { error: 'Panier vide' };
  }
  let total = 0;
  const lines = [];
  for (const line of cartLines) {
    const stockId = resolveStockId(line.product, line.size);
    if (!stockId) {
      return { error: `Produit non reconnu : ${line.product} ${line.size || ''}`.trim() };
    }
    const unitPrice = CATALOG_PRICES[stockId];
    if (unitPrice === undefined) {
      return { error: `Prix catalogue manquant pour ${stockId}` };
    }
    const quantity = normalizePositiveInt(line.quantity, null);
    if (quantity === null) {
      return { error: 'Quantité invalide' };
    }
    const clientPrice = Number(line.price);
    if (!Number.isFinite(clientPrice) || Math.abs(clientPrice - unitPrice) > 0.02) {
      return { error: `Prix incorrect pour ${line.product}` };
    }
    total += unitPrice * quantity;
    lines.push({
      stockId,
      product: line.product,
      size: line.size || '',
      quantity,
      unitPrice,
    });
  }
  return { total: Number(total.toFixed(2)), lines };
}

function getShippingFee(subtotal) {
  return subtotal > 0 && subtotal < SHIPPING_THRESHOLD ? SHIPPING_FEE : 0;
}

function readPendingPaypalOrders() {
  try {
    if (!fs.existsSync(PENDING_PAYPAL_FILE)) return {};
    return JSON.parse(fs.readFileSync(PENDING_PAYPAL_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writePendingPaypalOrders(data) {
  fs.writeFileSync(PENDING_PAYPAL_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function saveCompletedOrder(record) {
  let orders = { orders: [] };
  if (fs.existsSync(ORDERS_FILE)) {
    orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')) || { orders: [] };
  }
  orders.orders.unshift(record);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
}

function getPaypalBase() {
  const mode = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function getPaypalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET not set');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(`${getPaypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`PayPal token failed: ${resp.status} ${txt}`);
  }
  const data = await resp.json();
  return data.access_token;
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  if (req.method === 'OPTIONS') {
    setHeaders(res);
    res.end();
    return;
  }

  if ((pathname === '/admin' || pathname === '/admin.html') && req.method === 'GET') {
    serveAdminPage(res);
    return;
  }

  if (pathname === '/api/stocks' && req.method === 'GET') {
    const data = readStocks();
    setHeaders(res, 200);
    res.end(JSON.stringify(data.stocks || []));
    return;
  }

  if (pathname.match(/^\/api\/stocks\/[^\/]+$/) && req.method === 'GET' && !pathname.includes('/reserve') && !pathname.includes('/release') && !pathname.includes('/update')) {
    const id = pathname.split('/')[3];
    const data = readStocks();
    const product = data.stocks.find((p) => p.id === id);

    if (!product) {
      setHeaders(res, 404);
      res.end(JSON.stringify({ error: 'Produit non trouvé' }));
      return;
    }

    setHeaders(res, 200);
    res.end(JSON.stringify(product));
    return;
  }

  if (pathname.match(/^\/api\/stocks\/reserve\//) && req.method === 'POST') {
    const id = pathname.split('/')[4];
    parseBody(req, (parseErr, body) => {
      if (parseErr) {
        setHeaders(res, 400);
        res.end(JSON.stringify({ error: 'Corps de requête JSON invalide' }));
        return;
      }
      const quantity = normalizePositiveInt(body.quantity, 1);
      if (quantity === null) {
        setHeaders(res, 400);
        res.end(JSON.stringify({ error: 'Quantité invalide (entier ≥ 1 requis)' }));
        return;
      }
      const data = readStocks();
      const product = data.stocks.find((p) => p.id === id);

      if (!product) {
        setHeaders(res, 404);
        res.end(JSON.stringify({ error: 'Produit non trouvé' }));
        return;
      }

      if (product.stock < quantity) {
        setHeaders(res, 400);
        res.end(JSON.stringify({
          error: 'Stock insuffisant',
          available: product.stock,
          requested: quantity,
        }));
        return;
      }

      product.stock -= quantity;

      if (writeStocks(data)) {
        setHeaders(res, 200);
        res.end(JSON.stringify({
          message: 'Stock réservé avec succès',
          product: product.name,
          remainingStock: product.stock,
        }));
      } else {
        setHeaders(res, 500);
        res.end(JSON.stringify({ error: 'Erreur lors de la sauvegarde' }));
      }
    });
    return;
  }

  if (pathname.match(/^\/api\/stocks\/release\//) && req.method === 'POST') {
    const id = pathname.split('/')[4];
    parseBody(req, (parseErr, body) => {
      if (parseErr) {
        setHeaders(res, 400);
        res.end(JSON.stringify({ error: 'Corps de requête JSON invalide' }));
        return;
      }
      const quantity = normalizePositiveInt(body.quantity, 1);
      if (quantity === null) {
        setHeaders(res, 400);
        res.end(JSON.stringify({ error: 'Quantité invalide (entier ≥ 1 requis)' }));
        return;
      }
      const data = readStocks();
      const product = data.stocks.find((p) => p.id === id);

      if (!product) {
        setHeaders(res, 404);
        res.end(JSON.stringify({ error: 'Produit non trouvé' }));
        return;
      }

      product.stock += quantity;

      if (writeStocks(data)) {
        setHeaders(res, 200);
        res.end(JSON.stringify({
          message: 'Stock augmenté avec succès',
          product: product.name,
          newStock: product.stock,
        }));
      } else {
        setHeaders(res, 500);
        res.end(JSON.stringify({ error: 'Erreur lors de la sauvegarde' }));
      }
    });
    return;
  }

  if (pathname.match(/^\/api\/stocks\/[^\/]+\/update$/) && req.method === 'POST') {
    const id = pathname.split('/')[3];
    parseBody(req, (parseErr, body) => {
      if (parseErr) {
        setHeaders(res, 400);
        res.end(JSON.stringify({ error: 'Corps de requête JSON invalide' }));
        return;
      }
      const stock = normalizeNonNegativeInt(body.stock);
      if (stock === null) {
        setHeaders(res, 400);
        res.end(JSON.stringify({ error: 'Stock invalide (entier ≥ 0 requis)' }));
        return;
      }

      const data = readStocks();
      const product = data.stocks.find((p) => p.id === id);

      if (!product) {
        setHeaders(res, 404);
        res.end(JSON.stringify({ error: 'Produit non trouvé' }));
        return;
      }

      const oldStock = product.stock;
      product.stock = stock;

      if (writeStocks(data)) {
        setHeaders(res, 200);
        res.end(JSON.stringify({
          message: 'Stock mis à jour',
          product: product.name,
          oldStock: oldStock,
          newStock: product.stock,
        }));
      } else {
        setHeaders(res, 500);
        res.end(JSON.stringify({ error: 'Erreur lors de la sauvegarde' }));
      }
    });
    return;
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    setHeaders(res, 200);
    res.end(JSON.stringify({ status: 'OK', message: 'Serveur Ma Forêt en ligne' }));
    return;
  }

  if (pathname === '/api/paypal/config' && req.method === 'GET') {
    const clientId = process.env.PAYPAL_CLIENT_ID || null;
    const mode = process.env.PAYPAL_MODE || 'sandbox';
    setHeaders(res, 200);
    res.end(JSON.stringify({ clientId, mode, ready: Boolean(clientId && process.env.PAYPAL_CLIENT_SECRET) }));
    return;
  }

  if (pathname === '/api/paypal/create-order' && req.method === 'POST') {
    parseBody(req, async (parseErr, body) => {
      if (parseErr) {
        setHeaders(res, 400);
        res.end(JSON.stringify({ error: 'Corps JSON invalide' }));
        return;
      }

      const validated = validateCartLines(body.cart);
      if (validated.error) {
        setHeaders(res, 400);
        res.end(JSON.stringify({ error: validated.error }));
        return;
      }

      const { total: subtotal, lines } = validated;
      const shipping = getShippingFee(subtotal);
      const total = Number((subtotal + shipping).toFixed(2));

      try {
        const token = await getPaypalAccessToken();
        const purchase = {
          intent: 'CAPTURE',
          purchase_units: [
            {
              description: 'Commande Ma Forêt',
              amount: { currency_code: 'EUR', value: total.toFixed(2) },
            },
          ],
        };

        const resp = await fetch(`${getPaypalBase()}/v2/checkout/orders`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(purchase),
        });

        const data = await resp.json();
        if (!resp.ok) {
          setHeaders(res, 500);
          res.end(JSON.stringify({ error: 'Erreur création commande PayPal', details: data }));
          return;
        }

        const pending = readPendingPaypalOrders();
        pending[data.id] = {
          cart: lines,
          subtotal,
          shipping,
          total,
          customer: body.customer || {},
          createdAt: new Date().toISOString(),
        };
        writePendingPaypalOrders(pending);

        setHeaders(res, 200);
        res.end(JSON.stringify({ orderID: data.id, subtotal, shipping, total }));
      } catch (error) {
        console.error('PayPal create-order error:', error);
        setHeaders(res, 500);
        res.end(JSON.stringify({ error: 'Erreur serveur PayPal', message: error.message }));
      }
    });
    return;
  }

  if (pathname.match(/^\/api\/paypal\/capture-order\//) && req.method === 'POST') {
    const orderId = pathname.split('/').pop();
    if (!orderId || orderId === 'capture-order') {
      setHeaders(res, 400);
      res.end(JSON.stringify({ error: 'orderId manquant' }));
      return;
    }

    parseBody(req, async (parseErr, body) => {
      if (parseErr) {
        setHeaders(res, 400);
        res.end(JSON.stringify({ error: 'Corps JSON invalide' }));
        return;
      }

      try {
        const token = await getPaypalAccessToken();
        const resp = await fetch(`${getPaypalBase()}/v2/checkout/orders/${orderId}/capture`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        const data = await resp.json();
        if (!resp.ok) {
          setHeaders(res, 500);
          res.end(JSON.stringify({ error: 'Erreur capture PayPal', details: data }));
          return;
        }

        const pending = readPendingPaypalOrders();
        const snapshot = pending[orderId] || { cart: [], customer: body.customer || {} };
        delete pending[orderId];
        writePendingPaypalOrders(pending);

        saveCompletedOrder({
          paypalOrderId: orderId,
          captureId: data.id,
          status: data.status,
          subtotal: snapshot.subtotal,
          shipping: snapshot.shipping,
          total: snapshot.total,
          cart: snapshot.cart,
          customer: snapshot.customer || body.customer || {},
          capturedAt: new Date().toISOString(),
        });

        setHeaders(res, 200);
        res.end(JSON.stringify({
          status: 'COMPLETED',
          orderID: orderId,
          subtotal: snapshot.subtotal,
          shipping: snapshot.shipping,
          total: snapshot.total,
          cart: snapshot.cart,
          customer: snapshot.customer,
        }));
      } catch (error) {
        console.error('PayPal capture error:', error);
        setHeaders(res, 500);
        res.end(JSON.stringify({ error: 'Erreur serveur PayPal', message: error.message }));
      }
    });
    return;
  }

  setHeaders(res, 404);
  res.end(JSON.stringify({ error: 'Route non trouvée' }));
});

server.listen(PORT, HOST, () => {
  console.log(`🐝 Serveur Ma Forêt sur ${HOST}:${PORT}`);
  console.log('   Fichier stocks :', STOCKS_FILE);
  console.log('   Routes : /api/health , /api/stocks , /admin , /api/paypal/*');
  if (process.env.PAYPAL_CLIENT_ID) {
    console.log('   PayPal :', process.env.PAYPAL_MODE || 'sandbox');
  } else {
    console.warn('   PayPal : PAYPAL_CLIENT_ID non défini');
  }
  if (CORS_ORIGIN !== '*') {
    console.log('   CORS autorisé pour :', CORS_ORIGIN);
  }
});
