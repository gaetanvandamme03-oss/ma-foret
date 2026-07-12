
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
const ORDER_EMAIL = process.env.ORDER_EMAIL || 'maforet01@gmail.com';
const MAIL_FROM_EMAIL = process.env.MAIL_FROM_EMAIL || ORDER_EMAIL;
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'Ma Forêt';
const PICKUP_ADDRESS = process.env.PICKUP_ADDRESS || '17 avenue du bois à Ploërmel';
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

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function isAdminAuthorized(req) {
  if (!ADMIN_PASSWORD) return false;
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Basic (.+)$/);
  if (!match) return false;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) return false;
  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);
  return user === ADMIN_USER && pass === ADMIN_PASSWORD;
}

function requireAdminAuth(req, res) {
  if (isAdminAuthorized(req)) return true;
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Ma Foret Admin"',
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
  });
  res.end('Authentification requise');
  return false;
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEuro(value) {
  return `${Number(value || 0).toFixed(2).replace('.', ',')} €`;
}

function validateCustomer(customer) {
  const data = customer || {};
  const email = String(data.email || '').trim();
  if (!String(data.nom || '').trim() || !String(data.prenom || '').trim() || !email) {
    return { error: 'Nom, prénom et email obligatoires' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Email invalide' };
  }
  return {
    customer: {
      nom: String(data.nom || '').trim(),
      prenom: String(data.prenom || '').trim(),
      email,
      message: String(data.message || '').trim(),
    },
  };
}

function orderLinesText(lines) {
  return lines
    .map((line) => `- ${line.product} / ${line.size} x${line.quantity} : ${formatEuro(line.unitPrice * line.quantity)}`)
    .join('\n');
}

function orderLinesHtml(lines) {
  return lines
    .map(
      (line) =>
        `<li>${escapeHtml(line.product)} / ${escapeHtml(line.size)} x${line.quantity} : <strong>${formatEuro(
          line.unitPrice * line.quantity
        )}</strong></li>`
    )
    .join('');
}

async function sendBrevoEmail({ to, subject, textContent, htmlContent, replyTo }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('BREVO_API_KEY non défini');
  }

  const payload = {
    sender: { email: MAIL_FROM_EMAIL, name: MAIL_FROM_NAME },
    to: Array.isArray(to) ? to : [to],
    subject,
    textContent,
    htmlContent,
  };
  if (replyTo) payload.replyTo = replyTo;

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Brevo email failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function sendOrderConfirmationEmails({ lines, total, customer, subjectPrefix, paymentLabel, includePickupAddress = false }) {
  const safeCustomer = customer || {};
  const name = `${safeCustomer.prenom || ''} ${safeCustomer.nom || ''}`.trim() || 'Client Ma Forêt';
  const email = String(safeCustomer.email || '').trim();
