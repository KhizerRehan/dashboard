# Scenario 6 — REST API rejects a webhook backend for a disabled datacenter

Release testing for KKP 2.31 · ticket [dashboard#8257](https://github.com/kubermatic/dashboard/issues/8257) · feature PR [#8161](https://github.com/kubermatic/dashboard/pull/8161)

## What is being tested

Hiding the "Audit Webhook Backend" checkbox in the UI (Scenarios 2–5) is cosmetic. Scenario 6 asserts the **server** enforces it: a REST request that tries to enable or change a cluster-level audit webhook backend for a datacenter listed in `disabledAuditWebhookBackendDCs` must fail with `400 Bad Request`, and the message must name the datacenter.

Expected response body:

```json
{"error":{"code":400,"message":"audit webhook backend is disabled for datacenter \"hetzner-fsn1\""}}
```

Shape comes from `ErrorResponse` (`modules/api/pkg/handler/handler.go:38`); the message from `utilerrors.NewBadRequest` (`modules/api/pkg/handler/common/cluster.go:183`).

## Code under test

| Concern | Location |
| --- | --- |
| The validator | `modules/api/pkg/handler/common/cluster.go:167` `validateAuditWebhookBackendAllowed()` |
| Called on create | `modules/api/pkg/handler/common/cluster.go:214` |
| Called on patch | `modules/api/pkg/handler/common/cluster.go:618` |
| Message emitted | `modules/api/pkg/handler/common/cluster.go:183` |

Its four rules, from the code:

1. `newWebhookBackend == nil` → allow (`:176`). No backend requested, nothing to block.
2. `oldWebhookBackend` deep-equals `newWebhookBackend` → allow (`:179`). Grandfathers clusters configured before the datacenter was disabled — that is Scenario 7.
3. datacenter in `disabledDCs` → **reject** (`:182`). The Scenario 6 case.
4. otherwise → allow.

Because rule 3 is reached on create at `cluster.go:214` — **before** `provider.DatacenterFromSeedMap` at `:218` and long before any credential handling — a create request that is rejected for this reason **never provisions anything**. That makes the create half safe to run against the shared environment with a dummy cloud spec.

## Target environments

Two environments are available. **QA is the release-testing target**; dev is the fallback.

### QA — `kkp.qa.lab.kubermatic.io` (verified 2026-08-18)

| Item | Value |
| --- | --- |
| kubeconfig | `/Users/khizerrehandev/.kube/qa.kubeconfig`, context `bnl29dkkz2` |
| Seed | `kkp-qa-env` in ns `kubermatic`, KKP `v2.31.0-rc.1` |
| Dashboard / API base | `https://kkp.qa.lab.kubermatic.io/api` |
| `disabledAuditWebhookBackendDCs` | `["hetzner-nbg1", "kubevirt-hamburg", "vsphere-hamburg"]` |
| Your cluster | `plm7k6bfdm` (determined-joliot), project `7s5x9qhlvb` (KR-QA-2.31), dc **`hetzner-fsn1`** |
| Its `spec.auditLogging` | `{"enabled": true, "webhookBackend": {"auditWebhookConfig": {"name": "audit-webhook-test", "namespace": "kubermatic"}, "auditWebhookInitialBackoff": "10s"}}` |
| Not yours — leave alone | `rsj9mkxl4l` (upbeat-hopper), owner `ahmad.hamza@kubermatic.com`, project `j8bmd72dw2`, dc `gcp-westeurope` |
| Datacenters with `enforcedAuditWebhookSettings` | none |

**Two QA-specific facts that change this test:**

1. **`hetzner-fsn1` is *not* on the disable list**, so your cluster's datacenter is currently *allowed*. Every case below needs a disabled datacenter — either add `hetzner-fsn1` to the list (Admin Panel → Settings → Defaults, which is Scenario 1), or target `hetzner-nbg1` / `kubevirt-hamburg` / `vsphere-hamburg`, which have no clusters and therefore only support the create cases.
2. **`plm7k6bfdm` already has a cluster-level webhook backend** set while its datacenter was still allowed. Adding `hetzner-fsn1` to the disable list turns it into the exact grandfathered cluster **Scenario 7** describes, and makes rule 2 (`old == new` → allow) live. Do that once and the same cluster serves Scenarios 6, 7 and 8.

> **Blocker — fix before testing.** `plm7k6bfdm` is stuck in `Creating` with no control-plane pods. The seed controller is erroring in a loop:
>
> ```
> failed to reconcile cluster: failed to ensure Secret cluster-plm7k6bfdm/audit-webhook-test: failed to generate object: Secret "audit-webhook-test" not found
> ```
>
> The cluster references `kubermatic/audit-webhook-test`, and that secret does not exist in the `kubermatic` namespace. Create it (same content and `webhook.yaml` key as [Scenario 8](./scenario-8-dc-enforced-audit-webhook.md) Step 1) and the cluster should proceed. Cases 1, 4, 5 and 6 patch this cluster, so they are unreliable until it reconciles.
>
> Worth raising separately: nothing validates that the referenced secret exists, so a cluster-level webhook backend pointing at a missing secret bricks cluster creation with no API-level error.

### Dev — `dev.kubermatic.io` (verified 2026-08-17)

| Item | Value |
| --- | --- |
| kubectl context | `fth4x68gcq` |
| Seed | `shared`, KKP `v2.31.0-rc.1-1-gb5d7e53f6` |
| Dashboard / API base | `https://dev.kubermatic.io/api` |
| `disabledAuditWebhookBackendDCs` | `["hetzner-fsn1"]` — already set, **no setup needed** |
| Control datacenter, not disabled | `hetzner-nbg1` (no clusters) |
| Clusters in `hetzner-fsn1`, project `rzbqvk6qwc` | `nlsc9mlqhf` (kr-os-dev), `ypxm6hf2rf` (zealous-minsky) |
| Their `spec.auditLogging` | `{}` — no webhook backend, so rule 2 does not apply |

Scenario 6 needs no `enforcedAuditWebhookSettings` on either environment — unlike Scenario 8. If you ran Scenario 8 first, tear it down, otherwise the clusters carry an enforced backend and rule 2 changes which cases fire.

## Setup

**QA:**

```bash
export KUBECONFIG=/Users/khizerrehandev/.kube/qa.kubeconfig
export KKP=https://kkp.qa.lab.kubermatic.io/api
export TOKEN='<token cookie value>'
export PROJECT=7s5x9qhlvb
export CLUSTER=plm7k6bfdm
export SEED=kkp-qa-env              # v1 routes want the SEED name in {dc}
export DISABLED_DC=hetzner-fsn1     # after adding it to the disable list
export ALLOWED_DC=hetzner-fsn1      # before adding it — see Case 3
```

**Dev:**

```bash
export KKP=https://dev.kubermatic.io/api
export TOKEN='<token cookie value>'
export PROJECT=rzbqvk6qwc
export CLUSTER=nlsc9mlqhf
export SEED=shared                  # v1 routes want the SEED name in {dc}
export DISABLED_DC=hetzner-fsn1
export ALLOWED_DC=hetzner-nbg1
```

The curl bodies below hardcode `hetzner-fsn1`, which is correct for both once QA's disable list includes it. Substitute `$DISABLED_DC` / `$ALLOWED_DC` if you target a different datacenter.

Token: log into the dashboard for the environment you picked, DevTools → Application → Cookies → copy `token`. It is HttpOnly, so JS cannot read it (`modules/web/src/app/core/services/auth/service.ts:73-75`).

Confirm the precondition:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$KKP/v1/admin/settings" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["disabledAuditWebhookBackendDCs"])'
```

Expect the datacenter you are targeting to be in the list — `hetzner-fsn1` on dev. **On QA you must add `hetzner-fsn1` first**, via Admin Panel → Settings → Defaults, or:

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' \
  -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$KKP/v1/admin/settings" \
  -d '{"disabledAuditWebhookBackendDCs": ["hetzner-nbg1", "kubevirt-hamburg", "vsphere-hamburg", "hetzner-fsn1"]}'
```

Route: `modules/api/pkg/handler/routes_v1_admin.go:184`. Send the full list — the existing three entries are re-sent above, drop `hetzner-fsn1` again during teardown.

---

## Case 1 — PATCH adds a webhook backend to a cluster in a disabled DC → 400

The primary assertion. Hits rule 3 via `cluster.go:618`.

```bash
curl -s -w '\nHTTP %{http_code}\n' \
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
```

**Expect** `HTTP 400` and:

```json
{"error":{"code":400,"message":"audit webhook backend is disabled for datacenter \"hetzner-fsn1\""}}
```

Verify nothing was written:

```bash
kubectl get cluster $CLUSTER -o jsonpath='{.spec.auditLogging}'
```

Dev: still `{}`. QA: still the original `audit-webhook-test` block — the rejected `rogue-secret` must not appear.

> On QA this case exercises rule 3 *against* rule 2: the cluster already has a backend, and you are changing it to a different one. `reflect.DeepEqual` fails, so it must be rejected. That is a stronger check than dev's, where the cluster has no backend at all.

## Case 2 — POST creates a cluster with a webhook backend in a disabled DC → 400

Hits rule 3 via `cluster.go:214`. The request is rejected before the datacenter lookup and before credentials are touched, so the empty `hetzner: {}` block below is fine and **no cluster is created**.

First pick a supported version — the request is validated by `ValidateClusterSpec` (`cluster.go:1327`) *before* the audit check, so an unsupported version would mask the result with a different `400`:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$KKP/v1/upgrades/cluster" \
  | python3 -c 'import json,sys; print([v["version"] for v in json.load(sys.stdin)][:5])'
```

Then, substituting a listed version for `1.35.7`:

```bash
curl -s -w '\nHTTP %{http_code}\n' \
  -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$KKP/v2/projects/$PROJECT/clusters" \
  -d '{
    "cluster": {
      "name": "audit-reject-probe",
      "type": "kubernetes",
      "spec": {
        "version": "1.35.7",
        "cloud": {"dc": "hetzner-fsn1", "hetzner": {}},
        "auditLogging": {
          "enabled": true,
          "webhookBackend": {
            "auditWebhookConfig": {"name": "rogue-secret", "namespace": "kubermatic"},
            "auditWebhookInitialBackoff": "30s"
          }
        }
      }
    }
  }'
