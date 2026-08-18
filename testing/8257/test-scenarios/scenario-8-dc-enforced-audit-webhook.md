# Scenario 8 — Datacenter-enforced audit webhook backend still applies

Release testing for KKP 2.31 · ticket [dashboard#8257](https://github.com/kubermatic/dashboard/issues/8257) · feature PR [#8161](https://github.com/kubermatic/dashboard/pull/8161)

## What is being tested

PR #8161 added the admin setting `disabledAuditWebhookBackendDCs`. For a datacenter on that list, the dashboard hides the "Audit Webhook Backend" option in the cluster wizard and the edit-cluster dialog, and the API rejects any request that adds or changes a *cluster-level* webhook backend for that datacenter.

A datacenter can independently *enforce* a webhook backend through `spec.enforcedAuditWebhookSettings`. The disable list is a user-facing opt-in block only — it must never disable admin enforcement.

**Scenario 8 asserts:** when a datacenter is both in `disabledAuditWebhookBackendDCs` **and** carries `enforcedAuditWebhookSettings`, the enforced backend still lands on every cluster in that datacenter, while the UI checkbox stays hidden and user-supplied backends stay rejected.

## Why the two mechanisms don't collide

| Concern | Location |
| --- | --- |
| Disable-list validation (blocks *user-supplied* backend only) | `modules/api/pkg/handler/common/cluster.go:167` `validateAuditWebhookBackendAllowed()` |
| …called on cluster create | `modules/api/pkg/handler/common/cluster.go:214` |
| …called on cluster patch | `modules/api/pkg/handler/common/cluster.go:618` |
| Enforcement on create (defaulting webhook) | `kubermatic/pkg/defaulting/cluster.go:112-125` |
| Enforcement continuously reconciled | `kubermatic/pkg/controller/seed-controller-manager/audit-logging-enforcement-controller/controller.go:367-385` |
| UI hides checkbox — wizard | `modules/web/src/app/wizard/step/cluster/component.ts:1113` `_handleAuditWebhookBackendVisibility()` |
| UI hides checkbox — edit dialog | `modules/web/src/app/cluster/details/cluster/edit-cluster/component.ts:771` |
| UI omits backend from payload when enforced | wizard `component.ts:1418`; edit `component.ts:582` |
| Enforced secret copied into user-cluster namespace | `kubermatic/pkg/controller/seed-controller-manager/kubernetes/resources.go:1601-1632` `ensureAuditWebhook()` |

Enforcement wins because the UI never sends `webhookBackend` when the datacenter enforces it. `validateAuditWebhookBackendAllowed()` then sees `newWebhookBackend == nil` and returns early (`cluster.go:176`), and defaulting injects the datacenter value *after* validation.

Note that enforcement happens **twice**, at two layers:

| Layer | Where | Runs when |
| --- | --- | --- |
| Dashboard API, in-process | patch: `common/cluster.go:675` `defaulting.DefaultClusterSpec(..., seed, ...)`; create: `common/cluster.go:264` `cluster.Spec(...)` | on every create/patch through the dashboard API — **after** the disable-list check at `:618` / `:214` |
| KKP defaulting webhook | `kubermatic/pkg/defaulting/cluster.go:112` | on every write to a `Cluster` object, whatever the client |
| KKP enforcement controller | `audit-logging-enforcement-controller/controller.go:367` | continuously, even with no write at all |

The dashboard-side layer is why this scenario is provable in a Go handler test with no live cluster (Method 4 below).

## Critical prerequisite — do not skip

Both enforcement paths are gated on `datacenter.Spec.EnforceAuditLogging`:

```go
// kubermatic/pkg/defaulting/cluster.go:112
if datacenter.Spec.EnforceAuditLogging {
    ...
    if datacenter.Spec.EnforcedAuditWebhookSettings != nil {
        spec.AuditLogging.WebhookBackend = datacenter.Spec.EnforcedAuditWebhookSettings
    }
}
```

Setting `enforcedAuditWebhookSettings` **without** `enforceAuditLogging: true` is a no-op. The test would then false-pass on the "checkbox hidden" half while nothing was ever enforced.

The dashboard datacenter dialog already couples the two controls (`datacenter-data-dialog/component.ts:164-171` — unchecking "Enforce Audit Logging" auto-unchecks "Enforce Audit Webhook Backend"), so the UI cannot produce the broken combination. A raw kubectl or API setup can.

## Target environments

Two environments are available. **QA is the release-testing target**; dev is the fallback. The procedure below is written for `hetzner-fsn1` on either, but the two differ in what setup is needed.

### QA — `kkp.qa.lab.kubermatic.io` (verified 2026-08-18)

| Item | Value |
| --- | --- |
| kubeconfig | `/Users/khizerrehandev/.kube/qa.kubeconfig`, context `bnl29dkkz2` |
| Seed | `kkp-qa-env` in ns `kubermatic`, KKP `v2.31.0-rc.1` |
| Dashboard / API base | `https://kkp.qa.lab.kubermatic.io/api` |
| `disabledAuditWebhookBackendDCs` | `["hetzner-nbg1", "kubevirt-hamburg", "vsphere-hamburg"]` — **`hetzner-fsn1` must be added** |
| Your cluster | `plm7k6bfdm` (determined-joliot), project `7s5x9qhlvb` (KR-QA-2.31), dc `hetzner-fsn1`, ns `cluster-plm7k6bfdm` |
| Its `spec.auditLogging` | already has a **cluster-level** backend: `audit-webhook-test` / `kubermatic` / `10s` |
| Not yours — leave alone | `rsj9mkxl4l` (upbeat-hopper), owner `ahmad.hamza@kubermatic.com`, dc `gcp-westeurope` |
| Datacenters with `enforcedAuditWebhookSettings` | none |
| `kubermatic/audit-webhook-test` secret | **missing** |

Use `KUBECONFIG=/Users/khizerrehandev/.kube/qa.kubeconfig` for every `kubectl` command below.

**Three QA differences that change the procedure:**

1. **`hetzner-fsn1` is not on the disable list.** Step 2 sets enforcement on the datacenter, but Scenario 8 only means anything when the datacenter is *also* disabled — add it first (Admin Panel → Settings → Defaults, or `PATCH /api/v1/admin/settings` re-sending the full list plus `hetzner-fsn1`).
2. **The cluster already carries a cluster-level webhook backend** pointing at the same `audit-webhook-test` secret this scenario creates. That is convenient — Step 1's secret unblocks it — but it means Step 3's assertion cannot distinguish "enforced by the datacenter" from "was already set on the cluster". To keep the assertion honest, either change the enforced secret name in Step 2 (e.g. `audit-webhook-enforced`) and assert *that* name appears, or clear the cluster's own backend first and let enforcement re-add it.
3. **A second, clean cluster is worth creating** in `hetzner-fsn1` after enforcement is on. Its spec should come back with the enforced backend it never asked for — that is the create-path half (`defaulting`), which an existing cluster cannot demonstrate.

> **Blocker — fix before testing.** `plm7k6bfdm` is stuck in `Creating` with no control-plane pods. The seed controller loops on:
>
> ```
> failed to reconcile cluster: failed to ensure Secret cluster-plm7k6bfdm/audit-webhook-test: failed to generate object: Secret "audit-webhook-test" not found
> ```
>
> Step 1 below creates exactly that secret in the `kubermatic` namespace, which should clear it. Run Step 1 first, then wait for the cluster to leave `Creating` before asserting anything.
>
> Worth raising separately: nothing validates that the referenced secret exists, so a cluster-level webhook backend pointing at a missing secret bricks cluster creation with no API-level error.

### Dev — `dev.kubermatic.io` (verified 2026-08-17)

| Item | Value |
| --- | --- |
| kubectl context | `fth4x68gcq` |
| Seed | `shared` in ns `kubermatic`, KKP `v2.31.0-rc.1-1-gb5d7e53f6` |
| Dashboard / API base | `https://dev.kubermatic.io/api` |
| `disabledAuditWebhookBackendDCs` | `["hetzner-fsn1"]` — already set, no change needed |
| Clusters in `hetzner-fsn1`, project `rzbqvk6qwc` | `nlsc9mlqhf` (kr-os-dev), `ypxm6hf2rf` (zealous-minsky) |
| Their `spec.auditLogging` | `{}` — clean, so Step 3's assertion is unambiguous |
| Datacenters with `enforcedAuditWebhookSettings` | none — setup adds it |
| Restore kubeconfig | `kgdev` (alias in `~/.k8c/shell/functions/k8c/k8c_vault.sh:31`) |

Dev is the cleaner environment for this scenario: the disable list is already right and the clusters have no pre-existing backend to confuse the assertion.

Reusing `hetzner-fsn1` is safe on both — dev hosts only the two clusters above, QA's other cluster is on `gcp-westeurope`. Re-check before Step 2 in case someone provisioned in the meantime:

```bash
kubectl get clusters.kubermatic.k8c.io \
  -o custom-columns=NAME:.metadata.name,DC:.spec.cloud.dc,OWNER:.status.userEmail
```

The two datacenter entries differ — dev's `hetzner-fsn1` carries a `kubelb` block, QA's does not — but Step 2's merge patch touches only the two enforcement keys, so the same payload works on both. Read the live entry first anyway:

```bash
kubectl -n kubermatic get seed $SEED -o jsonpath='{.spec.datacenters.hetzner-fsn1}' | jq
```

---

## Step 0 — capture rollback state

Set `SEED` to `kkp-qa-env` (QA) or `shared` (dev), and export `KUBECONFIG=/Users/khizerrehandev/.kube/qa.kubeconfig` for QA.

```bash
export SEED=kkp-qa-env    # or: shared
kubectl -n kubermatic get seed $SEED -o json > /tmp/seed-$SEED.backup.json
kubectl get kubermaticsettings globalsettings -o json > /tmp/globalsettings-$SEED.backup.json
```

## Step 1 — create the webhook config secret on the seed

The apiserver mounts this secret at `/etc/kubernetes/audit/webhook` and passes `--audit-webhook-config-file /etc/kubernetes/audit/webhook/webhook.yaml` (`kubermatic/pkg/resources/apiserver/deployment.go:402`, `:617`, `:855`), so the **key must be `webhook.yaml`**. Content is a kubeconfig-shaped file. A non-resolving host is fine — Scenario 8 asserts wiring, not delivery.

```bash
cat > /tmp/webhook.yaml <<'EOF'
apiVersion: v1
kind: Config
clusters:
  - name: audit-sink
    cluster:
      server: http://audit-sink.audit-test.svc.cluster.local:8080/audit
contexts:
  - name: audit-sink
    context:
      cluster: audit-sink
current-context: audit-sink
EOF

kubectl -n kubermatic create secret generic audit-webhook-test \
  --from-file=webhook.yaml=/tmp/webhook.yaml
```

## Step 2 — enforce on `hetzner-fsn1` (already in the disable list)

On QA, add `hetzner-fsn1` to the disable list first — enforcement alone is not Scenario 8:

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' \
  -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "https://kkp.qa.lab.kubermatic.io/api/v1/admin/settings" \
  -d '{"disabledAuditWebhookBackendDCs": ["hetzner-nbg1", "kubevirt-hamburg", "vsphere-hamburg", "hetzner-fsn1"]}'
```

`--type=merge` is a JSON merge patch (RFC 7386): objects merge recursively, so sibling datacenters **and** untouched fields inside `hetzner-fsn1` — the `hetzner` provider block, `kubelb` on dev — survive. Only the two keys below are added. Patch-type details and the revert form: [seed cheatsheet](../notes/kkp-seed-kubectl-cheatsheet.md).

Same patch on both environments, only `$SEED` differs:

```bash
kubectl -n kubermatic patch seed $SEED --type=merge -p '{
  "spec": {
    "datacenters": {
      "hetzner-fsn1": {
        "spec": {
          "enforceAuditLogging": true,
          "enforcedAuditWebhookSettings": {
            "auditWebhookConfig": {"name": "audit-webhook-enforced", "namespace": "kubermatic"},
            "auditWebhookInitialBackoff": "10s"
          }
        }
      }
    }
  }
}'
```

The secret name `audit-webhook-enforced` is deliberately **not** `audit-webhook-test`: on QA the cluster already has its own backend pointing at `audit-webhook-test`, so reusing that name would make Step 3 unable to tell enforcement apart from what was already there. Create both secrets in Step 1.

Verify the entry kept its provider block and only gained the two keys:

```bash
kubectl -n kubermatic get seed $SEED \
  -o jsonpath='{.spec.datacenters.hetzner-fsn1}' | jq
