# Paid desktop licensing

TKD Scoring separates **download** from **activation**. The Windows installer may remain publicly downloadable, but the portable desktop requires a valid, signed license before tournament or scoring mutations are accepted. Hosted development and cloud deployments do not enable this desktop-only requirement.

The current flow is intentionally compatible with the static product website: no card details, automatic form transmission, payment gateway, or online activation service is required. Payment is confirmed by TKDTech, then a license file is issued manually through WhatsApp or email.

## Customer activation

1. Extract and run the portable desktop as documented in [DESKTOP.md](DESKTOP.md).
2. The application opens **Activation** when no valid license is installed.
3. Copy the displayed installation code, for example `TKD-1234-5678-9ABC-DEF0-1234`.
4. Choose a subscription and send the code through the WhatsApp/email buttons. The code is an identifier, not a password.
5. After payment confirmation, TKDTech issues a `.tkdlicense` file for that code, plan, and paid period.
6. Import the file or paste its complete contents. The local server verifies the signature, key identifier, payload, dates, and device binding before saving it.
7. Sign in and use the existing local system. Scoring, judges, displays, SQLite, and WebSockets continue to work without Internet on the venue LAN.

Contact links in the application use the approved public contacts: WhatsApp `+212 614192699` and `adam.aghzaf@gmail.com`.

## Issue a license after confirming payment

The issuer is an owner-only command. It needs the private key but the desktop application and test fixtures do not contain it.

```bash
export TKD_LICENSE_PRIVATE_KEY="$HOME/.config/tkd-scoring-licensing/ed25519-private.pem"

npm run license:issue -- \
  --club "Example Taekwondo Club" \
  --plan CLUB \
  --device TKD-1234-5678-9ABC-DEF0-1234 \
  --days 365 \
  --output "$HOME/.config/tkd-scoring-licensing/issued/example-club.tkdlicense"
```

Supported plan identifiers:

| Plan | Identifier | Typical validity input |
|---|---|---|
| Founding Club | `FOUNDING_CLUB` | Paid monthly/annual period |
| Club | `CLUB` | Paid monthly/annual period |
| Tournament Support | `TOURNAMENT_SUPPORT` | Paid event period |

Use `--days N` for a duration starting now, or `--expires YYYY-MM-DD` for the end of a specific UTC day. The command:

- validates every field and the installation code;
- refuses to overwrite an existing file unless `--force` is explicitly supplied;
- derives the public key from the private key and refuses a mismatch with the embedded desktop key;
- signs the exact payload with Ed25519;
- verifies the newly issued token again before writing it;
- writes the customer file with owner-only permissions and never prints the private key or token.

Send only the resulting `.tkdlicense` file to the customer. Keep an issuance record containing license ID, club, device code, plan, payment confirmation, issue date, and expiry in the business's private records.

## Key custody

The production key pair was generated outside Git. On the owner's build machine its default location is:

```text
~/.config/tkd-scoring-licensing/ed25519-private.pem
~/.config/tkd-scoring-licensing/ed25519-public.pem
~/.config/tkd-scoring-licensing/key-metadata.json
```

Production public-key identity:

```text
Key ID:      TKD-2026-2864DB166D33
Fingerprint: 2864db166d3342b1514d1e226b3c3014a4d6fe67d1bb16b2e4d195978643bc44
Algorithm:   Ed25519
```

**Back up the private key offline and restrict it to the business owner.** Never commit it, attach it to a customer message, place it in the portable ZIP, expose it through Supabase/browser code, or store it in the public static website. `.gitignore` excludes private PEM files and customer license files, and packaging independently refuses them.

Losing the private key prevents issuing additional licenses for the current public key but does not invalidate already issued files. A compromised key requires a new key pair, a desktop update with the new public key, and replacement licenses.

## Device binding and local files

The installation code is a truncated SHA-256-derived identifier; it does not reveal the underlying machine identifier. On Windows, the normal binding combines:

- the Windows MachineGuid read without administrator privileges; and
- a random persistent installation UUID.

If locked-down Windows policy prevents reading MachineGuid, the status reports `INSTALLATION_ONLY` binding. That still prevents reusing only the license file, but is weaker than machine-plus-installation binding.

Desktop locations:

| Content | Windows location |
|---|---|
| Installation identity | `%APPDATA%\TKD Scoring\license\installation.json` |
| Signed license | `%APPDATA%\TKD Scoring\license\desktop.tkdlicense` |
| Tournament database | `%APPDATA%\TKD Scoring\data\tkd-scoring.db` |

The license is outside the portable folder, so normal application replacement does not intentionally remove it. Do not delete the license folder during an update. A new computer or intentionally reset installation requires a device-transfer/reissue decision by TKDTech. Keep tournament backups and license files separate; do not send the whole application profile to another club.

## Enforcement and expiry behavior

The Next.js activation screen is not the security boundary. Express also checks licensing on tournament creation, status/rules changes, clubs/categories/athletes, draw generation/publication, match commands and assignment, pairing creation, judge proposals, and referee commands.

| State | New tournaments/work | Existing in-progress tournament | Records, reports, and backup |
|---|---|---|---|
| No desktop requirement (development/cloud) | Allowed normally | Allowed normally | Allowed normally |
| Active signed license | Allowed | Allowed | Allowed |
| No/invalid/wrong-device/future license | Blocked | Blocked | Preserved; authenticated read/export remains available |
| Expired signed license | Blocked | May be finished | Preserved; authenticated read/export and sync backup remain available |

Authentication, logout, activation, pairing exchange, heartbeat, and session revocation remain explicit exceptions; they do not authorize tournament or scoring work. Public displays remain read-only. A renewal warning appears during the final 14 days.

There is no mid-match online revocation or payment check. An already issued offline license cannot be remotely revoked before its expiry if the computer never reconnects. Device transfer and any online renewal/revocation automation can later be added behind a server-only licensing service.

## Renewal, replacement, and expiry

- **Renew on the same computer:** issue a new file for the same installation code and import it from Activation.
- **Replace the computer:** preserve tournament backups, then request a newly bound license. Do not copy a license and assume it will activate elsewhere.
- **Expiry during an event:** finish the tournament already marked `IN_PROGRESS`, export its records, and renew before starting new work.
- **Clock check:** confirm the PC date/time if a license reports future/expired unexpectedly. Offline desktop licensing cannot provide perfect protection against deliberate clock or program tampering.

This is commercial access control against ordinary unpaid use and file sharing, not a claim that native desktop software is uncrackable. A determined attacker modifying their own local program requires a separate technical/legal strategy.

## Release rollout

The feature branch increments the portable package to **1.1.0**. Building and testing a branch does not publish it. Before public rollout:

1. run the full verification suite and physical-Windows activation/LAN checks;
2. build from a clean commit and verify that no private key/customer license is in the ZIP;
3. publish `desktop-v1.1.0` and update the download page through the normal release process;
4. decide explicitly whether to retire the older unlicensed public assets—publishing a new version cannot deactivate copies already downloaded.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run validate:migrations
npm run desktop:build
npm run build
npm run test:e2e

# Owner-only real signature + production topology smoke:
export TKD_LICENSE_PRIVATE_KEY="$HOME/.config/tkd-scoring-licensing/ed25519-private.pem"
npm run test:desktop:runtime
```

Unit/integration tests generate temporary independent Ed25519 keys and do not need the production private key. Browser activation tests mock API responses. The owner-only runtime smoke uses the real issuer to prove unlicensed API rejection, invalid/wrong-device rejection, valid activation, exports, restart persistence, and authenticated writes in the production Express/Next.js/SQLite topology.
