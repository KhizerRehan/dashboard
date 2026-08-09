# Kubermatic Dashboard - Architecture & Technical Patterns

This document provides a comprehensive guide to the Kubermatic Dashboard codebase, detailing high-level architecture, design patterns, and key technical implementations.

## Project Overview

The Kubermatic Dashboard is an Angular-based web application that provides a comprehensive UI for the Kubermatic Kubernetes Platform (KKP). It supports both Community Edition (CE) and Enterprise Edition (EE) builds, with features and functionality dynamically loaded based on the edition.

**Key Tech Stack:**
- Angular 20.3.x
- TypeScript
- RxJS 7.8.x for reactive programming
- Angular Material for UI components
- Jest for unit testing
- Cypress for e2e testing

## Directory Structure

```
modules/web/
├── src/
│   ├── app/
│   │   ├── core/                    # Core services, guards, interceptors
│   │   ├── shared/                  # Shared components, pipes, validators
│   │   ├── dynamic/                 # Edition-specific modules (CE/EE)
│   │   ├── wizard/                  # Cluster creation wizard
│   │   ├── cluster/                 # Cluster management
│   │   ├── project/                 # Project management
│   │   ├── member/                  # Project members
│   │   ├── settings/                # Admin & user settings
│   │   ├── pages/                   # Static pages (404, etc.)
│   │   ├── routing.ts               # Main routing configuration
│   │   ├── module.ts                # Root app module
│   │   └── component.ts             # Root app component
│   ├── test/                        # Unit test utilities & mocks
│   ├── environments/                # Environment configurations
│   └── assets/                      # Static assets
├── cypress/                         # E2E tests
│   ├── e2e/                        # Test specifications
│   ├── intercept/                  # API response mocking
│   ├── pages/                      # Page object models
│   └── support/                    # Custom commands & utilities
├── angular.json                    # Angular CLI configuration (CE/EE configs)
├── jest.config.cjs                # Jest configuration
├── cypress.config.ts              # Cypress configuration
└── package.json                   # NPM dependencies & scripts
```

## 1. Module Organization: CE/EE Edition Handling

### Dynamic Module Registry Pattern

The dashboard implements a sophisticated build-time file replacement strategy to handle CE/EE editions:

**Location:** `/Users/mac/Work/Github/kubermatic/dashboard/modules/web/src/app/dynamic/`

**Files:**
- `module-registry.ts` - **EE Default** (lines 1-35)
- `module-registry.ce.ts` - **CE Version** (lines 1-28)

**How It Works:**

1. **Build Configuration** (`angular.json`):
   - Production EE builds: Uses `module-registry.ts` (default)
   - Production CE builds: Replaces `module-registry.ts` with `module-registry.ce.ts`
   - Configuration lines show CE/EE fileReplacements:
     ```
     "production-ce": {
       "fileReplacements": [
         {"replace": "src/app/dynamic/module-registry.ts",
          "with": "src/app/dynamic/module-registry.ce.ts"}
       ]
     }
     ```

2. **Module Registry Pattern** (EE version at lines 20-35):
   ```typescript
   export namespace DynamicModule {
     export const Theming = import('./enterprise/theming/module');
     export const AllowedRegistries = import('./enterprise/allowed-registries/module');
     export const Metering = import('./enterprise/metering/module');
     export const Quotas = import('./enterprise/quotas/module');
     export const Group = import('./enterprise/group/module');
     export const ClusterBackups = import('./enterprise/cluster-backups/module');
     export const KyvernoPolicies = import('./enterprise/kyverno-policies/module');
     export const isEnterpriseEdition = true;
   }
   ```

3. **CE Version** (lines 17-28 of module-registry.ce.ts):
   ```typescript
   export namespace DynamicModule {
     export const Theming = import('./community/theming/module');
     export const AllowedRegistries = import('./community/allowed-registries/module');
     // ... (identical names, different paths)
     export const isEnterpriseEdition = false;
   }
   ```

4. **Runtime Edition Check** (`common.ts`, lines 17-19):
   ```typescript
   export function isEnterpriseEdition(): boolean {
     return version.edition === 'Enterprise Edition';
   }
   ```

