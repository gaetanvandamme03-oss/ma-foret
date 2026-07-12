async function getGoogleSheetsAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64;
  if (!email || !privateKeyB64) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL ou GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64 non défini');
  }
  const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  const signedJwt = `${signingInput}.${base64url(signature)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${signedJwt}`,
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Google auth failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  return data.access_token;
}
