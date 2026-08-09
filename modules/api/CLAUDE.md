# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# Kubermatic Dashboard API - Architecture Guide

This document provides a high-level overview of the Kubermatic Dashboard API server codebase to help new developers understand how the application is organized and how its components interact.

## Overview

The Kubermatic Dashboard API is a REST API server written in Go that serves as the backend for the Kubermatic Kubernetes Platform (KKP) Dashboard. It manages clusters, projects, users, seeds, and other resources in a Kubernetes-based infrastructure management platform.

**Type**: HTTP REST API Server (Go)
**Port**: 8080 (configurable via `-address` flag)
**Framework**: Gorilla Mux (HTTP routing) + Go-Kit (endpoint/transport abstraction)
**Authentication**: OIDC + Service Account JWT tokens
**Storage**: Kubernetes API (uses controller-runtime client)

## Common Development Commands

### Building
```bash
# Build for Enterprise Edition (default)
make build

# Build for Community Edition
make build KUBERMATIC_EDITION=ce

# Build specific command (e.g., kubermatic-api)
make kubermatic-api

# Clean build artifacts
make clean
```

### Testing
```bash
# Run API tests
make api-test

# Build test (compile all packages without running tests)
make build-tests

# Run tests for specific package
go test -v ./pkg/handler/v1/cluster/...
```

### Code Quality
```bash
# Run linter (golangci-lint)
make lint

# Format code
make fmt

# Run go vet
make vet

# Verify imports order
make verify-imports

# Verify all (runs multiple verification checks)
make verify
```

### Code Generation
```bash
# Update generated code (after modifying types or APIs)
make update-codegen

# This runs:
# - go mod tidy
# - go mod vendor
# - ./hack/update-codegen.sh (generates deepcopy, clientsets, etc.)
# - ./hack/gen-api-client.sh (generates API client)
# - ./hack/update-swagger.sh (updates swagger spec)
```

### Dependency Management
```bash
# Verify go.mod and go.sum
make verify-go

# Check dependencies are tidy
make check-dependencies

# Update to latest KKP version
make update-kkp
```

### Testing Single Changes
```bash
# To run a single test function
go test -v ./pkg/handler/v1/project -run TestCreateProject

# To test with EE features
go test -tags "ee" -v ./pkg/handler/...

# To test with CE features
go test -tags "ce" -v ./pkg/handler/...
```

## Project Structure

```
.
├── cmd/kubermatic-api/          # Main entry point
├── pkg/
│   ├── api/                      # API models (v1, v2 schemas)
│   ├── handler/                  # HTTP request handlers & routing
│   ├── provider/                 # Business logic & data access layer
│   ├── ee/                        # Enterprise Edition specific code
│   ├── kubernetes/               # Kubernetes API interactions
│   ├── watcher/                  # Informer-based watchers
│   ├── serviceaccount/           # Service account token management
│   ├── validation/               # Input validation
│   ├── resources/                # Resource definitions
│   └── test/                      # Test utilities
└── hack/                          # Build & development scripts
```

## Main Entry Point: `cmd/kubermatic-api/main.go`

The server startup flow:

1. **Parse Flags** (`newServerRunOptions()`) - Load CLI arguments (listen address, OIDC config, CA bundle, etc.)
2. **Setup Logging** - Initialize zap-based structured logging
3. **Register Kubernetes Schemes** - Add CRD types to k8s client scheme (Machine Controller, Gatekeeper, Kyverno, Velero, etc.)
4. **Create Controller Manager** - Initialize controller-runtime manager for caching and informers
5. **Create Providers** (`createInitProviders()`) - Instantiate all business logic providers
6. **Create Auth Clients** (`createAuthClients()`) - Setup OIDC and JWT token verification
7. **Create HTTP Handler** (`createAPIHandler()`) - Register routes and middleware
8. **Start Server** - Listen on configured address with logging and metrics middleware

### Key Startup Configuration

```go
type serverRunOptions struct {
    listenAddress                  string // Default: :8080
    internalAddr                   string // Metrics endpoint
    namespace                      string // Kubermatic namespace (default: "kubermatic")
    kubermaticConfiguration        *kubermaticv1.KubermaticConfiguration
    oidcURL, oidcAuthenticatorClientID string
    oidcIssuerClientID, oidcIssuerClientSecret string
    serviceAccountSigningKey       string // JWT signing key
    featureGates                   features.FeatureGate
}
```

## Core Architecture Patterns

### 1. Handler Pattern (HTTP Request → Response)

**Location**: `pkg/handler/`

Routes are organized in a Gorilla Mux router with layers:
- **Middleware**: Authentication, RBAC, context enrichment
- **Handlers**: HTTP request parsing, delegation to providers, response encoding