### Dynamic Module Usage in Routing

**Location:** `/Users/mac/Work/Github/kubermatic/dashboard/modules/web/src/app/routing.ts`

Routes load edition-specific modules dynamically (lines 103-119):
```typescript
{
  path: `projects/:projectID/${View.ClusterBackup}`,
  loadChildren: () => DynamicModule.ClusterBackups,  // CE or EE version
}
```

### Edition-Specific Features

**Enterprise Edition Modules:**
- `/app/dynamic/enterprise/quotas/` - Resource quota management
- `/app/dynamic/enterprise/group/` - User groups
- `/app/dynamic/enterprise/cluster-backups/` - Backup/restore functionality
- `/app/dynamic/enterprise/kyverno-policies/` - Policy management
- `/app/dynamic/enterprise/metering/` - Usage metering

**Community Edition Modules:**
- `/app/dynamic/community/` - Lightweight stub implementations

## 2. Core Architecture Patterns

### 2.1 Routing Architecture

**File:** `/Users/mac/Work/Github/kubermatic/dashboard/modules/web/src/app/routing.ts`

**Key Patterns:**

1. **Lazy Loading** (lines 38-99):
   - All feature modules use lazy loading via `loadChildren`
   - Reduces initial bundle size
   - Example:
     ```typescript
     {
       path: 'projects/:projectID/wizard',
       loadChildren: () => import('./wizard/module').then(m => m.WizardModule)
     }
     ```

2. **Preloading Strategy** (lines 24-28):
   ```typescript
   class SelectedPreloadingStrategy implements PreloadingStrategy {
     preload(route: Route, load: () => Observable<any>): Observable<any> {
       return route.data && route.data['preload'] ? load() : of(null);
     }
   }
   ```
   - Routes marked with `data: {preload: true}` are preloaded
   - User account settings preloaded for faster access (line 124)

3. **Wildcard Routing** (lines 138-140):
   ```typescript
   {path: '**', redirectTo: '404'}
   ```

### 2.2 State Management Architecture

The dashboard uses **RxJS observables and services** as the primary state management pattern, with no centralized state management library (Redux/NgRx).

**Core Patterns:**

1. **Observable-Based Services** (`/app/core/services/`)
   - Services expose observables via getter methods
   - Services cache observables to avoid duplicate requests
   - Example: ClusterService (lines 77-87):
     ```typescript
     private _cluster$ = new Map<string, Observable<Cluster>>();
     
     projectClusterList(projectID: string): Observable<ProjectClusterList> {
       if (!this._projectClusterList$.get(projectID)) {
         const clusters$ = merge(this._onClustersUpdate, this._refreshTimer$)
           .pipe(switchMapTo(this._getClusters(projectID)))
           .pipe(shareReplay({refCount: true, bufferSize: 1}));
         this._projectClusterList$.set(projectID, clusters$);
       }
       return this._projectClusterList$.get(projectID);
     }
     ```

2. **Refresh Timer Pattern** (ClusterService, line 59):
   ```typescript
   private _refreshTimer$ = timer(0, this._appConfig.getRefreshTimeBase() * this._refreshTime);
   ```
   - Automatically refreshes data every 10 refresh intervals
   - Uses `merge()` to combine manual updates with timer triggers
   - Uses `switchMapTo()` to cancel pending requests on new events

3. **Event-Based Updates**:
   - Services emit Subject events for state changes
   - Example: `onClustersUpdate`, `onExternalClustersUpdate` (ClusterService lines 60-61)
   - Components subscribe to these updates via observables

### 2.3 Service Organization

**Location:** `/Users/mac/Work/Github/kubermatic/dashboard/modules/web/src/app/core/services/`

**Core Service Categories:**

1. **API Services:**
   - `cluster.ts` - Cluster CRUD operations
   - `cluster-backup.ts` - Backup/restore management
   - `project.ts` - Project management
   - `member.ts` - Project member management
   - `node.ts` - Node operations
   - `machine-deployment.ts` - Machine deployment operations

