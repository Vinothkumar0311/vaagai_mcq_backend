const https = require('https');
const jwt = require('jsonwebtoken');

let cachedCerts = null;
let certsExpiry = 0;

/**
 * Fetches Google's public x509 certificates used to sign Firebase ID tokens.
 * The certificates are cached in memory according to the Cache-Control max-age header.
 * 
 * @returns {Promise<Record<string, string>>} A map of key ID to certificate string.
 */
const fetchCerts = () => {
  return new Promise((resolve, reject) => {
    if (cachedCerts && Date.now() < certsExpiry) {
      return resolve(cachedCerts);
    }

    https.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken%40system.gserviceaccount.com', (res) => {
      let data = '';
      
      // Extract cache max-age to avoid hitting Google servers on every request
      const cacheControl = res.headers['cache-control'];
      let maxAge = 3600; // default to 1 hour fallback
      if (cacheControl) {
        const match = cacheControl.match(/max-age=(\d+)/);
        if (match) {
          maxAge = parseInt(match[1], 10);
        }
      }

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const certs = JSON.parse(data);
          cachedCerts = certs;
          certsExpiry = Date.now() + maxAge * 1000;
          resolve(certs);
        } catch (e) {
          reject(new Error('Failed to parse Google public certificates: ' + e.message));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
};

/**
 * Verifies the signature and claims of a Firebase ID token.
 * Matches specifications at https://firebase.google.com/docs/auth/admin/verify-id-tokens
 * 
 * @param {string} token - The Firebase ID token to verify
 * @param {string} projectId - The expected Firebase Project ID (aud claim)
 * @returns {Promise<object>} The decoded and verified token payload
 */
const verifyFirebaseToken = async (token, projectId) => {
  if (!token) {
    throw new Error('Token is required');
  }
  if (!projectId) {
    throw new Error('Firebase Project ID is required for verification');
  }

  // 1. Decode token to find kid (Key ID) in the header
  const decodedToken = jwt.decode(token, { complete: true });
  if (!decodedToken || !decodedToken.header || !decodedToken.header.kid) {
    throw new Error('Invalid Firebase token format or missing key ID (kid)');
  }

  const kid = decodedToken.header.kid;

  // 2. Fetch public certificates
  const certs = await fetchCerts();
  const cert = certs[kid];
  if (!cert) {
    throw new Error('Public key not found for kid: ' + kid);
  }

  // 3. Verify signature, audience (aud), issuer (iss) and expiration (exp)
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      cert,
      {
        algorithms: ['RS256'],
        audience: projectId,
        issuer: `https://securetoken.google.com/${projectId}`
      },
      (err, decoded) => {
        if (err) {
          return reject(new Error('Firebase token verification failed: ' + err.message));
        }
        resolve(decoded);
      }
    );
  });
};

module.exports = {
  verifyFirebaseToken
};