```

## Step 3 — assert enforcement reached the existing clusters

The enforcement controller reconciles continuously, so no cluster edit is needed. Within a reconcile cycle:

```bash
export CLUSTER=plm7k6bfdm          # dev: nlsc9mlqhf
export CLUSTER_NS=cluster-$CLUSTER

kubectl get cluster $CLUSTER -o jsonpath='{.spec.auditLogging}' | python3 -m json.tool
```

Expected — `enabled: true` from enforcement, `webhookBackend` from the datacenter:

```json
{
  "enabled": true,
  "webhookBackend": {
    "auditWebhookConfig": {"name": "audit-webhook-test", "namespace": "kubermatic"},
    "auditWebhookInitialBackoff": "10s"
  }
}
```

**This is the core pass condition**: `hetzner-fsn1` is in `disabledAuditWebhookBackendDCs`, and the webhook backend is present anyway.

Supporting assertions:

```bash
# Event emitted by the enforcement controller
kubectl get events -A --field-selector reason=AuditLoggingEnforced | grep $CLUSTER

# Secret copied into the user-cluster namespace
kubectl -n $CLUSTER_NS get secret audit-webhook-test

# apiserver actually got the flags
kubectl -n $CLUSTER_NS get deploy apiserver \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="apiserver")].command}' \
  | tr ',' '\n' | grep -A1 audit-webhook