2. **Feature Services:**
   - `rbac.ts` - RBAC service
   - `opa.ts` - OPA constraints
   - `mla.ts` - Multi-Level Authentication
   - `addon.ts` - Add-on management
   - `label.ts` - Label management

3. **Provider Services** (`/services/provider/`):
   - `aws.ts`, `azure.ts`, `gcp.ts` - Cloud provider implementations
   - `openstack.ts`, `vsphere.ts` - Infrastructure providers
   - `kubevirt.ts`, `nutanix.ts` - VM hypervisors
   - Each provider has specific settings and validation logic

4. **Utility Services:**
   - `auth/service.ts` - Authentication & token management
   - `datacenter.ts` - Datacenter configuration
   - `notification.ts` - Toast notifications
   - `history.ts` - Navigation history
   - `params.ts` - Route parameters management
   - `page-title.ts` - Dynamic page title updates

### 2.4 HTTP Interceptors

**Location:** `/Users/mac/Work/Github/kubermatic/dashboard/modules/web/src/app/core/interceptors/`

**Files:**
- `auth.ts` - Bearer token injection
- `error-notifications.ts` - Error handling & user notifications
- `check-token.ts` - Token validation
- `loader.ts` - Loading indicator management
- `index.ts` - Barrel export

**Registration** (core/module.ts lines 153-174):
```typescript
const interceptors = [
  {provide: HTTP_INTERCEPTORS, useClass: ErrorNotificationsInterceptor, multi: true},
  {provide: HTTP_INTERCEPTORS, useClass: CheckTokenInterceptor, multi: true},
  {provide: HTTP_INTERCEPTORS, useClass: LoaderInterceptor, multi: true},
  {provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true},
];
```

**Key Interceptor Patterns:**

1. **AuthInterceptor** (lines 27-41):
   - Injects Bearer token into requests to API endpoints
   - Only adds token to requests matching `environment.restRoot`

2. **ErrorNotificationsInterceptor** (error-notifications.ts):
   - Catches HTTP errors and displays user-friendly notifications
   - Maintains error message mapping for credential/auth errors (lines 54-60)
   - Silences certain error messages via array patterns (lines 42-52)

3. **LoaderInterceptor** (loader.ts):
   - Shows loading spinner on request start
   - Hides spinner on response/error

## 3. Key Technical Patterns

### 3.1 Wizard/Multi-Step Form Pattern

The dashboard implements a sophisticated multi-step cluster creation wizard used for:
- Standard cluster creation
- External cluster integration
- KubeOne cluster setup

**Location:** `/Users/mac/Work/Github/kubermatic/dashboard/modules/web/src/app/wizard/`

**Architecture:**

1. **Wizard Component** (component.ts, lines 48-86):
   ```typescript
   @Component({
     selector: 'km-wizard',
     templateUrl: './template.html',
     changeDetection: ChangeDetectionStrategy.OnPush,
   })
   export class WizardComponent implements OnInit, OnDestroy {
     form: FormGroup;
     @ViewChild('stepper') set matStepper(stepper: MatStepper) {
       if (stepper) {
         this._stepper = stepper;
         this.initializeWizard();
       }
     }
   }
   ```
   - Uses Angular Material Stepper for visual progression
   - Reactive Forms for validation
   - ChangeDetectionStrategy.OnPush for performance

2. **Step Configuration** (config.ts, lines 15-54):
   ```typescript
   export class WizardStep {
     name: string;
     enabled: boolean;
     get id(): string { return this.name.toLowerCase().replace(' ', '-'); }
     static newWizardStep(name: string, enabled = true): WizardStep {
       return new WizardStep(name, enabled);
     }
   }

   export enum StepRegistry {
     Provider = 'Provider',
     Cluster = 'Cluster',
     ProviderSettings = 'Settings',
     NodeSettings = 'Initial Nodes',
     MachineNetwork = 'Machine Network',
     Applications = 'Applications',
     Summary = 'Summary',
   }

   export const steps: WizardStep[] = [
     WizardStep.newWizardStep(StepRegistry.Provider),
     WizardStep.newWizardStep(StepRegistry.Cluster),
     // ...
   ];
   ```