```
HTTP Request → Middleware Chain → Handler Function → Provider Call → HTTP Response
```

**Handler Structure**:
```go
// Each endpoint follows Go-Kit pattern: Request → Endpoint → Response
func CreateEndpoint(providers...) endpoint.Endpoint {
    return func(ctx context.Context, request interface{}) (interface{}, error) {
        // Parse request, validate, call provider, return response
    }
}
```

**Key Components**:
- `routing.go` - Main route registration and parameter passing
- `routes_v1.go` - v1 API endpoint definitions
- `routes_v1_websocket.go` - WebSocket handlers for logs/events
- `routes_v1_admin.go` - Admin-only endpoints
- Handlers organized by resource: `v1/cluster/`, `v1/user/`, `v1/project/`, etc.

### 2. Provider Pattern (Business Logic Abstraction)

**Location**: `pkg/provider/`

Providers are interfaces that abstract data access and business logic. They enable:
- Dependency injection
- Easy mocking for tests
- Separation of HTTP concerns from business logic

**Provider Types**:

```
Top-level Providers:
├── ProjectProvider - CRUD operations on projects (user-scoped)
├── ClusterProvider - CRUD operations on clusters (via Getter function per seed)
├── UserProvider - User management
├── SSHKeyProvider - SSH key management (user-scoped)
├── ServiceAccountProvider - Service account management
├── PresetProvider - Cloud credential presets
├── SeedsGetter - List available seeds
├── SettingsProvider - Global/admin settings
├── AdminProvider - Admin-only operations

Getter Functions (return provider-per-seed):
├── ClusterProviderGetter - Returns ClusterProvider for a seed
├── AddonProviderGetter - Returns AddonProvider for a seed
├── AlertmanagerProviderGetter - Returns AlertmanagerProvider for a seed
├── ConstraintProviderGetter - Returns ConstraintProvider for a seed
└── ... (12+ additional getters for seed-scoped providers)

Privileged Providers (bypass RBAC for admin operations):
├── PrivilegedProjectProvider
├── PrivilegedSSHKeyProvider
├── PrivilegedServiceAccountProvider
└── PrivilegedServiceAccountTokenProvider
```

**Provider Implementation**: `pkg/provider/kubernetes/`

Most providers are implemented as Kubernetes client wrappers:
- Read/write Kubernetes custom resources (CRDs)
- Use impersonation clients for RBAC enforcement
- Query controller-runtime cache for reads

**Example**:
```go
// ClusterProvider methods
type ClusterProvider interface {
    New(ctx, project, userInfo, cluster) (*kubermaticv1.Cluster, error)
    List(ctx, project, userInfo) ([]*kubermaticv1.Cluster, error)
    Get(ctx, project, userInfo, clusterID) (*kubermaticv1.Cluster, error)
    Update(ctx, project, userInfo, cluster) (*kubermaticv1.Cluster, error)
    Delete(ctx, project, userInfo, clusterID) error
}
```

### 3. Middleware Pattern (Request Enhancement)

**Location**: `pkg/handler/middleware/middleware.go`

Middleware functions wrap HTTP handlers to:
- Extract and verify tokens
- Perform RBAC checks
- Inject context values (user info, cluster provider, etc.)
- Validate request parameters

**Key Middleware**:
- Token extraction/verification (OIDC + JWT service accounts)
- User context injection
- RBAC evaluation
- Cluster provider attachment
- Admin checks

### 4. Authentication Pattern

**Location**: `pkg/handler/auth/` and `pkg/provider/auth/`

Two authentication mechanisms:
1. **OIDC (OpenID Connect)**: For UI users
   - Token issued by external provider
   - Verified against issuer's public key
   - Also supports issuer role (internal KKP OAuth provider)

2. **Service Account JWT**: For programmatic access
   - Signed with shared secret
   - Token embedded in bearer Authorization header
   - Custom claims include service account name/namespace

**Flow**:
```
Request → TokenExtractor (from header/cookie/query) 
        → TokenVerifier (OIDC or JWT) 
        → UserInfo injection into context
        → Handler processing
```

### 5. Impersonation Pattern (RBAC Enforcement)

**Location**: `pkg/provider/kubernetes/impersonation_client.go`

For non-privileged operations, the API creates "impersonated" Kubernetes clients:

```go
// Instead of API server credentials, use client impersonating the user
client := impersonationClient.CreateImpersonatedClient(userInfo.Email)
// This client's requests include: Impersonate-User: user@example.com
// Kubernetes API server enforces RBAC based on this header
```

This ensures:
- Only users' own resources can be accessed
- RBAC policies naturally enforced by Kubernetes
- No custom authorization logic needed

## API Versions and Routing

### V1 API (`/api/v1/*`)

**Location**: `pkg/handler/v1/`, `pkg/api/v1/`

