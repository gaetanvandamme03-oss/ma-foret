import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const STOCKS_FILE = path.join(__dirname, 'stocks.json');

// Helper functions
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
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
}

function parseBody(req, callback) {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  req.on('end', () => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      callback(parsed);
    } catch (error) {
      callback({});
    }
  });
}

// Create server
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    setHeaders(res);
    res.end();
    return;
  }

  // GET: /api/stocks
  if (pathname === '/api/stocks' && req.method === 'GET') {
    const data = readStocks();
    setHeaders(res, 200);
    res.end(JSON.stringify(data.stocks || []));
    return;
  }

  // GET: /api/stocks/:id
  if (pathname.match(/^\/api\/stocks\/[^\/]+$/) && req.method === 'GET' && !pathname.includes('/reserve') && !pathname.includes('/release') && !pathname.includes('/update')) {
    const id = pathname.split('/')[3];
    const data = readStocks();
    const product = data.stocks.find(p => p.id === id);
    
    if (!product) {
      setHeaders(res, 404);
      res.end(JSON.stringify({ error: 'Produit non trouvé' }));
      return;
    }
    
    setHeaders(res, 200);
    res.end(JSON.stringify(product));
    return;
  }

  // POST: /api/stocks/reserve/:id
  if (pathname.match(/^\/api\/stocks\/reserve\//) && req.method === 'POST') {
    const id = pathname.split('/')[4];
    parseBody(req, (body) => {
      const quantity = body.quantity || 1;
      const data = readStocks();
      const product = data.stocks.find(p => p.id === id);
      
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
          requested: quantity
        }));
        return;
      }
      
      product.stock -= quantity;
      
      if (writeStocks(data)) {
        setHeaders(res, 200);
        res.end(JSON.stringify({
          message: 'Stock réservé avec succès',
          product: product.name,
          remainingStock: product.stock
        }));
      } else {
        setHeaders(res, 500);
        res.end(JSON.stringify({ error: 'Erreur lors de la sauvegarde' }));
      }
    });
    return;
  }

  // POST: /api/stocks/release/:id
  if (pathname.match(/^\/api\/stocks\/release\//) && req.method === 'POST') {
    const id = pathname.split('/')[4];
    parseBody(req, (body) => {
      const quantity = body.quantity || 1;
      const data = readStocks();
      const product = data.stocks.find(p => p.id === id);
      
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
          newStock: product.stock
        }));
      } else {
        setHeaders(res, 500);
        res.end(JSON.stringify({ error: 'Erreur lors de la sauvegarde' }));
      }
    });
    return;
  }

  // POST: /api/stocks/:id/update
  if (pathname.match(/^\/api\/stocks\/[^\/]+\/update$/) && req.method === 'POST') {
    const id = pathname.split('/')[3];
    parseBody(req, (body) => {
      const stock = body.stock;
      
      if (stock === undefined || stock < 0) {
        setHeaders(res, 400);
        res.end(JSON.stringify({ error: 'Quantité invalide' }));
        return;
      }
      
      const data = readStocks();
      const product = data.stocks.find(p => p.id === id);
      
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
          newStock: product.stock
        }));
      } else {
        setHeaders(res, 500);
        res.end(JSON.stringify({ error: 'Erreur lors de la sauvegarde' }));
      }
    });
    return;
  }

  // GET: /api/health
  if (pathname === '/api/health' && req.method === 'GET') {
    setHeaders(res, 200);
    res.end(JSON.stringify({ status: 'OK', message: 'Serveur Ma Forêt en ligne' }));
    return;
  }

  // 404
  setHeaders(res, 404);
  res.end(JSON.stringify({ error: 'Route non trouvée' }));
});

server.listen(PORT, () => {
  console.log(`🐝 Serveur Ma Forêt lancé sur http://localhost:${PORT}`);
  console.log('Les stocks sont sauvegardés dans:', STOCKS_FILE);
  console.log('Admin dashboard: http://localhost:${PORT}/admin.html');
  console.log('Appuyez sur Ctrl+C pour arrêter le serveur');
});