3. **Step Base Class** (step/base.ts):
   ```typescript
   @Directive()
   export class StepBase extends BaseFormValidator {
     constructor(
       protected readonly _wizard: WizardService,
       formName = 'Form'
     ) {
       super(formName);
     }

     control(name: string): AbstractControl {
       return this.form.controls[name];
     }

     next(): void {
       this._wizard.stepper.next();
     }

     enable(enable: boolean, name: string): void {
       // Control enable/disable logic
     }
   }
   ```
   - Base class for all wizard steps
   - Extends BaseFormValidator for form validation
   - Provides common control methods
   - Handles step navigation

4. **Step Hierarchy:**
   ```
   wizard/step/
   ├── applications/       # Application selection
   ├── base.ts            # Base step class
   ├── cluster/           # Cluster naming & settings
   ├── network/           # Network configuration
   ├── node-settings/     # Node configuration
   ├── provider-settings/ # Provider-specific settings
   ├── provider-datacenter/ # Datacenter selection
   └── summary/           # Review & create
   ```

5. **Wizard Service Integration** (core/services/wizard/wizard.ts):
   - Manages step state transitions
   - Validates step completion before allowing next
   - Coordinates data collection across steps

6. **Smart Step Filtering** (component.ts, lines 96-100):
   ```typescript
   get steps(): WizardStep[] {
     return steps
       .filter(step => step.enabled)
       .filter(step => !(this.clusterTemplateID && step.name === StepRegistry.Provider));
   }
   ```
   - Dynamically enables/disables steps based on conditions
   - Example: Provider step skipped when creating from template

7. **Presets Service** (core/services/wizard/presets.ts, lines 44-75):
   ```typescript
   @Injectable()
   export class PresetsService {
     readonly presetStatusChanges = new EventEmitter<boolean>();
     readonly presetChanges = new EventEmitter<string>();
     readonly presetDetailedChanges = new EventEmitter<Preset>();

     get preset(): string { return this._preset; }
     set preset(preset: string) {
       this._preset = preset;
       this.presetChanges.next(preset);
     }
   }
   ```
   - Manages cloud provider credentials presets
   - EventEmitter-based communication with wizard steps
   - Lazy-loads provider-specific preset implementations

### 3.2 API Calls & HTTP Pattern

**Service Method Pattern** (ClusterService, lines 77-87):

```typescript
projectClusterList(projectID: string): Observable<ProjectClusterList> {
  if (!this._projectClusterList$.get(projectID)) {
    const clusters$ = merge(this._onClustersUpdate, this._refreshTimer$).pipe(
      switchMapTo(this._getClusters(projectID, showMachineDeploymentCount)),
      shareReplay({refCount: true, bufferSize: 1})
    );
    this._projectClusterList$.set(projectID, clusters$);
  }
  return this._projectClusterList$.get(projectID);
}

private _getClusters(projectID: string): Observable<ProjectClusterList> {
  const url = `${this._restRoot}/projects/${projectID}/clusters`;
  return this._http.get<ProjectClusterList>(url);
}
```

**Key RxJS Operators Used:**
- `merge()` - Combine multiple sources
- `switchMapTo()` - Cancel previous requests on new trigger
- `shareReplay()` - Cache results with automatic cleanup
- `switchMap()` - Map values and flatten observables
- `tap()` - Side effects (logging, etc.)
- `catchError()` - Error handling with fallback
- `startWith()` - Emit initial value
- `filter()` - Conditional emissions
- `map()` - Transform values

**Error Handling Pattern** (ClusterService, line 186):
```typescript
return this._http.get<MasterVersion[]>(url)
  .pipe(catchError(() => of<MasterVersion[]>([])));
```
- Graceful degradation: returns empty array on error
- No error thrown to component

### 3.3 Core Module Initialization

**Location:** `/Users/mac/Work/Github/kubermatic/dashboard/modules/web/src/app/module.ts`

