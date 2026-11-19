'use strict';

// Test aid for the mock Google. The file name does not end in .test.js, so the
// runner does not execute it. It makes a throwaway service account at run time.
// No key is stored in the repository.

const crypto = require('node:crypto');

const SERVICE_ACCOUNT_EMAIL = 'meet-sa@doctor7-test.example.test';
const DELEGATED_USER = 'clinic.organizer@example.test';

// A service account with a fresh RSA key pair. `credentialJson(issuer)` is what
// GOOGLE_SERVICE_ACCOUNT_JSON would hold, with token_uri pointing at the mock.
// `privateKeyBody` is the base64 text of the private key, for leak searches.
function createTestServiceAccount() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const privateKeyId = `test-key-${crypto.randomBytes(8).toString('hex')}`;
  const privateKeyBody = privateKeyPem
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith('-----'))
    .join('');
  return {
    email: SERVICE_ACCOUNT_EMAIL,
    delegatedUser: DELEGATED_USER,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem,
    privateKeyId,
    privateKeyBody,
    credentialJson(issuer) {
      return JSON.stringify({
        type: 'service_account',
        project_id: 'doctor7-test',
        private_key_id: privateKeyId,
        private_key: privateKeyPem,
        client_email: SERVICE_ACCOUNT_EMAIL,
        token_uri: `${issuer}/token`,
      });
    },
  };
}

module.exports = { createTestServiceAccount, SERVICE_ACCOUNT_EMAIL, DELEGATED_USER };
