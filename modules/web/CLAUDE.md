# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Kubermatic Dashboard, an Angular web application for managing Kubernetes clusters through the Kubermatic Kubernetes Platform. The codebase supports two editions:
- **Community Edition (CE)**: Open-source version with core features
- **Enterprise Edition (EE)**: Premium version with additional features for large-scale deployments (>50 clusters)

## Development Commands

### Starting the Development Server

```bash
# Start with default edition (EE) on localhost
npm start

# Start with local API proxy (connects to local backend at 127.0.0.1:8080)
npm run start:local

# Start with specific edition (CE or EE)
KUBERMATIC_EDITION=ce npm start
KUBERMATIC_EDITION=ee npm start

# Start for E2E testing
npm run start:e2e          # Standard E2E mode
npm run start:e2e:local    # E2E with local API
npm run start:e2e:mock     # E2E with mock server
```

### Building

```bash
# Production build (uses $KUBERMATIC_EDITION env var, defaults to EE)
npm run build

# Build with specific edition
KUBERMATIC_EDITION=ce npm run build
KUBERMATIC_EDITION=ee npm run build

# Build and extract themes
npm run build:themes
```

### Testing

```bash
# Run Jest unit tests
npm test

# Run Jest tests in watch mode
npm run test:watch

# Run Jest tests with coverage (CI mode)
npm run test:ci

# Run Cypress E2E tests
npm run e2e              # Against e2e server
npm run e2e:local        # Against local backend
npm run e2e:mock         # Against mock server
npm run cy               # Run Cypress directly
```

### Code Quality & Linting

```bash
# Run all checks
npm run check

# Individual checks
npm run check:ts                    # TypeScript/ESLint
npm run check:scss                  # SCSS linting
npm run check:dependency-licenses   # License compliance

# Auto-fix issues
npm run fix              # Fix all (TS, SCSS, HTML, licenses)
npm run fix:ts           # Fix TypeScript with gts
npm run fix:scss         # Fix SCSS with stylelint
npm run fix:html         # Fix HTML with beautifier
npm run fix:license      # Add license headers (year 2025)

# Formatting
npm run format           # Format with ESLint and Prettier
npm run format:eslint    # ESLint auto-fix
npm run format:prettier  # Prettier formatting
```

## Architecture

### Edition-Specific Code (Dynamic Modules)

The codebase uses a dynamic module system to support both CE and EE editions:

- **Module Registry**: `src/app/dynamic/module-registry.ts` (EE) and `module-registry.ce.ts` (CE)
  - During build, the appropriate registry is selected via Angular `fileReplacements`
  - EE modules are lazy-loaded only in Enterprise builds
  - CE builds exclude `src/app/dynamic/enterprise/**` via TypeScript config

- **Enterprise-Only Modules** (`src/app/dynamic/enterprise/`):
  - Theming
  - Allowed Registries
  - Metering
  - Quotas
  - Group Management
  - Cluster Backups
  - Kyverno Policies

- **Build Configuration**:
  - `src/tsconfig.ee.json`: Excludes `app/dynamic/community/**`
  - `src/tsconfig.ce.json`: Excludes `app/dynamic/enterprise/**`
  - Set `KUBERMATIC_EDITION=ce` or `KUBERMATIC_EDITION=ee` to control which edition is built

### Directory Structure

```
src/app/
├── core/                    # Core services, interceptors, guards
│   ├── components/          # Core UI components (navigation, etc.)
│   ├── interceptors/        # HTTP interceptors
│   └── services/            # Singleton services (auth, user, API clients)
│       └── auth/            # Authentication service & guards
├── shared/                  # Shared utilities, components, models
│   ├── components/          # Reusable UI components (~50+ components)
│   ├── entity/              # Data models and entities
│   ├── model/               # TypeScript interfaces/types
│   ├── pipes/               # Angular pipes
│   ├── directives/          # Custom directives
│   ├── validators/          # Form validators
│   ├── utils/               # Utility functions
│   ├── functions/           # Helper functions
│   └── constants/           # Application constants
├── dynamic/                 # Edition-specific modules (CE/EE)
│   ├── enterprise/          # EE-only features (excluded in CE builds)
│   ├── community/           # CE-only features (excluded in EE builds)
│   ├── module-registry.ts   # EE module registry
│   └── module-registry.ce.ts # CE module registry
├── wizard/                  # Cluster creation wizard
├── external-cluster-wizard/ # External cluster import wizard
├── kubeone-wizard/          # KubeOne cluster wizard
├── cluster/                 # Cluster management (list, details)
├── cluster-template/        # Cluster template management
├── project/                 # Project CRUD
├── project-overview/        # Project dashboard/overview
├── member/                  # Member & group management
├── serviceaccount/          # Service account management
├── sshkey/                  # SSH key management
├── backup/                  # Backup management
├── node-data/               # Node configuration forms
├── machine-networks/        # Machine network configuration
├── dashboard/               # Main dashboard component
├── pages/                   # Static pages (frontpage, 404, etc.)
├── settings/                # User and admin settings
│   ├── admin/               # Admin-only settings
│   └── user/                # User-specific settings
├── module.ts                # Root application module
└── routing.ts               # Application routing configuration
```