```

**Expect** `HTTP 400` with the same audit message — **not** a credentials or datacenter error. A credentials error means the request got past the check and the test failed.

Confirm no cluster appeared:

```bash
kubectl get clusters.kubermatic.k8c.io -o custom-columns=NAME:.metadata.name,HUMAN:.spec.humanReadableName | grep audit-reject-probe
```

The QA seed reports `v1.34.7` as its cluster version while both existing clusters run `1.35.7`, so take the version from `/v1/upgrades/cluster` rather than assuming.

Expect no match.

Required fields explained (`ValidateClusterSpec`, `cluster.go:1327-1358`): `spec.cloud.dc` non-empty, `type` must be `kubernetes` (`ClusterTypes`, `cluster.go:76`), `spec.version` must be a supported version for the provider, `name` ≤ 100 chars, and `id` must be absent.

## Case 3 — control: same request against a non-disabled DC is **not** blocked

Proves the rejection is datacenter-scoped, not a blanket block. Use a datacenter that is **not** on the list — `hetzner-nbg1` on dev. On QA, `hetzner-nbg1` *is* disabled, so pick an allowed one instead: `hetzner-fsn1` before you add it to the list, or `gcp-westeurope` / `aws-eu-central-1a`. Substitute it for `hetzner-nbg1` in the body below.

```bash
curl -s -w '\nHTTP %{http_code}\n' \
  -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$KKP/v2/projects/$PROJECT/clusters" \
  -d '{
    "cluster": {
      "name": "audit-allow-probe",
      "type": "kubernetes",
      "spec": {
        "version": "1.35.7",
        "cloud": {"dc": "hetzner-nbg1", "hetzner": {}},
        "auditLogging": {
          "enabled": true,
          "webhookBackend": {
            "auditWebhookConfig": {"name": "rogue-secret", "namespace": "kubermatic"},
            "auditWebhookInitialBackoff": "30s"
          }
        }
      }
    }
  }'
