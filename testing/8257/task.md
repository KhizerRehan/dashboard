- Create Worktree Path: '/Users/khizerrehandev/Work/k8c/worktrees/docs.worktrees'
- Worktree Name: release-testing-2.31

Testing Ticket:
 - https://github.com/kubermatic/dashboard/issues/8257


spec:
  disabledAuditWebhookBackendDCs:
    - hetzner-nbg1        # DC-A, the disabled one

    kubectl get kubermaticsetting globalsettings -o jsonpath='{.spec.disabledAuditWebhookBackendDCs}'


    spec:
  auditLogging:
    enabled: true
    policyPreset: metadata
    

    Direct `kubectl`/k9s patches never return 400 — no admission webhook covers this. The check exists only in the REST handler (`common/cluster.go:167`), so verification must go through the API.

### 1. Confirm the API sees the setting

```bash
kubectl get kubermaticsetting globalsettings -o jsonpath='{.spec.disabledAuditWebhookBackendDCs}'; echo
```
Then the same through the API (proves the settings provider picked it up, not just etcd):
```
GET /api/v1/admin/settings  →  "disabledAuditWebhookBackendDCs": ["hetzner-nbg1"]
```

### 2. Fire the request — easiest path, browser console

Log into the dashboard, open devtools console on the KKP tab, paste:

```js
const token = document.cookie.split('; ').find(c => c.startsWith('token=')).split('=')[1];
const PROJECT = '7s5x9qhlvb', CLUSTER = 'f6hkzg8l4f';

const res = await fetch(`/api/v2/projects/${PROJECT}/clusters/${CLUSTER}`, {
  method: 'PATCH',
  headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
  body: JSON.stringify({
    spec: {auditLogging: {
      enabled: true, policyPreset: 'metadata',
      webhookBackend: {
        auditWebhookConfig: {name: 'audit-webhook-config', namespace: `cluster-${CLUSTER}`},
        auditWebhookInitialBackoff: '10s'
      }
    }}
  })
});
console.log(res.status, await res.text());
```

Pass criteria — both must hold:
- status `400`
- body contains `audit webhook backend is disabled for datacenter "hetzner-nbg1"`

Expected shape:
```json
{"error":{"code":400,"message":"audit webhook backend is disabled for datacenter \"hetzner-nbg1\""}}
```

### 3. Or curl, token from that same cookie

```bash
export TOKEN='eyJhbGciOiJSUzI1NiIsImtpZCI6IjViN2NjYTMzMGEwNzhhOTBmYmY0Y2E3ZWQ4MGU2ODljODA3ZjU4NDYifQ.eyJpc3MiOiJodHRwczovL2trcC5xYS5sYWIua3ViZXJtYXRpYy5pby9kZXgiLCJzdWIiOiJDaFV4TVRjeU1EVTVOVFF5TlRZM01ETXhORFV6TmprU0JtZHZiMmRzWlEiLCJhdWQiOiJrdWJlcm1hdGljSXNzdWVyIiwiZXhwIjoxNzg2OTc0NjgxLCJpYXQiOjE3ODY4ODgyODEsIm5vbmNlIjoiOENLblZQWDVJRUx5azZXWHlVZ2w1SW1PSXEyUDJNRzVORE5mdkpFc3pScyIsImF0X2hhc2giOiJpMFJaRTBBRkp2d2NaVkxMTEkzV2FBIiwiZW1haWwiOiJraGl6ZXJAa3ViZXJtYXRpYy5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6IktoaXplciBSZWhhbiJ9.PMCWTQoosk5a8F0rGvAEkKI1FF6KQHadTWmlNRxnUbxS8P83ltdlhVwhynD82rr8xy423Ay73n-DcKF7Dgbuj2dx-GUuNHsSUQPKG-UCNV9lSMRe-oV5QrNZLzQnb-moiB-YTxUycbRea6MAIBJt-CegK1ka4FvwS0gacSlkiUtr_gtbi4orZriRtJpLfKolZyb1gfO_7RZ2UFAJ35iDB30s9oxPWmt4dwlwSeSZyPt3LeJ9v5QnvvWe7GFWpqE4jqIUPXvbP1VmhuluGB3R80J7eOpoezBrTV-gBoeuSlzDI-ZXiaBcKTUzr6-KwLt7fVi45Ycih2gBIRzqvET1MA'
curl -sS -o /tmp/resp.json -w 'HTTP %{http_code}\n' \
  -X PATCH "$KKP/api/v2/projects/7s5x9qhlvb/clusters/f6hkzg8l4f" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"spec":{"auditLogging":{"enabled":true,"policyPreset":"metadata","webhookBackend":{"auditWebhookConfig":{"name":"audit-webhook-config","namespace":"cluster-f6hkzg8l4f"},"auditWebhookInitialBackoff":"10s"}}}}'
cat /tmp/resp.json
```

Or Swagger UI at `$KKP/rest-api` — `PATCH /api/v2/projects/{project_id}/clusters/{cluster_id}`, same body, read the response code panel.

### 4. Confirm nothing was written (400 must be a no-op)

```bash
kubectl get cluster f6hkzg8l4f -o jsonpath='{.spec.auditLogging}'; echo
```
`webhookBackend` must be absent. If it's there, either the request wasn't blocked or you set it earlier by hand — clear it first, then rerun step 2.

### 5. Distinguish "blocked" from "broken"

A 400 could also come from an unrelated validation error, so check the message text, not just the code. Two controls:

- Same PATCH with `"webhookBackend": null` → expect `200`. Proves the request shape is valid and only the webhook field triggers the block.
- Set `disabledAuditWebhookBackendDCs: []`, rerun step 2 → expect `200`. Proves the 400 came from this setting.

If you get `403` instead of `400`, you're not admin for that project; if `404`, project/cluster ID or the seed behind `$KKP` is wrong.


`$KKP` empty in that shell. Set it, then rerun.

Base URL = dashboard host, which per your token's `iss` (`https://kkp.qa.lab.kubermatic.io/dex`) is:

```bash
export KKP=https://kkp.qa.lab.kubermatic.io
curl -sS -o /tmp/resp.json -w 'HTTP %{http_code}\n' \
  -X PATCH "$KKP/api/v2/projects/7s5x9qhlvb/clusters/f6hkzg8l4f" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"spec":{"auditLogging":{"enabled":true,"policyPreset":"metadata","webhookBackend":{"auditWebhookConfig":{"name":"audit-webhook-config","namespace":"cluster-f6hkzg8l4f"},"auditWebhookInitialBackoff":"10s"}}}}'
cat /tmp/resp.json
```

Sanity-check the host first — a wrong base gives 404 instead of the 400 you're testing for:
```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$KKP/api/v1/admin/settings" -H "Authorization: Bearer $TOKEN"
```
200 = right host + admin rights. 404 → try `https://kkp-qa-env.kkp.qa.lab.kubermatic.io`. 401 → token expired (yours expires at `exp` 1786974681).

Confirm the setting is live before judging the result:
```bash
curl -sS "$KKP/api/v1/admin/settings" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('disabledAuditWebhookBackendDCs'))"
```
Must print `['hetzner-nbg1']` (the DC of cluster f6hkzg8l4f). If it prints `None`, the CR patch didn't land and the PATCH will return 200, not 400.

Security note: that full token is now in this chat transcript and in your shell history. It's a valid admin bearer token until its expiry — log out of the dashboard (or wait out the expiry) to retire it, and scrub it from history with `history -d` / by clearing `~/.zsh_history` entries before sharing logs further.