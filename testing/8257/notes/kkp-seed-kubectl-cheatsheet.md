# KKP Seed / Datacenter kubectl Cheatsheet

Working notes for patching Seed CRs on the QA environment, focused on the enforced
audit logging fields. Applies to `seed.kubermatic.k8c.io` resources in the
`kubermatic` namespace of a seed/master cluster.

Reference material only. Test procedures that use it:
[Scenario 6](../test-scenarios/scenario-6-api-rejects-disabled-webhook-backend.md),
[Scenario 8](../test-scenarios/scenario-8-dc-enforced-audit-webhook.md),
runnable commands in [`qa-commands.sh`](../test-scenarios/qa-commands.sh).

## Environments

| | QA | Dev |
| --- | --- | --- |
| kubeconfig | `~/.kube/qa.kubeconfig` (context `bnl29dkkz2`) | `kgdev` alias, context `fth4x68gcq` |
| Seed | `kkp-qa-env` | `shared` |
| Dashboard | `kkp.qa.lab.kubermatic.io` | `dev.kubermatic.io` |

`SEED` is what v1 API routes want in their `{dc}` path segment — see the gotcha below.

## Setup

```bash
export KUBECONFIG=/Users/khizerrehandev/.kube/qa.kubeconfig
```

Everything below assumes this is exported. Without it, `kubectl` silently uses the
default context — the most common way to inspect or patch the wrong cluster.

Alternative for one-off commands:

```bash
kubectl --kubeconfig ~/.kube/qa.kubeconfig -n kubermatic get seeds
```

## Inspect

```bash
# all seeds
kubectl -n kubermatic get seeds

# full seed as YAML
kubectl -n kubermatic get seed kkp-qa-env -o yaml

# one datacenter spec
kubectl -n kubermatic get seed kkp-qa-env -o jsonpath='{.spec.datacenters.hetzner-fsn1.spec}' | jq

# datacenter names in a seed
kubectl -n kubermatic get seed kkp-qa-env -o json | jq -r '.spec.datacenters | keys[]'

# datacenters that currently enforce audit logging
kubectl -n kubermatic get seed kkp-qa-env -o json \
  | jq -r '.spec.datacenters | to_entries[] | select(.value.spec.enforceAuditLogging == true) | .key'

# audit logging state across every seed and datacenter
kubectl -n kubermatic get seeds -o json \
  | jq -r '.items[] | .metadata.name as $s | .spec.datacenters | to_entries[]
           | "\($s)/\(.key)  enforce=\(.value.spec.enforceAuditLogging // false)  webhook=\(.value.spec.enforcedAuditWebhookSettings.auditWebhookConfig.name // "-")"'
```

## Backup first

```bash
kubectl -n kubermatic get seed kkp-qa-env -o yaml > /tmp/seed-kkp-qa-env-backup.yaml
```

Restore:

```bash
kubectl apply -f /tmp/seed-kkp-qa-env-backup.yaml
```

## Enable enforced audit logging + webhook

```bash
kubectl -n kubermatic patch seed kkp-qa-env --type=merge -p '{
  "spec": {
    "datacenters": {
      "hetzner-fsn1": {
        "spec": {
          "enforceAuditLogging": true,
          "enforcedAuditWebhookSettings": {
            "auditWebhookConfig": {"name": "audit-webhook-test", "namespace": "kubermatic"},
            "auditWebhookInitialBackoff": "10s"
          }
        }
      }
    }
  }
}'
```

### `enforceAuditLogging` is required

`enforcedAuditWebhookSettings` on its own is a **silent no-op**. Both enforcement
paths are gated on `enforceAuditLogging`:

- defaulting webhook — `kubermatic/pkg/defaulting/cluster.go:112`
- enforcement controller — `audit-logging-enforcement-controller/controller.go:367`

The dashboard datacenter dialog couples the two checkboxes
(`datacenter-data-dialog/component.ts:164-171`), so only a raw kubectl or API edit
can produce the broken combination.

### The referenced Secret must exist first

The Secret named in `auditWebhookConfig` must exist in the `kubermatic` namespace of
the seed. If it does not, the whole cluster reconcile fails — this is not a
degraded sidecar, the control plane is never created and the cluster sits in
`Creating` with no pods:

```
failed to reconcile cluster: failed to ensure Secret cluster-<id>/audit-webhook-test:
failed to generate object: Secret "audit-webhook-test" not found
```

The same applies to a **cluster-level** `spec.auditLogging.webhookBackend`, and
nothing validates the reference at the API layer — a cluster created through the
wizard pointing at a missing Secret bricks itself with no error shown to the user.

