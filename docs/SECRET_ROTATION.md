# Secret / Encryption Key Rotation Runbook

CampaignClipper encrypts secrets at rest (OAuth refresh tokens) with AES-256-GCM
via a **versioned envelope** (`src/lib/security/envelope.ts`). Each ciphertext
records the id of the key that produced it, so keys can be rotated without losing
access to previously-stored data.

## Ciphertext format

```
cc1:<keyId>:<base64( 12-byte IV | 16-byte GCM tag | ciphertext )>
```

- `keyId` is bound as GCM AAD — tampering with the header fails authentication.
- Legacy values (no `cc1:` prefix) were encrypted before versioning and decrypt
  with `ENCRYPTION_KEY`; they are upgraded on the next rotation pass.

## Keys are configured via env

| Var | Meaning |
| --- | --- |
| `ENCRYPTION_KEY` | base64 of the **current** 32-byte key |
| `ENCRYPTION_KEY_ID` | id of the current key (e.g. `1`, then `2` …) |
| `ENCRYPTION_KEYS_RETIRED` | JSON `{ "<id>": "<base64key>" }` of **old** keys kept for decryption |

The `KeyProvider` abstraction (`EnvKeyProvider`) can be replaced with a
KMS-backed provider without changing any call site.

## Rotation procedure (zero-downtime)

1. **Generate** a new key: `openssl rand -base64 32`. Choose the next id (e.g. `2`).
2. **Retire the old key** — add the *current* key to `ENCRYPTION_KEYS_RETIRED`:
   ```
   ENCRYPTION_KEYS_RETIRED={"1":"<old base64 key>"}
   ```
3. **Promote the new key**:
   ```
   ENCRYPTION_KEY=<new base64 key>
   ENCRYPTION_KEY_ID=2
   ```
4. **Deploy** with the new env. At this point new writes use key `2`; old data
   still decrypts via the retired key `1`.
5. **Rewrap existing data**:
   ```
   npm run rotate:secrets -- --dry   # verify counts, no writes
   npm run rotate:secrets            # re-encrypt everything under key 2
   ```
6. Once `rotate:secrets` reports `rewrapped>0, failed=0` and a subsequent
   `--dry` run reports `rewrapped=0`, **remove the retired key** from
   `ENCRYPTION_KEYS_RETIRED` and redeploy.

## Failure handling

- If `rotate:secrets` reports `failed>0`, a value could not be decrypted — the
  key that wrote it is missing from `ENCRYPTION_KEYS_RETIRED`. Restore that key
  and re-run; do **not** remove retired keys until `failed=0`.
- The command is idempotent and safe to re-run.

## Safety invariants

- Plaintext and key material are **never** logged (pino redaction + this code
  logs only counts / ids).
- Nonces (IVs) are random per encryption (`crypto.randomBytes`).
- GCM provides authenticated encryption; the key id is authenticated via AAD.

## Compromise response

If a key is suspected compromised: rotate immediately (steps 1–5), then **revoke
the affected provider OAuth tokens at the provider** and reconnect the accounts —
rotation protects data at rest but cannot un-leak a key that already decrypted
live tokens.