**Application Initializer Pattern** (lines 38-52):
```typescript
const appInitializerFn = (
  appConfigService: AppConfigService,
  historyService: HistoryService,
  userService: UserService,
  datacenterService: DatacenterService
): (() => Promise<{}>) => {
  return () => {
    historyService.init();
    userService.init();
    datacenterService.init();
    return appConfigService
      .loadAppConfig()
      .then(() => appConfigService.loadUserGroupConfig())
      .then(() => appConfigService.loadGitVersion());
  };
};

@NgModule({
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: appInitializerFn,
      multi: true,
      deps: [AppConfigService, HistoryService, UserService, DatacenterService],
    }
  ]
})
```

**Initialization Sequence:**
1. History service initialized (browser history tracking)
2. User service initialized (authentication state)
3. Datacenter service initialized (provider configurations)
4. App config loaded (feature flags, version info)
5. User group config loaded (RBAC groups)
6. Git version loaded (build metadata)

### 3.4 FormBuilder & Reactive Forms

The dashboard heavily uses Angular's Reactive Forms for:
- Wizard steps
- Entity creation/editing dialogs
- Filtering and search forms

**Pattern Example:**
```typescript
private _formBuilder: FormBuilder;

ngOnInit(): void {
  this.form = this._formBuilder.group({
    controlName: ['', [Validators.required, customValidator]],
    // ...
  });
}
```

## 4. Testing Approach

### 4.1 Unit Testing (Jest)

**Configuration:** `jest.config.cjs`

**Key Setup:**
- Preset: `jest-preset-angular`
- Test roots: `src/`
- Setup file: `src/test.base.ts`
- Module mapping for path aliases (@app, @core, @shared, etc.)

**Test Utilities Location:** `/Users/mac/Work/Github/kubermatic/dashboard/modules/web/src/test/`

**Structure:**
```
test/
├── components/      # Component test helpers
├── data/           # Mock data factories
├── services/       # Service mocks
│   ├── auth-mock.ts
│   ├── datacenter-mock.ts
│   ├── project-mock.ts
│   ├── user-mock.ts
│   ├── app-config-mock.ts
│   └── ...
├── types/          # Type definitions for tests
└── utils/          # Testing utilities
```

**Example Unit Test** (component.spec.ts, lines 36-50):
```typescript
describe('KubermaticComponent', () => {
  let fixture: ComponentFixture<KubermaticComponent>;
  let component: KubermaticComponent;
  let authService: AuthMockService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BrowserModule, HttpClientModule, NoopAnimationsModule, SharedModule, CoreModule, RouterTestingModule],
      declarations: [KubermaticComponent],
      providers: [
        {provide: Auth, useClass: AuthMockService},
        {provide: ProjectService, useClass: ProjectMockService},
        {provide: DatacenterService, useClass: DatacenterMockService},
        {provide: UserService, useClass: UserMockService},
        {provide: AppConfigService, useClass: AppConfigMockService},
      ],
    });

    fixture = TestBed.createComponent(KubermaticComponent);
    component = fixture.componentInstance;
    authService = TestBed.inject(Auth) as AuthMockService;
  });
});
```

**Testing Guidelines** (from Development.md, lines 69-79):
- Component tests located in same directory as component: `component.spec.ts`
- Test utilities and mocks in `src/test`
- Focus on shared components (src/app/shared)
- Cover conditional renders (loading states, etc.)
- Test event handling
- Avoid testing children separately (too deep)
- Avoid complex CSS queries (use IDs instead)
- Use e2e tests for complex scenarios
- Keep tests maintainable (not overengineered)

**Test Execution:**
```bash
npm test              # Run all tests
npm run test:watch   # Watch mode
npm run test:ci      # CI mode with coverage
```

### 4.2 E2E Testing (Cypress)

**Configuration:** `cypress.config.ts`

**Key Setup:**
- Base URL: `http://localhost:8000`
- Viewport: 1920x1080
- Timeouts: 60 seconds (page load, commands, requests)
- Retries: 2 attempts in run mode
- Video recording: Only for failures
- Test isolation: false (tests can depend on previous state)