### Key Concepts

#### Component Naming Convention
- Component prefix: `km-` (e.g., `selector: 'km-clusters'`)
- Template files: `template.html` (not `component.html`)
- Component files: `component.ts` (with corresponding `component.spec.ts`)

#### Routing & Lazy Loading
- Feature modules are lazy-loaded via Angular's dynamic imports
- Project-scoped routes follow pattern: `/projects/:projectID/<feature>`
- Admin routes use `AdminGuard` for access control
- SSH key routes use `SSHKeyGuard`

#### State Management
- Services in `src/app/core/services/` manage application state
- RxJS observables for reactive data flow
- HTTP interceptors handle authentication tokens and error handling

#### API Communication
- Services use Angular HttpClient with RxJS operators
- API proxy configuration in `proxy-local.conf.cjs` (proxies `/api/**` to `http://127.0.0.1:8080/`)
- Environment-specific configurations in `src/environments/`

#### Theming
- Multiple theme support: light, dark, and custom
- Theme bundles built separately (see `angular.json` styles configuration)
- Themes located in `src/assets/themes/`
- SCSS preprocessor with includes from `src/assets/css/` and `node_modules/`

### Testing Strategy

#### Jest Unit Tests
- Configuration: `jest.config.cjs`
- Test setup: `src/test.base.ts` and `src/test.base.mocks.ts`
- Path aliases configured:
  - `@app/*` → `src/app/*`
  - `@core/*` → `src/app/core/*`
  - `@shared/*` → `src/app/shared/*`
  - `@environments/*` → `src/environments/*`
  - `@test/*` → `src/test/*`
- Use these aliases in imports for consistency

#### Cypress E2E Tests
- Test files: `cypress/e2e/`
- Page objects: `cypress/pages/`
- Mock data: `cypress/fixtures/`
- Network intercepts: `cypress/intercept/`
- Support files: `cypress/support/`
- Can run against real backend, local backend, or mock server

### Important Files

- `package.json`: Scripts, dependencies, lint-staged configuration
- `angular.json`: Angular CLI configuration with build targets for CE/EE editions
- `tsconfig.json`: Base TypeScript configuration
- `src/tsconfig.ee.json`: Enterprise edition TypeScript config
- `src/tsconfig.ce.json`: Community edition TypeScript config (extends EE config)
- `jest.config.cjs`: Jest test configuration
- `proxy-local.conf.cjs`: Local development proxy configuration
- `version.js`: Generates version info (runs via `npm run vi`)
- `.husky/`: Git hooks configuration (managed from repository root)

## Development Workflow

### Adding a New Feature

1. Determine if the feature is CE or EE-specific
   - CE features: Add to `src/app/dynamic/community/` or shared areas
   - EE features: Add to `src/app/dynamic/enterprise/`
   - Shared features: Add to appropriate feature module

2. For EE-only features:
   - Create module in `src/app/dynamic/enterprise/<feature>/`
   - Register in `module-registry.ts` with lazy import
   - Feature will be automatically excluded from CE builds

3. Update routing if needed in `src/app/routing.ts`

4. Add tests in corresponding `.spec.ts` files

5. Run linting and tests before committing

### Running Single Test File

```bash
# Jest
npm test -- path/to/test.spec.ts

# Cypress (via Cypress UI)
npx cypress open
```

### Git Hooks

The project uses Husky for git hooks (configured at repository root level: `../../.husky/`). Pre-commit hook runs:
- `gts fix` on `*.ts` files
- `stylelint --fix` on `*.scss` files
- `html-beautify` on `*.html` files

### License Headers

All source files must have Apache 2.0 license headers. Use `npm run fix:license` to add missing headers.

## Common Pitfalls

1. **Edition Confusion**: Always check if you're working in CE or EE context. Don't import EE modules in CE code paths.

2. **Path Aliases**: Use Jest path aliases (`@app/`, `@core/`, `@shared/`) consistently in imports.

3. **Environment Variables**:
   - `KUBERMATIC_EDITION`: Controls which edition to build/serve (ce/ee, defaults to ee)
   - `KUBERMATIC_HOST`: Development server host (defaults to localhost)

4. **Template Location**: Templates are named `template.html`, not `component.html`.

5. **Proxy Configuration**: When developing against a local backend, use `:local` variants of npm scripts (e.g., `npm run start:local`) which apply `proxy-local.conf.cjs`.

6. **Build Output**: The `dist/` directory contains the production build output.

7. **Node Version**: Requires Node.js >=20.0.0 and npm >=10.0.0 (see `package.json` engines).
