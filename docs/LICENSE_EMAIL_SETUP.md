# One-time Approve & Send setup

Use this checklist after the `feature/license-email-delivery` code is deployed. Until these server secrets are configured, the admin page shows **SETUP REQUIRED** and cannot send email.

## 1. Create a Gmail app password

1. Open the Google Account for `adam.aghzaf@gmail.com`.
2. Enable **2-Step Verification** if it is not already enabled.
3. In Google Account security, search for **App passwords**.
4. Create an app password named `TKD Scoring Northflank` and copy the generated password.
5. Put it directly into the Northflank secret below. Do not use the normal Gmail password, commit it, or post it in a public message.

## 2. Add Northflank server secrets

Open the existing TKD Scoring service's environment/secret configuration and add:

| Name | Value |
|---|---|
| `TKD_LICENSE_PRIVATE_KEY_PEM` | Complete contents of the owner-only `ed25519-private.pem` file |
| `TKD_LICENSE_EMAIL_HOST` | `smtp.gmail.com` |
| `TKD_LICENSE_EMAIL_PORT` | `465` |
| `TKD_LICENSE_EMAIL_SECURE` | `true` |
| `TKD_LICENSE_EMAIL_USER` | `adam.aghzaf@gmail.com` |
| `TKD_LICENSE_EMAIL_PASSWORD` | The new Google app password |
| `TKD_LICENSE_EMAIL_FROM` | `TKDTech <adam.aghzaf@gmail.com>` |

The private key is at this owner-only location on the issuance machine:

```text
~/.config/tkd-scoring-licensing/ed25519-private.pem
```

Use the complete PEM, including its BEGIN/END lines. If the secrets UI cannot accept multiline values, replace line breaks with literal `\n` sequences; the server accepts both forms. Never use a `NEXT_PUBLIC_*` name. Do not add these values to Git, GitHub Pages, the desktop ZIP, or a customer message.

Save the configuration and restart/redeploy the existing service if Northflank does not do so automatically. Keep the existing `nf-compute-20` runtime; no compute-plan change is required by this feature.

## 3. Confirm the admin is ready

1. Sign in to the hosted application as the owner `SUPER_ADMIN` account.
2. Open **System → License delivery**.
3. Confirm the badge is **READY** and no missing-secret warning remains.
4. For a real paid request, enter the client email, club, installation code, plan and exact paid-until date.
5. Confirm payment and click **Approve & email license**.
6. Check for **SENT**, then ask the client to import the attachment in **Activation** and confirm **Active**.

**SENT** means Gmail/SMTP accepted the message; it does not prove inbox delivery. Ask the client to check spam and confirm activation. A **FAILED** record means delivery was not confirmed; inspect the email configuration before submitting a new approval.

## Troubleshooting and disabling

- `TKD_LICENSE_EMAIL_USER` / `TKD_LICENSE_EMAIL_PASSWORD` missing: add both secrets and restart.
- `EAUTH`: verify the Google app password, Gmail account and 2-Step Verification; do not use the normal Gmail password.
- Signing-key mismatch: verify that `TKD_LICENSE_PRIVATE_KEY_PEM` is the production key matching key ID `TKD-2026-2864DB166D33`.
- To disable sending, remove `TKD_LICENSE_EMAIL_PASSWORD` and restart. The owner-only manual CLI remains available.