```

Expect `--audit-webhook-config-file /etc/kubernetes/audit/webhook/webhook.yaml` and `--audit-webhook-initial-backoff 10s`.

On dev, repeat the whole step for `ypxm6hf2rf` / `cluster-ypxm6hf2rf` to confirm enforcement is datacenter-wide, not per-cluster. QA has only one cluster in `hetzner-fsn1`, so create a second one there (any name, no audit settings) — its spec should come back carrying the enforced backend it never requested, which also exercises the create-path defaulting.

## Step 4 — API assertions (curl)

Get a bearer token: log into the dashboard for the environment you picked, then DevTools → Application → Cookies → copy the `token` value. It is HttpOnly, so it is not readable from JS (`modules/web/src/app/core/services/auth/service.ts:73-75`).

**QA:**

```bash
export KKP=https://kkp.qa.lab.kubermatic.io/api
export TOKEN='<token cookie value>'
export PROJECT=7s5x9qhlvb
export CLUSTER=plm7k6bfdm
export SEED=kkp-qa-env
```

**Dev:**

```bash
export KKP=https://dev.kubermatic.io/api
export TOKEN='<token cookie value>'
export PROJECT=rzbqvk6qwc
export CLUSTER=nlsc9mlqhf
export SEED=shared
```

### 4a — admin setting still lists the datacenter

`GET /api/v1/admin/settings` (`modules/api/pkg/handler/routes_v1_admin.go:139`):

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$KKP/v1/admin/settings" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["disabledAuditWebhookBackendDCs"])'
```

