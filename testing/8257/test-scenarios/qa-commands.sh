#!/usr/bin/env bash
#
# Audit Webhook Backend per Datacenter — QA test run (PR #8161, ticket #8257)
# Target: kkp.qa.lab.kubermatic.io, seed kkp-qa-env, KKP v2.31.0-rc.1
#
# Covers Scenario 6 (API rejection), Scenario 7 (grandfathered cluster),
# Scenario 8 (datacenter-enforced backend still applies).
#
# NOT meant to be run end to end. Run one block at a time and read the output —
# several steps mutate a shared QA environment and several assertions are manual.
#
# Docs:
#   ai/test-scenarios/scenario-6-api-rejects-disabled-webhook-backend.md
#   ai/test-scenarios/scenario-8-dc-enforced-audit-webhook.md
#   ai/notes/kkp-seed-kubectl-cheatsheet.md   <- seed patching, patch types,
#                                                backup/restore, jq/yq, v1 {dc} gotcha

set -u

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
# TOKEN: log into https://kkp.qa.lab.kubermatic.io, DevTools > Application >
# Cookies > copy the `token` value. It is HttpOnly, so JS cannot read it.

export KUBECONFIG=/Users/khizerrehandev/.kube/qa.kubeconfig
export KKP=https://kkp.qa.lab.kubermatic.io/api
export TOKEN='<token cookie>'
export SEED=kkp-qa-env
export PROJECT=7s5x9qhlvb          # KR-QA-2.31
export CLUSTER=plm7k6bfdm          # determined-joliot, dc hetzner-fsn1
export CLUSTER_NS=cluster-$CLUSTER

# Do not touch rsj9mkxl4l (upbeat-hopper) — owner ahmad.hamza@kubermatic.com.

api() { curl -s -w '\nHTTP %{http_code}\n' -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }

# ---------------------------------------------------------------------------
# Step 0 — backup, then unblock the stuck cluster
# ---------------------------------------------------------------------------
# plm7k6bfdm is stuck in Creating. The seed controller loops on:
#   failed to ensure Secret cluster-plm7k6bfdm/audit-webhook-test:
#   failed to generate object: Secret "audit-webhook-test" not found
# Its spec.auditLogging.webhookBackend references kubermatic/audit-webhook-test,
# which does not exist. Creating it should clear the loop.

kubectl -n kubermatic get seed "$SEED" -o json > "/tmp/seed-$SEED.backup.json"
kubectl get kubermaticsettings globalsettings -o json > /tmp/gs.backup.json

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

# Key MUST be webhook.yaml — the apiserver is started with
# --audit-webhook-config-file /etc/kubernetes/audit/webhook/webhook.yaml
kubectl -n kubermatic create secret generic audit-webhook-test     --from-file=webhook.yaml=/tmp/webhook.yaml
kubectl -n kubermatic create secret generic audit-webhook-enforced --from-file=webhook.yaml=/tmp/webhook.yaml

# Wait for the cluster to leave Creating before asserting anything below.
kubectl get cluster "$CLUSTER" -w

# ---------------------------------------------------------------------------
# Step 1 — Scenario 6, Case 3 (control). MUST run before hetzner-fsn1 is disabled.
# ---------------------------------------------------------------------------
# Proves the rejection is datacenter-scoped, not a blanket block.
# PASS: the error is NOT the audit message (a credentials error is expected).
# If it returns 201, delete the cluster immediately.

curl -s -H "Authorization: Bearer $TOKEN" "$KKP/v1/upgrades/cluster" \
  | python3 -c 'import json,sys; print([v["version"] for v in json.load(sys.stdin)][:5])'

api -X POST "$KKP/v2/projects/$PROJECT/clusters" -d '{
  "cluster": {
    "name": "audit-allow-probe",
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

# ---------------------------------------------------------------------------
# Step 2 — Scenario 1: add hetzner-fsn1 to the disable list
# ---------------------------------------------------------------------------
# QA starts with ["hetzner-nbg1","kubevirt-hamburg","vsphere-hamburg"].
# The full list must be sent — this is a replace, not an append.
# From here on, plm7k6bfdm is a grandfathered cluster (Scenario 7).

api -X PATCH "$KKP/v1/admin/settings" \
  -d '{"disabledAuditWebhookBackendDCs": ["hetzner-nbg1", "kubevirt-hamburg", "vsphere-hamburg", "hetzner-fsn1"]}'

curl -s -H "Authorization: Bearer $TOKEN" "$KKP/v1/admin/settings" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["disabledAuditWebhookBackendDCs"])'

# ---------------------------------------------------------------------------
# Step 3 — Scenario 6, Case 1: PATCH changes the backend
# ---------------------------------------------------------------------------
# PASS: HTTP 400 with
#   audit webhook backend is disabled for datacenter "hetzner-fsn1"
# and the cluster spec still shows the original audit-webhook-test block.

api -X PATCH "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" -d '{
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

kubectl get cluster "$CLUSTER" -o jsonpath='{.spec.auditLogging}' | python3 -m json.tool

# ---------------------------------------------------------------------------
# Step 4 — Scenario 6, Case 2: POST create
# ---------------------------------------------------------------------------
# The check runs before the datacenter lookup and before credential handling,
# so the empty hetzner block is fine and nothing is provisioned.
# PASS: HTTP 400 with the audit message — NOT a credentials error.

api -X POST "$KKP/v2/projects/$PROJECT/clusters" -d '{
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

kubectl get clusters.kubermatic.k8c.io | grep audit-reject-probe   # expect no match

# ---------------------------------------------------------------------------
# Step 5 — Scenario 6, Case 5: unrelated patch is unaffected (expect 200)
# ---------------------------------------------------------------------------