```

**Expect** a failure that is **not** the audit message — a missing-credentials error is the pass condition here, since it proves the audit check was cleared and the request moved on. If it unexpectedly returns `201`, delete the cluster immediately:

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$KKP/v2/projects/$PROJECT/clusters/<id>"
```

## Case 4 — removing a webhook backend on a disabled DC is allowed

Rule 1. This is the payload the UI sends when the checkbox is hidden (`edit-cluster/component.ts:582` sets `webhookBackend: null`).

```bash
curl -s -w '\nHTTP %{http_code}\n' \
  -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" \
  -d '{"spec": {"auditLogging": {"enabled": true, "policyPreset": "", "webhookBackend": null}}}'
```

**Expect** `HTTP 200`. Users must never be locked out of editing a cluster just because its datacenter is on the list.

> **Run this case last on QA.** It actually removes `plm7k6bfdm`'s existing webhook backend, destroying the grandfathered state that Scenario 7 needs and that makes Case 1 meaningful. Restore it afterwards:
>
> ```bash
> curl -s -o /dev/null -w 'HTTP %{http_code}\n' \
>   -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
>   "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" \
>   -d '{"spec":{"auditLogging":{"enabled":true,"webhookBackend":{"auditWebhookConfig":{"name":"audit-webhook-test","namespace":"kubermatic"},"auditWebhookInitialBackoff":"10s"}}}}'
> ```
>
> That restore is itself blocked while `hetzner-fsn1` is on the disable list (rule 3 — old is `nil`, new is not). Remove the datacenter from the list first, restore, then add it back.