Expect `['hetzner-fsn1']`.

### 4b — datacenter exposes the enforced settings to the UI

`GET /api/v1/seed/{seed}/dc/{dc}` (`routes_v1.go:644`), surfaced by `ConvertInternalDCToExternalSpec` (`handler/v1/dc/datacenter.go:643`):

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$KKP/v1/seed/$SEED/dc/hetzner-fsn1" \
  | python3 -c 'import json,sys; s=json.load(sys.stdin)["spec"]; print(s.get("enforceAuditLogging")); print(json.dumps(s.get("enforcedAuditWebhookSettings"), indent=2))'
```

Expect `True` plus the `audit-webhook-test` block. This response is what populates `enforcedAuditWebhookSettings` in the wizard (`wizard/step/cluster/component.ts:337`) and the edit dialog (`edit-cluster/component.ts:328`).

### 4c — cluster read-back shows the enforced backend

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" \
  | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["spec"]["auditLogging"], indent=2))'
```

Expect the same `webhookBackend` as Step 3.

### 4d — enforcement does not weaken the disable rule

A *user-supplied, different* backend must still be rejected. Exercises `cluster.go:618` — `oldWebhookBackend != newWebhookBackend` and the datacenter is on the disable list.

```bash
curl -s -o /tmp/patch-resp.json -w '%{http_code}\n' \
  -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" \
  -d '{
    "spec": {
      "auditLogging": {
        "enabled": true,
        "webhookBackend": {
          "auditWebhookConfig": {"name": "rogue-secret", "namespace": "kubermatic"},
          "auditWebhookInitialBackoff": "30s"
        }
      }
    }
  }'
cat /tmp/patch-resp.json
```

Expect `400` and a message matching `audit webhook backend is disabled for datacenter "hetzner-fsn1"` (`cluster.go:183`).

The same payload against `POST /api/v2/projects/$PROJECT/clusters` (create path, `cluster.go:214`) must also return `400` — covered by Scenario 6, listed here only for the create/patch symmetry.