api -X PATCH "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" -d '{"labels": {"scenario6": "probe"}}'
api -X PATCH "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" -d '{"labels": {"scenario6": null}}'

# ---------------------------------------------------------------------------
# Step 6 — Scenario 6, Case 6: v1 endpoint behaves identically (expect 400)
# ---------------------------------------------------------------------------
# {dc} in v1 routes is the SEED name, not the datacenter name. Passing
# hetzner-fsn1 returns 404 seed not found, not the 400 under test.
# See ai/notes/kkp-seed-kubectl-cheatsheet.md.

api -X PATCH "$KKP/v1/projects/$PROJECT/dc/$SEED/clusters/$CLUSTER" -d '{
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

# ---------------------------------------------------------------------------
# Step 7 — Scenario 7: unchanged backend re-sent is grandfathered (expect 200)
# ---------------------------------------------------------------------------
# Same values the cluster already has, so reflect.DeepEqual matches and the
# disable list does not apply.

api -X PATCH "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" -d '{
  "spec": {
    "auditLogging": {
      "enabled": true,
      "webhookBackend": {
        "auditWebhookConfig": {"name": "audit-webhook-test", "namespace": "kubermatic"},
        "auditWebhookInitialBackoff": "10s"
      }
    }
  }
}'

# ---------------------------------------------------------------------------
# Step 8 — Scenario 8: enforce a backend on the now-disabled datacenter
# ---------------------------------------------------------------------------
# enforceAuditLogging MUST be true — enforcedAuditWebhookSettings alone is a no-op.
# A DIFFERENT secret name (audit-webhook-enforced) is used on purpose, so the
# assertion can tell enforcement apart from the cluster's own backend.
#
# --type=merge is a JSON merge patch: sibling datacenters and the untouched
# hetzner provider block survive. Patch-type details and the revert form live in
# ai/notes/kkp-seed-kubectl-cheatsheet.md.

kubectl -n kubermatic patch seed "$SEED" --type=merge -p '{
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

kubectl -n kubermatic get seed "$SEED" -o jsonpath='{.spec.datacenters.hetzner-fsn1.spec}' | python3 -m json.tool

# ---------------------------------------------------------------------------
# Step 9 — Scenario 8 assertions
# ---------------------------------------------------------------------------
# PASS: webhookBackend names audit-webhook-enforced — it came from the
# datacenter, despite hetzner-fsn1 being on the disable list.

kubectl get cluster "$CLUSTER" -o jsonpath='{.spec.auditLogging}' | python3 -m json.tool
kubectl get events -A --field-selector reason=AuditLoggingEnforced | grep "$CLUSTER"
kubectl -n "$CLUSTER_NS" get secret audit-webhook-enforced

kubectl -n "$CLUSTER_NS" get deploy apiserver \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="apiserver")].command}' \
  | tr ',' '\n' | grep -A1 audit-webhook

# The datacenter must expose the enforced settings to the UI.
curl -s -H "Authorization: Bearer $TOKEN" "$KKP/v1/seed/$SEED/dc/hetzner-fsn1" \
  | python3 -c 'import json,sys; s=json.load(sys.stdin)["spec"]; print(s.get("enforceAuditLogging")); print(json.dumps(s.get("enforcedAuditWebhookSettings"), indent=2))'

# Cluster read-back through the API.
curl -s -H "Authorization: Bearer $TOKEN" "$KKP/v2/projects/$PROJECT/clusters/$CLUSTER" \
  | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["spec"]["auditLogging"], indent=2))'

# ---------------------------------------------------------------------------
# Step 10 — UI checks (manual, while Steps 2 and 8 are still in effect)
# ---------------------------------------------------------------------------
# Scenario 2: wizard, provider Hetzner, dc Falkenstein 1 DC 14 —
#             "Audit Webhook Backend" checkbox is HIDDEN.
# Scenario 3: same wizard on an allowed dc — checkbox visible and functional.
# Scenario 4: switch the wizard from an allowed dc to hetzner-fsn1 —
#             option disappears and unchecks.
# Scenario 5: cluster determined-joliot > Edit Cluster — checkbox hidden,
#             dialog saves without error.
# Admin Panel > Dynamic Datacenters > hetzner-fsn1 — "Enforce Audit Webhook
#             Backend" checked, secret audit-webhook-enforced / kubermatic / 10s.
#             Unchecking "Enforce Audit Logging" must auto-uncheck it. Do not save.
# Admin Panel > Settings > Defaults — hetzner-fsn1 listed, persists across reload
#             (Scenario 1).

# ---------------------------------------------------------------------------
# Step 11 — teardown
# ---------------------------------------------------------------------------
# Remove enforceAuditLogging + enforcedAuditWebhookSettings from hetzner-fsn1.
kubectl -n kubermatic edit seed "$SEED"

kubectl -n kubermatic delete secret audit-webhook-enforced

# KEEP kubermatic/audit-webhook-test — plm7k6bfdm's own cluster-level backend
# references it, and deleting it puts the cluster back into the broken loop.

api -X PATCH "$KKP/v1/admin/settings" \
  -d '{"disabledAuditWebhookBackendDCs": ["hetzner-nbg1", "kubevirt-hamburg", "vsphere-hamburg"]}'

# Confirm the cluster settles back to its own backend and the enforced secret is gone.
kubectl get cluster "$CLUSTER" -o jsonpath='{.spec.auditLogging}' | python3 -m json.tool
kubectl -n "$CLUSTER_NS" get secret audit-webhook-enforced

# Note: the enforcement controller does not set enabled:false again once
# enforcement is off — it returns early without touching the cluster.