Legacy REST API with separate handler functions per HTTP method:
- GET `/api/v1/projects` - List user's projects
- POST `/api/v1/projects` - Create project
- GET `/api/v1/projects/{projectID}/clusters` - List clusters in project
- DELETE `/api/v1/projects/{projectID}` - Delete project
- WebSocket `/api/v1/projects/{projectID}/clusters/{clusterID}/logs` - Stream logs

**Resource Handlers**:
```
addon/              cluster/            dc/                 label/
node/               presets/            project/            seed/
serviceaccount/     ssh/                user/
admin/              (admin-only routes)
```

### V2 API (`/api/v2/*`)

**Location**: `pkg/handler/v2/`, `pkg/api/v2/`

Newer unified API with consistent patterns across resources:
- RESTful design with consistent CRUD operations
- Support for additional features like:
  - Cluster backups (EE only)
  - Resource quotas (EE only)
  - Kyverno policies (EE only)
  - Constraint templates
  - Applications

**Resource Handlers** (42+ resources):
```
addon/                     alertmanager/              application_definition/
application_installation/  cluster/                   cluster_template/
clusterbackup/            constraint/                constraint_template/
etcdbackupconfig/         etcdrestore/               allowed_registry/
... (many more)
```

## Enterprise Edition (EE) vs Community Edition (CE)

The codebase supports both editions using Go build tags:

### Build Tag System

```go
//go:build ee    // Included in EE builds only (KUBERMATIC_EDITION=ee)
//go:build !ee   // Included in CE builds only
```

### Makefile Build

```makefile
KUBERMATIC_EDITION ?= ee
go build -tags "$(KUBERMATIC_EDITION)" -o $@ ./cmd/$*
```

### CE-Only Components

**Location**: `cmd/kubermatic-api/wrappers_ce.go`

In CE mode, these providers are stubbed to return `nil`:
- `resourceQuotaProviderFactory()` - Resource quota enforcement
- `groupProjectBindingFactory()` - Group-based project access
- `backupStorageProviderFactory()` - Backup storage configuration
- `policyTemplateProviderFactory()` - Policy template management

### EE-Only Components

**Location**: `pkg/ee/` and `cmd/kubermatic-api/wrappers_ee.go`

EE-specific packages:
```
ee/
├── clusterbackup/              # Backup/restore operations
├── resource-quota/             # Quota enforcement
├── group-project-binding/      # Group-based access control
├── kyverno/                    # Policy management
├── metering/                   # Usage tracking
└── provider/                   # EE-specific providers
```

### Implementation Pattern

Wrapper functions in `main.go` are overridden per edition:

```go
// CE version (wrappers_ce.go)
func resourceQuotaProviderFactory(...) provider.ResourceQuotaProvider {
    return nil  // Not available
}

// EE version (wrappers_ee.go)
func resourceQuotaProviderFactory(...) provider.ResourceQuotaProvider {
    return eeapi.ResourceQuotaProviderFactory(...)  // Full implementation
}
```

## Key Concepts

### Seeds (Kubernetes Clusters)

**Definition**: A "Seed" is a Kubernetes cluster that hosts user clusters (via KubeVirt or similar).

**Location**: Kubermatic CRD `kubermaticv1.Seed`

The API needs to:
1. Discover available seeds via `SeedsGetter`
2. Get kubeconfig for each seed via `SeedKubeconfigGetter`
3. Create seed-specific providers via getters (e.g., `ClusterProviderGetter`)

**Example Flow**:
```
Client request for clusters in project X
→ Get all seeds
→ For each seed: create ClusterProvider
→ List clusters on each seed
→ Combine and return to client
```

### Projects

**Definition**: Logical namespace for resources owned by users/teams.

**Hierarchy**:
```
Kubermatic Installation
└── Project (team/org)
    ├── Cluster A
    ├── Cluster B
    └── Resources (users, SSH keys, etc.)
```

### User Context

Throughout the request, user information is maintained in context:

```go
type UserInfo struct {
    Email         string         // User identifier
    Name          string
    Groups        []string       // OIDC groups
    IsAdmin       bool
    AdminTools    bool
}
```

Used by middleware to:
- Enforce RBAC via impersonation clients
- Track resource ownership
- Log audit information

### Privileged Operations

Some operations bypass user RBAC (admin-only):
- Creating/deleting projects
- Modifying KubermaticConfiguration
- Accessing all users' SSH keys

These use "privileged" providers that don't impersonate the user.

## Key Technologies

- **Gorilla Mux**: HTTP routing
- **Go-Kit**: Endpoint abstraction (request → response)
- **Controller-Runtime**: Kubernetes client, caching, informers
- **Prometheus**: Metrics
- **Zap**: Structured logging
- **OIDC** (go-oidc): OpenID Connect authentication
- **JWT**: Service account tokens