Revert on dev, where the cluster started with `auditLogging: {}`:

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' \
  -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" \
  -d '{"spec": {"auditLogging": {"enabled": false}}}'
```

## Case 5 — an unrelated patch is unaffected

Rule 1 again, with no `auditLogging` key at all.

```bash
curl -s -w '\nHTTP %{http_code}\n' \
  -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" \
  -d '{"labels": {"scenario6": "probe"}}'
```

**Expect** `HTTP 200`. Then remove the label:

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' \
  -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" \
  -d '{"labels": {"scenario6": null}}'
```

## Case 6 — the v1 endpoints behave identically

Both API versions funnel into the same `handlercommon` functions, so v1 must reject too.

> **`{dc}` in v1 routes is the Seed name, not the datacenter name** — `DCReq.GetSeedCluster()` returns `SeedCluster{SeedName: req.DC}` (`modules/api/pkg/handler/v1/common/request.go:78`), and the middleware looks it up in the seeds map (`modules/api/pkg/handler/middleware/middleware.go:422`). Passing `hetzner-fsn1` yields `404 seed "hetzner-fsn1" not found`, not the 400 you are testing for. Use `$SEED` — `kkp-qa-env` on QA, `shared` on dev. See [the seed cheatsheet](../notes/kkp-seed-kubectl-cheatsheet.md).

```bash
curl -s -w '\nHTTP %{http_code}\n' \
  -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$KKP/v1/projects/$PROJECT/dc/$SEED/clusters/$CLUSTER" \
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
```