**Features:**
```typescript
export default defineConfig({
  chromeWebSecurity: false,
  retries: {
    runMode: 2,
    openMode: 0,
  },
  pageLoadTimeout: 60000,
  defaultCommandTimeout: 60000,
  responseTimeout: 60000,
  requestTimeout: 60000,
  video: true,
  e2e: {
    setupNodeEvents(on, config) {
      const isAPIMocked = config.env.MOCKS === 'true';
      const isEnterpriseEdition = config.env.KUBERMATIC_EDITION === 'ee';
      // Conditionally run tests based on edition
    }
  }
});
```

**Test Structure:**
```
cypress/
├── e2e/              # Test specifications
│   ├── providers/    # Provider-specific flows (AWS, GCP, etc.)
│   └── v2/stories/   # Feature stories
├── intercept/        # API response mocking
│   ├── clusters.ts
│   ├── projects.ts
│   ├── root.ts
│   └── ...
├── pages/            # Page Object Models
│   ├── cluster-page.ts
│   ├── project-page.ts
│   └── ...
├── fixtures/         # Test data
│   ├── db.json      # Mock database
│   └── routes.json  # Mock API routes
└── support/
    ├── e2e.ts       # Global setup/hooks
    ├── paste.ts     # Custom commands
    └── paths.ts     # Path utilities
```

**Test Execution:**
```bash
npm run e2e:mock              # Mocked tests (no real API)
KUBERMATIC_EDITION=ee npm run e2e    # Against dev server
npm run cy                    # Direct cypress run (app must be running)
```

**Mocking System:**
```typescript
// cypress/support/e2e.ts (lines 19-26)
beforeEach(() => {
  if (Mocks.enabled()) {
    Mocks.register();  // Registers API intercepts
  }
});
```

**Mock Interception Pattern** (intercept/root.ts):
```typescript
cy.intercept('GET', '**/api/v2/kubeconfig', kubeconfig).as('getKubeconfig');
// ... Setup mock responses
// Tests can then assert: cy.get('@getKubeconfig').its('response.statusCode').should('equal', 200)
```

**Edition-Specific Test Filtering** (cypress.config.ts, lines 40-46):
```typescript
setupNodeEvents(on, config) {
  const isEnterpriseEdition = config.env.KUBERMATIC_EDITION === 'ee';
  const ignored: string[] = [
    runnableTestsRegex('service-accounts', 'edition', 'members'),
  ];
  config.excludeSpecPattern = ignored;
}
```

**Custom Cypress Commands** (support/e2e.ts, lines 31-39):
```typescript
declare global {
  namespace Cypress {
    interface Chainable {
      pasteFile(filename: string): Chainable;
      paste(text: string): Chainable;
    }
  }
}
Cypress.Commands.add('pasteFile', {prevSubject: 'element'}, pasteFile);
Cypress.Commands.add('paste', {prevSubject: 'element'}, paste);
```

## 5. Build & Deployment Configuration

### 5.1 Edition-Specific Builds

**Configuration:** `angular.json` (file replacements section)

**Build Configurations:**
- `default-ee` - Development EE
- `default-ce` - Development CE (replaces module-registry.ts)
- `production-ee` - Production EE
- `production-ce` - Production CE (replaces module-registry.ts + environment config)
- `e2e-ee`, `e2e-ce`, `e2e-local-ee`, `e2e-local-ce` - E2E testing
- `e2e-mock-ee`, `e2e-mock-ce` - Mocked E2E testing

**Build Scripts** (package.json, lines 14-22):
```bash
npm start                    # Dev with default edition (EE)
KUBERMATIC_EDITION=ce npm start   # Dev Community Edition
npm run build                # Production build
npm run e2e:mock            # Mocked end-to-end tests
npm run e2e                  # Full end-to-end tests
```

### 5.2 TypeScript Configurations

**Default:** `src/tsconfig.json`
**CE Override:** `src/tsconfig.ce.json`

The CE config is used during CE builds to handle any CE-specific type definitions.

## 6. Shared Module Architecture

**Location:** `/Users/mac/Work/Github/kubermatic/dashboard/modules/web/src/app/shared/`