### 4e — a benign patch still succeeds, enforcement re-applies

This is the exact shape the UI sends when the datacenter enforces (`edit-cluster/component.ts:582` sets `webhookBackend: null`):

```bash
curl -s -o /tmp/patch-ok.json -w '%{http_code}\n' \
  -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" \
  -d '{"spec": {"auditLogging": {"enabled": true, "policyPreset": "", "webhookBackend": null}}}'
```

Expect `200`. Then re-run Step 3: the enforcement controller must put `webhookBackend` back. That proves an explicit `null` in a patch cannot strip an enforced backend.

## Step 5 — UI assertions

1. **Wizard** — new cluster → provider Hetzner → datacenter *Falkenstein 1 DC 14 / hetzner-fsn1*: the "Audit Webhook Backend" checkbox is **hidden**. "Audit Logging" shows as enforced (disabled control) with the admin-note tooltip (`wizard/step/cluster/template.html:490`).
2. **Edit cluster** — cluster `kr-os-dev` → Edit Cluster: checkbox hidden, no webhook fields offered, dialog saves without error.
3. **Admin Panel → Dynamic Datacenters → `hetzner-fsn1`**: "Enforce Audit Webhook Backend" is checked, showing secret `audit-webhook-test`, namespace `kubermatic`, backoff `10s`. Unchecking "Enforce Audit Logging" must auto-uncheck the webhook toggle (`datacenter-data-dialog/component.ts:164-171`) — do not save.
4. **Admin Panel → Settings → Defaults**: `hetzner-fsn1` still selected under the disabled-datacenter setting.

## Step 6 — teardown

In a JSON merge patch, `null` means "delete this key":

```bash
kubectl -n kubermatic patch seed $SEED --type=merge -p '{
  "spec": {
    "datacenters": {
      "hetzner-fsn1": {
        "spec": {
          "enforceAuditLogging": null,
          "enforcedAuditWebhookSettings": null
        }
      }
    }
  }
}'

kubectl -n kubermatic delete secret audit-webhook-enforced
```

On QA, also remove `hetzner-fsn1` from the disable list again (restore the original three entries), and **do not delete `kubermatic/audit-webhook-test`** — `plm7k6bfdm`'s own cluster-level backend references it, and deleting it puts the cluster back into the broken reconcile loop.

Confirm the clusters settle back and the copied secret is garbage-collected:

```bash
kubectl get cluster $CLUSTER -o jsonpath='{.spec.auditLogging}'
kubectl -n $CLUSTER_NS get secret audit-webhook-test
```

`spec.auditLogging.webhookBackend` should disappear. The enforcement controller does **not** set `enabled: false` again once enforcement is off — it returns early without touching the cluster (`controller.go:367`) — so `enabled: true` may persist. Clear it via the edit-cluster dialog to return both clusters to their original `auditLogging: {}`.

`globalsettings` is not modified by this procedure; restore from `/tmp/globalsettings.backup.json` only if Step 4 changed it unexpectedly.

## Pass / fail summary

| # | Assertion | Pass condition |
| --- | --- | --- |
| 1 | Enforced backend reaches cluster spec despite the disable list | Step 3 — `webhookBackend` present on both clusters |
| 2 | Secret propagated to the user-cluster namespace | the enforced secret exists in `$CLUSTER_NS` |
| 3 | apiserver wired up | `--audit-webhook-config-file` + `--audit-webhook-initial-backoff 10s` in the apiserver command |
| 4 | API exposes enforcement to the UI | 4b returns `enforceAuditLogging: true` + the enforced block |
| 5 | UI hides the option | Checkbox absent in wizard and edit dialog for `hetzner-fsn1` |
| 6 | User-supplied backend still blocked | 4d returns `400` with the disabled-datacenter message |
| 7 | Benign patch unaffected, enforcement re-applied | 4e returns `200`, Step 3 re-passes afterwards |

## Risks

- Never `kubectl replace` a Seed — it drops every field absent from the submitted object. Merge patch is safe; see the [cheatsheet](../notes/kkp-seed-kubectl-cheatsheet.md).
- `hetzner-fsn1` is a shared datacenter on both environments. Re-run the cluster listing above right before Step 2.
- On QA, `plm7k6bfdm` already has its own cluster-level backend pointing at `audit-webhook-test`. Use a different secret name for the enforced settings, or Step 3 cannot tell enforcement apart from what was already there.
- Teardown leaves `auditLogging.enabled: true` behind by design (Step 6).
- `enforcedAuditWebhookSettings` without `enforceAuditLogging: true` silently does nothing — see the prerequisite section.