**Expect** `HTTP 400` with the same message (route: `routes_v1.go:1071`).

---

## Pass / fail summary

| Case | Request | Pass condition |
| --- | --- | --- |
| 1 | PATCH adds backend, disabled DC | `400`, message names `hetzner-fsn1`, cluster spec unchanged |
| 2 | POST creates with backend, disabled DC | `400`, same message, no cluster created |
| 3 | POST creates with backend, non-disabled DC | error is *not* the audit message |
| 4 | PATCH sets `webhookBackend: null`, disabled DC | `200` |
| 5 | PATCH unrelated field, disabled DC | `200` |
| 6 | v1 PATCH adds backend, disabled DC | `400`, same message |

Full pass requires all six. Cases 3–5 are the ones that catch an over-broad block, which is the likelier regression — a validator that rejects too much still passes Case 1.

Suggested QA order, given the state coupling:

1. Fix the missing `kubermatic/audit-webhook-test` secret, wait for `plm7k6bfdm` to leave `Creating`.
2. Case 3 against `hetzner-fsn1` while it is still allowed.
3. Add `hetzner-fsn1` to `disabledAuditWebhookBackendDCs`.
4. Cases 1, 2, 5, 6.
5. Run Scenario 7 now — the cluster is grandfathered at this point and the state is perfect for it.
6. Case 4 last, then restore the backend as described.

## Other testing methods

Scenario 6 is the pure API scenario, so unlike Scenario 8 it is cheap to automate.

| # | Method | Proves | Live cluster? |
| --- | --- | --- | --- |
| 1 | curl against live API (above) | the real deployed binary rejects | yes, shared |
| 2 | Go unit test on the validator | all four rules, every branch | no |
| 3 | Go handler test | full endpoint incl. HTTP status and message | no |
| 4 | Local KKP in kind | same as 1, disposable environment | yes, disposable |

### Method 2 — Go unit test (already exists)

`modules/api/pkg/handler/common/cluster_test.go:343` `TestValidateAuditWebhookBackendAllowed` — 10 table cases already covering every rule, including the Case 3 and Case 4 equivalents:

```bash
go test -v ./pkg/handler/common/... -run TestValidateAuditWebhookBackendAllowed
```

This is the fastest way to check the logic, and it is the existing regression cover for Scenario 6. It does **not** assert the HTTP status code or the response body shape.

### Method 3 — Go handler test

Asserts the wire contract that Cases 1, 2 and 6 check by hand — status `400` and the exact message.

- `modules/api/pkg/handler/v2/cluster/cluster_test.go:912` `TestPatchCluster`
- `modules/api/pkg/handler/v2/cluster/cluster_test.go:59` `TestCreateClusterEndpoint`
- Settings fixture to mutate: `modules/api/pkg/handler/test/helper.go:1418` `GenDefaultGlobalSettings()`
- Harness wiring: `modules/api/pkg/handler/test/hack/hack.go:133` (`settingsProvider`)

```bash
go test -tags ee -v ./pkg/handler/v2/cluster/... -run 'TestPatchCluster|TestCreateClusterEndpoint'
```

No such case exists today — this is the gap worth filling, since Method 2 cannot catch a regression where the validator is correct but no longer wired into the endpoint.

### Method 4 — local KKP in kind

```bash
./hack/ci/setup-kind-cluster.sh
./hack/ci/setup-kubermatic-in-kind.sh
```

Then run Cases 1–6 against it. Use this if you want to run Case 3 to an actual `201` with a working preset, which is not advisable on the shared environment.

## Reference

- Error response model: `modules/api/pkg/handler/handler.go:38` `ErrorResponse`
- `NewBadRequest`: `k8c.io/kubermatic/v2/pkg/util/errors/errors.go:92`
- Related: [Scenario 8](./scenario-8-dc-enforced-audit-webhook.md) — datacenter-enforced backends bypass this rejection by design