**Components:**
- Reusable UI components (200+ components)
- Dialog components for CRUD operations
- Form components (inputs, selectors, autocomplete)
- Layout components (cards, expansion panels, tabs)
- Data visualization (charts, tables)

**Validators** (shared/validators/):
- Email validator
- IP address validator
- CIDR validator
- Custom rule validators

**Pipes**:
- Date formatting
- Size formatting (bytes to human-readable)
- Link location pipes

**Model/Entity Types** (shared/entity/):
- Cluster, ClusterSpec, ClusterStatus
- Node, MachineDeployment
- Project, Member
- Provider-specific types
- Health, Metrics
- Backup, Restore entities

**Utils** (shared/utils/):
- Common utility functions
- String manipulation
- Object utilities
- Array manipulation

## 7. Provider Implementation Pattern

**Location:** `/Users/mac/Work/Github/kubermatic/dashboard/modules/web/src/app/core/services/provider/`

Each cloud provider has:
- Service class (e.g., `aws.ts`) - API integration
- Type definitions (in shared/entity/provider/)
- Specific validation logic
- Preset credentials management
- Machine flavor fetching

**Supported Providers:**
- AWS, Azure, GCP
- OpenStack, VSphere, VMware Cloud Director
- KubeVirt, Nutanix
- DigitalOcean, Hetzner, Linode
- Alibaba Cloud, Anexia
- Baremetal (KubeAdm/BringYourOwn)

## 8. Authentication & Authorization

**Auth Service** (`core/services/auth/service.ts`):
- Manages bearer tokens
- Handles OIDC authentication
- Token refresh logic
- Login/logout flows

**Guards** (`core/services/auth/guard.ts`):
- `AuthGuard` - Requires authentication
- `AuthzGuard` - Requires authorization
- `AdminGuard` - Requires admin role
- `SSHKeyGuard` - Conditional SSH key requirements

**Token Interceptor:**
- Injects Authorization header on API requests
- Filters requests to only REST API endpoints

**Token Validation:**
- CheckTokenInterceptor validates token on each request
- Triggers re-authentication if token invalid

## 9. Configuration & Environment Management

**Environments:**
- `src/environments/environment.ts` - Development
- `src/environments/environment.prod.ts` - Production
- Edition-specific configs via angular.json file replacements

**App Configuration Service** (`config.service.ts`):
- Loads configuration at application startup (via APP_INITIALIZER)
- Provides feature flags
- Manages user group configuration
- Exposes build version information

**Version Management:**
- Auto-generated `src/assets/config/version.json` at build time
- Contains edition (CE/EE) and build metadata
- Generated by `version.js` script (package.json postinstall)

## 10. Component Communication Patterns

### Parent-Child Communication
- `@Input()` for data passing to children
- `@Output()` EventEmitters for child-to-parent events
- `@ViewChild()` for direct child component access

### Service-Based Communication
- Observables for data sharing
- Subjects for event broadcasting
- EventEmitters for component events

### Router-Based Communication
- Route parameters: `ActivatedRoute.params`
- Query parameters: `ActivatedRoute.queryParams`
- State passing via router navigation

## 11. Performance Optimizations

1. **Change Detection Strategy**:
   - Most components use `ChangeDetectionStrategy.OnPush`
   - Reduces unnecessary change detection runs

2. **Lazy Loading**:
   - All feature modules lazy loaded (routing.ts)
   - Reduces initial bundle size

3. **Observable Caching**:
   - Services cache observables (ClusterService pattern)
   - Uses `shareReplay()` to avoid duplicate requests
   - Automatic cleanup with `refCount: true`

4. **Preloading**:
   - Custom preload strategy (SelectedPreloadingStrategy)
   - User account settings preloaded automatically
   - Improves perceived performance

5. **OnPush Detection**:
   - Components explicitly mark dependencies
   - Manual ChangeDetectorRef.markForCheck() when needed

## 12. Common File Patterns & Naming

**Service File:**
```
service-name.ts
- Class: ServiceNameService
- Provider: Added to CoreModule or feature module
- Singleton pattern by default (providedIn: 'root')
```