---

# Testing methods

Steps 0–6 above are **Method 1 + 2 + 3** (live seed). Seven methods exist in total; they prove different layers and none is a superset of the others.

| # | Method | Proves | Cost | Live cluster? | Automatable |
| --- | --- | --- | --- | --- | --- |
| 1 | Live seed via kubectl | Enforcement truly reaches the apiserver process | low | yes, shared | no |
| 2 | Live REST API via curl | Dashboard API validation + DC exposure | low | yes, shared | partly |
| 3 | Live UI, manual | Checkbox actually hidden for a real admin | low | yes, shared | no |
| 4 | Go handler test | Disable-check passes **and** dashboard re-injects enforced backend | medium | no | yes |
| 5 | Go unit test on the validator | The nil-backend early return, all branches | very low | no | yes |
| 6 | Jest component test | `isAuditWebhookBackendHidden` + payload omission | low | no | yes |
| 7 | Cypress e2e with mocks | Wizard + edit dialog + admin panel wiring, stubbed API | medium | no | yes |
| 8 | Local KKP in kind | Full stack incl. enforcement controller, zero shared blast radius | high | yes, disposable | partly |

Recommended for release sign-off: **1 + 2 + 3** (what Steps 0–6 document). Recommended as permanent regression cover: **4 + 6**, since no automated test covers Scenario 8 today.

## Method 1 — live seed via kubectl

Steps 0–3 and 6 above. This is the only method that proves the enforced config reaches the running apiserver (`--audit-webhook-config-file` flag) and that the secret is copied into the user-cluster namespace. Nothing else exercises `ensureAuditWebhook()` (`kubermatic/pkg/controller/seed-controller-manager/kubernetes/resources.go:1601`).

Limit: shared dev environment, manual, requires seed admin.

## Method 2 — live REST API via curl

Step 4 above. Proves the dashboard API layer specifically: the `400` for a user-supplied backend (`cluster.go:183`), the `200` for the UI's null-backend patch, and that `GET /v1/seed/shared/dc/hetzner-fsn1` exposes `enforcedAuditWebhookSettings` to the frontend.

Alternative to the DevTools cookie: create a project service-account token and use it as the bearer, though the admin endpoints in 4a/4b need an admin user.

Limit: cannot see the apiserver flags or the copied secret.

## Method 3 — live UI, manual

Step 5 above. The only method that proves what a human admin actually sees.

Limit: not repeatable in CI.

## Method 4 — Go handler test (recommended new regression cover)

The strongest automated method, because the dashboard API applies enforcement in-process (`common/cluster.go:675`). A test can therefore assert the whole scenario without any cluster.

Files:

- `modules/api/pkg/handler/v2/cluster/cluster_test.go:912` `TestPatchCluster`
- `modules/api/pkg/handler/v2/cluster/cluster_test.go:59` `TestCreateClusterEndpoint`
- Global-settings fixture: `modules/api/pkg/handler/test/helper.go:1418` `GenDefaultGlobalSettings()`
- Test harness wiring: `modules/api/pkg/handler/test/hack/hack.go:47`, `:133` (`settingsProvider`)

Shape of the new cases — two per endpoint:

1. Datacenter in `DisabledAuditWebhookBackendDCs` **and** carrying `EnforceAuditLogging: true` + `EnforcedAuditWebhookSettings`, request body with **no** `webhookBackend` → expect `200`, and the response `spec.auditLogging.webhookBackend` equals the datacenter's enforced value.
2. Same datacenter, request body **with** a different `webhookBackend` → expect `400` and the disabled-datacenter message.

Case 1 is the actual Scenario 8 assertion and has no coverage today. It needs a fixture datacenter with the two enforcement fields set — check the seed fixture used by the cluster tests before adding one.

```bash
go test -tags ee -v ./pkg/handler/v2/cluster/... -run 'TestPatchCluster|TestCreateClusterEndpoint'
```

Limit: does not cover the KKP enforcement controller (that lives in the `kubermatic` repo), so it will not catch a regression where the controller stops reconciling.

## Method 5 — Go unit test on the validator

