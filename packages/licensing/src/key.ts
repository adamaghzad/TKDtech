import { createHash, createPublicKey } from 'node:crypto';

export interface LicenseVerificationKey {
  keyId: string;
  publicKeyPem: string;
}

/**
 * Public Ed25519 verification key for issued TKD Scoring desktop licenses.
 * The matching PKCS#8 private key is deliberately kept outside source control.
 */
export const productionLicenseKey: LicenseVerificationKey = {
  keyId: 'TKD-2026-2864DB166D33',
  publicKeyPem: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAxZOU2/jVoKFQ4HMjiKRrpGcVBK8q7cVTO0i6b4jniRM=
-----END PUBLIC KEY-----`,
};

export function licenseKeyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

export function assertProductionPrivateKey(publicKeyPem: string): void {
  const fingerprint = licenseKeyFingerprint(publicKeyPem);
  if (fingerprint !== '2864db166d3342b1514d1e226b3c3014a4d6fe67d1bb16b2e4d195978643bc44') {
    throw new Error('The private key does not match the desktop public verification key. Refusing to issue an unusable license.');
  }
}