Create it before patching. The key **must** be `webhook.yaml`, because the
apiserver is started with
`--audit-webhook-config-file /etc/kubernetes/audit/webhook/webhook.yaml`
(`kubermatic/pkg/resources/apiserver/deployment.go:402,617,855`):

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

A non-resolving host is fine when only the wiring is under test. The seed
controller copies this Secret into each user-cluster namespace under the same
name (`seed-controller-manager/kubernetes/resources.go:1601` `ensureAuditWebhook()`).

### Check what enforcement actually did

```bash
kubectl get cluster <id> -o jsonpath='{.spec.auditLogging}' | jq
kubectl get events -A --field-selector reason=AuditLoggingEnforced
kubectl -n cluster-<id> get secret <enforced-secret-name>
kubectl -n cluster-<id> get deploy apiserver \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="apiserver")].command}' \
  | tr ',' '\n' | grep -A1 audit-webhook
```

Turning enforcement **off** does not undo `enabled: true` — the controller returns
early without touching the cluster (`controller.go:367`), so the flag persists
until cleared by hand.

## Revert

`null` deletes a key in a merge patch:

```bash
kubectl -n kubermatic patch seed kkp-qa-env --type=merge -p '{
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
```

Verify with the one-datacenter inspect command above.

## Patch types

- `--type=merge` — JSON merge patch (RFC 7386). Objects merge recursively, so sibling
  datacenters and untouched fields such as the `hetzner` provider block survive.
  `null` deletes a key. This is the right default for Seed edits.
- `--type=json` — JSON Patch (RFC 6902). Needed for array index operations and for
  explicit removes:

  ```bash
  kubectl -n kubermatic patch seed kkp-qa-env --type=json \
    -p '[{"op":"remove","path":"/spec/datacenters/hetzner-fsn1/spec/enforceAuditLogging"}]'
  ```

  Note that `/` inside a key must be escaped as `~1`.
- `--type=strategic` (kubectl default when `--type` is omitted) — does not apply to
  CRDs, which have no strategic merge metadata. It silently falls back to behaving
  like a merge patch for custom resources.
- Never use `kubectl replace` on a Seed: it drops every field not present in the
  submitted object.

Interactive one-off edit:

```bash
kubectl -n kubermatic edit seed kkp-qa-env
```

## API gotcha: `{dc}` in v1 routes means seed name

V1 cluster routes look like
`/api/v1/projects/{project_id}/dc/{dc}/clusters/{cluster_id}`. The `{dc}` path
parameter is the **Seed name**, not the datacenter name, even though it reads as
"dc". See `pkg/handler/v1/common/request.go:80`:

```go
func (req DCReq) GetSeedCluster() apiv1.SeedCluster {
	return apiv1.SeedCluster{SeedName: req.DC}
}
```

`pkg/handler/middleware/middleware.go:422` then looks the value up in the seeds map,
whose keys are Seed CR names. Passing a datacenter name such as `hetzner-fsn1` gives:

```json
{"error": {"code": 404, "message": "seed \"hetzner-fsn1\" not found"}}
```

Correct v1 call for the QA seed:

```
PATCH /api/v1/projects/<project_id>/dc/kkp-qa-env/clusters/<cluster_id>
```

Prefer the v2 route, which omits `dc` entirely and resolves the seed from the cluster
ID (`getClusterProviderByClusterID`):

```
PATCH /api/v2/projects/<project_id>/clusters/<cluster_id>
```

The datacenter name belongs in the cluster body under `spec.cloud.dc`, never in the URL.

## jq vs yq

`jq` ships with recent macOS at `/usr/bin/jq`. It only speaks JSON, so pair it with
`kubectl -o json`.

`yq` (mikefarah, v4) is not installed by default — `brew install yq`. Same expression
language as `jq`, but reads and writes YAML directly. Useful when:

```bash
# read a YAML backup without converting it first
yq '.spec.datacenters.hetzner-fsn1.spec' /tmp/seed-kkp-qa-env-backup.yaml

# in-place edit of a checked-in manifest, preserving comments and key order
yq -i '.spec.datacenters.hetzner-fsn1.spec.enforceAuditLogging = true' seed.yaml

# convert between formats
yq -o=json '.' seed.yaml
yq -P '.' seed.json
```

`yq` also handles multi-document YAML (`---` separated manifests), which `jq` cannot.
For live-cluster work `kubectl -o json | jq` is sufficient; reach for `yq` when editing
manifests or Helm values on disk.
