import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url';

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

const server = http.createServer((req, res) => {
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

  setHeaders(res, 404);
  res.end(JSON.stringify({ error: 'Route non trouvée' }));
});

server.listen(PORT, HOST, () => {
  console.log(`🐝 Serveur Ma Forêt sur ${HOST}:${PORT}`);
  console.log('   Fichier stocks :', STOCKS_FILE);
  console.log('   Routes : /api/health , /api/stocks , /admin');
  if (CORS_ORIGIN !== '*') {
    console.log('   CORS autorisé pour :', CORS_ORIGIN);
  }
});