`modules/api/pkg/handler/common/cluster_test.go:343` `TestValidateAuditWebhookBackendAllowed` already exists with 10 table cases. The relevant existing case is `"create: audit logging without webhook backend is allowed"` — that is the early return Scenario 8 depends on.

```bash
go test -v ./pkg/handler/common/... -run TestValidateAuditWebhookBackendAllowed
```

Limit: tests the validator in isolation. It cannot show that enforcement then re-injects the backend, so on its own it does not cover Scenario 8 — it only shows the validator does not stand in the way.

## Method 6 — Jest component test (recommended new regression cover)

Proves the frontend half: hidden checkbox **and** the payload omission that lets enforcement through.

Existing pieces:

- `modules/web/src/app/cluster/details/cluster/edit-cluster/component.spec.ts` — exists (181 lines), no audit-webhook coverage
- `modules/web/src/test/services/settings-mock.ts:37` — already carries `disabledAuditWebhookBackendDCs: []`, so the mock just needs the DC name pushed in
- Wizard (`wizard/step/cluster/`), admin defaults (`settings/admin/defaults/`) and the DC dialog (`dynamic-datacenters/datacenter-data-dialog/`) have **no** spec files — a new one is needed for those

Assertions for the edit dialog, with settings mock listing the DC and the datacenter fixture carrying `enforcedAuditWebhookSettings`:

1. `component.isAuditWebhookBackendHidden === true` (`component.ts:771`)
2. `component.getObservable()` payload has `spec.auditLogging.webhookBackend === null` (`component.ts:582`) — the property that makes the API's disable-check pass
3. `component.enforcedAuditWebhookSettings` is populated from the datacenter (`component.ts:328`)

```bash
npm run test:ci -- --testPathPattern edit-cluster
```

Limit: no backend involved, so it proves the UI's contribution only.

## Method 7 — Cypress e2e with mocked API

Covers the UI end to end against stubbed responses. Existing specs to extend:

- `modules/web/cypress/e2e/v2/stories/admin-settings/defaults.spec.ts` — the disabled-DC setting
- `modules/web/cypress/e2e/v2/stories/admin-settings/dynamic-datacenters.spec.ts` — the enforce toggles
- Fixtures: `modules/web/cypress/fixtures/datacenter.json`, `datacenters.json`
- Intercepts: `modules/web/cypress/intercept/settings/admin.ts`
- Page objects: `modules/web/cypress/pages/admin-settings.po.ts`, `pages/v2/settings/admin/`

Scenario 8 needs `datacenter.json` to gain `enforceAuditLogging: true` + `enforcedAuditWebhookSettings`, and the admin-settings intercept to return the DC in `disabledAuditWebhookBackendDCs`. Then assert the wizard checkbox is absent while the tooltip shows the admin-enforced note.

```bash
npm run e2e:mock
```

Limit: stubbed API, so it cannot detect a backend regression. Also the heaviest of the frontend options to maintain.

## Method 8 — local KKP in kind

Full stack, including the KKP defaulting webhook and the enforcement controller, on a disposable cluster:

```bash
./hack/ci/setup-kind-cluster.sh
./hack/ci/setup-kubermatic-in-kind.sh
```

Then run Methods 1–3 against it. This is the only method that covers the enforcement controller *and* carries no shared-environment risk, so it is the right choice for anything invasive: flipping `enforceAuditLogging` on a busy datacenter, testing what happens when the referenced secret is missing, or testing removal of enforcement.

Limit: slow setup, needs a `fake`/`bringyourown` provider datacenter rather than real Hetzner, and the audit webhook sink is not reachable so only wiring is observable.

## Coverage gaps worth noting on the ticket

- No automated test anywhere covers Scenario 8 today. `TestValidateAuditWebhookBackendAllowed` covers the disable list; nothing asserts enforcement survives it.
- The dashboard datacenter dialog couples "Enforce Audit Logging" and "Enforce Audit Webhook Backend" (`datacenter-data-dialog/component.ts:164-171`) but nothing tests that coupling, and it is exactly what stops an admin creating the silent no-op combination described in the prerequisite section.

## Reference

- CRD field docs: <https://docs.kubermatic.com/kubermatic/v2.30/references/crds/#auditwebhookbackendsettings>
- `AuditWebhookBackendSettings` type: `kubermatic/sdk/apis/kubermatic/v1/audit_logging.go:67`
- Generated API-client model (for Go-based API e2e): `modules/api/pkg/test/e2e/utils/apiclient/models/audit_webhook_backend_settings.go`