## Configuration and Flags

Important command-line flags:

```
-address                           Listen address (default: :8080)
-ca-bundle                         CA certificate bundle path (required)
-oidc-url                          OIDC provider URL
-oidc-authenticator-client-id      Client ID for user auth
-oidc-issuer-client-id             Client ID for issuer role (EE)
-oidc-issuer-client-secret         Issuer client secret (EE)
-oidc-issuer-redirect-uri          Callback URL (EE)
-service-account-signing-key       JWT signing key
-feature-gates                     Feature gate configuration
-kubermatic-configuration-file     Config file (development only)
-namespace                         Kubermatic namespace
```

## Common Patterns

### Adding a New Endpoint

1. Create handler function in `pkg/handler/v1/resource/` or `pkg/handler/v2/resource/`
2. Create endpoint.Endpoint via factory function
3. Define Request/Response types in `pkg/api/v1/` or `pkg/api/v2/`
4. Add route registration in `routing.go` or `v2.go`
5. Use appropriate middleware for auth/RBAC

### Adding a New Provider

1. Define interface in `pkg/provider/types.go`
2. Implement in `pkg/provider/kubernetes/`
3. Instantiate in `createInitProviders()` in `main.go`
4. Inject into routing parameters
5. Use in handlers

### Adding EE-Only Feature

1. Create handler wrapper in `pkg/handler/v2/resource/wrappers_ee.go`
2. Create CE stub in `pkg/handler/v2/resource/wrappers_ce.go`
3. Call wrapper from main handler registration function
4. Feature gates can be checked: `if options.featureGates.Enabled(features.FeatureName)`

## Testing

- Unit tests alongside implementations (`*_test.go`)
- Handler tests use mock providers
- Integration tests in `pkg/test/`
- Build test: `go test -tags "$(KUBERMATIC_EDITION)" -run nope ./pkg/... ./cmd/...`

## Metrics and Monitoring

- Prometheus metrics exposed on internal address (default: 127.0.0.1:8085/metrics)
- HTTP request metrics: method, path, status code, duration
- Custom metrics in provider implementations

## Key Files to Understand

1. `cmd/kubermatic-api/main.go` - Server startup, provider initialization
2. `pkg/handler/routing.go` - Route registration, middleware setup
3. `pkg/handler/handler.go` - Error handling, JSON encoding
4. `pkg/provider/types.go` - Provider interfaces and function types
5. `pkg/handler/middleware/middleware.go` - Authentication and RBAC
6. `cmd/kubermatic-api/wrappers_*.go` - CE/EE feature branching

## Important Import Aliases

This codebase enforces strict import aliasing via golangci-lint. Always use these aliases:

### KKP API Packages
```go
import (
    apiv1 "k8c.io/kubermatic/sdk/v2/api/v1"
    apiv2 "k8c.io/kubermatic/sdk/v2/api/v2"
    appskubermaticv1 "k8c.io/kubermatic/sdk/v2/apis/apps.kubermatic/v1"
    kubermaticv1 "k8c.io/kubermatic/sdk/v2/apis/kubermatic/v1"
    utilerrors "k8c.io/kubermatic/v2/pkg/util/errors"
    authtypes "k8c.io/dashboard/v2/pkg/provider/auth/types"
)
```

### Kubernetes Packages
```go
import (
    corev1 "k8s.io/api/core/v1"
    appsv1 "k8s.io/api/apps/v1"
    rbacv1 "k8s.io/api/rbac/v1"
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
    apierrors "k8s.io/apimachinery/pkg/api/errors"
    kerrors "k8s.io/apimachinery/pkg/util/errors"
    ctrlruntimeclient "sigs.k8s.io/controller-runtime/pkg/client"
)
```

### Other Packages
```go
import (
    clusterv1alpha1 "k8c.io/machine-controller/sdk/apis/cluster/v1alpha1"
    semverlib "github.com/Masterminds/semver/v3"
)
```

**Note**: The linter enforces these aliases and will fail if you use different ones or import without aliases where required.

## Development Tips

1. Use the Makefile: `make build` (builds with default EE)
2. Build CE version: `make build KUBERMATIC_EDITION=ce`
3. Most configuration is via CLI flags or kubeconfig
4. Use `-kubermatic-configuration-file` for local development
5. Logging is structured (zap), grep with field names like `"error"` or `"seed"`
6. Provider calls respect context deadlines, use context with timeout
7. Always check for privileged operations needed vs user-scoped operations
8. Always use the correct import aliases (see above) - the linter will catch incorrect aliases
9. When adding new API endpoints, follow the existing patterns in v1 or v2 handlers
10. Test both CE and EE builds when making changes that could affect edition-specific code