**Component File Structure:**
```
feature-name/
├── component.ts        # Component class
├── component.html      # Template
├── component.scss      # Styles
├── component.spec.ts   # Unit tests
├── routing.ts         # Feature routing (if module)
└── module.ts          # Feature module (if lazy-loaded)
```

**Dialog Component:**
```
dialog-name/
├── component.ts       # Dialog component
└── component.html     # Dialog template
- Uses MatDialogConfig for configuration
- Returns data via dialogRef.close(data)
- Injected via MatDialog.open()
```

## 13. Key Dependencies

**Angular Ecosystem:**
- @angular/core, @angular/common
- @angular/forms (Reactive Forms)
- @angular/router
- @angular/cdk (CDK)
- @angular/material (Material Design components)

**Utilities:**
- lodash - Object/array utilities
- moment - Date manipulation
- js-yaml - YAML parsing
- rxjs - Reactive programming

**Visualization:**
- @swimlane/ngx-charts - Chart library
- monaco-editor - Code editor
- @xterm/xterm - Terminal emulator

**Testing:**
- jest - Unit testing
- jest-preset-angular - Angular integration
- cypress - E2E testing

## 14. Common Development Tasks

### Adding a New Feature
1. Create feature folder in app directory
2. Create `module.ts` with component declarations
3. Add routing in `routing.ts`
4. Create feature service in `core/services`
5. Add lazy-load route in `app/routing.ts`
6. Add unit tests (*.spec.ts)
7. Add e2e tests in cypress/e2e

### Adding a New Provider
1. Create service in `core/services/provider/provider-name.ts`
2. Define types in `shared/entity/provider/provider-name.ts`
3. Create wizard step component
4. Register in provider settings step
5. Add provider-specific validation
6. Add e2e tests

### Adding Edition-Specific Feature
1. Create in `dynamic/enterprise/feature-name/`
2. Create lightweight stub in `dynamic/community/feature-name/`
3. Update module-registry.ts and module-registry.ce.ts
4. Register route with DynamicModule in routing.ts
5. Feature automatically loads appropriate version at runtime

### Running Tests
```bash
# Unit tests
npm test                 # All tests once
npm run test:watch      # Watch mode
npm run test:ci         # CI mode with coverage

# E2E tests
npm run e2e:mock        # Mocked (no real API)
npm run e2e             # Against dev server
npm run e2e:local       # Against local API
```

## 15. Key Architectural Decisions & Trade-offs

1. **No Central State Management:**
   - Decision: Use RxJS observables + services instead of Redux/NgRx
   - Pro: Simpler, less boilerplate
   - Con: More subscription management, potential memory leaks if unsubscribed

2. **Edition Handling via File Replacement:**
   - Decision: Build-time module swapping instead of runtime checks
   - Pro: Clean separation, optimized builds, no runtime overhead
   - Con: Requires separate builds for CE/EE, duplicated feature code

3. **Lazy Loading All Features:**
   - Decision: All features lazy-loaded except core
   - Pro: Faster initial load, smaller main bundle
   - Con: More complex routing, lazy-load delay on first access

4. **Observable Caching with ShareReplay:**
   - Decision: Services cache observables to avoid duplicate HTTP requests
   - Pro: Automatic request deduplication, memory efficient
   - Con: Requires understanding of refCount and subscription lifecycle

5. **Material Design UI:**
   - Decision: Use Angular Material for all UI components
   - Pro: Consistent, professional look, accessibility
   - Con: Large dependency, limited customization, performance impact

## Additional Resources

- **Main README:** `/Users/mac/Work/Github/kubermatic/dashboard/README.md`
- **Development Guide:** `/Users/mac/Work/Github/kubermatic/dashboard/Development.md`
- **Contributing:** `/Users/mac/Work/Github/kubermatic/dashboard/CONTRIBUTING.md`
- **KKP Documentation:** https://docs.kubermatic.com/kubermatic/
- **Repository:** https://github.com/kubermatic/dashboard

---

**Document Last Updated:** January 2026
**Angular Version:** 20.3.x
**TypeScript Version:** Latest
**Primary Contributors:** Kubermatic Team
