# Feature PRD: KubeVirt Advanced Machine Type Selector

**Document Version:** 1.0  
**Date:** January 21, 2026  
**Status:** Ready for Implementation  
**Owner:** Kubermatic Dashboard Team

---

## 1. Executive Summary

Implement an advanced tabular machine type selector for KubeVirt node configuration, replacing the combobox interface with a searchable, categorized table layout. The selector displays instance types from both Kubermatic-provided and custom cluster sources, organized by category (Kubermatic/Custom) and capabilities (CPU/GPU), enabling users to quickly browse and select appropriately-sized instances.

---

## 2. Business Objectives

| Objective | Success Metric |
|-----------|---|
| Improve discoverability of instance types | Users can scan and compare all available options in table format vs. scrolling dropdown |
| Enable informed selection decisions | Display CPU/Memory/GPU specs simultaneously for comparison |
| Reduce configuration errors | Tabular layout with validation catches invalid combinations early |
| Support both standard and custom instances | Dual-source architecture (Kubermatic + cluster-wide) with clear categorization |
| Match AWS provider UX pattern | Feature parity with existing AWS selector implementation |

---

## 3. Functional Requirements

### FR-1: Tabular Display with Categorized Tabs
- **Requirement:** Display instance types in a searchable table organized by 4 tabs:
  - Tab 0: Kubermatic CPU instances (no GPU)
  - Tab 1: Kubermatic GPU instances (GPU specs present)
  - Tab 2: Custom CPU instances (no GPU)
  - Tab 3: Custom GPU instances (GPU specs present)
- **Acceptance:** User can click tabs to switch categories; each tab shows relevant instances only
- **Rationale:** Simplifies browsing large instance lists; GPU/CPU separation helps users find appropriate tiers

### FR-2: Single-Select Radio Button Interface
- **Requirement:** Each instance type row contains a radio button for selection (single selection only)
- **Selected Value:** Capture internal ID format "category:name" (e.g., "kubermatic:standard-2", "custom:cx1.2xlarge")
- **Acceptance:** Only one instance can be selected at a time; selection is reflected in parent form control
- **Rationale:** Clear visual indicator; prevents accidental multiple selections

### FR-3: Real-Time Search/Filter Across Tabs
- **Requirement:** Search input filters instance types by name across all visible instances in current tab
- **Behavior:** 
  - Case-insensitive matching
  - Filters as user types (real-time)
  - Shows "No instance types found" if search yields no results
  - Preserves selected instance if it matches filter
- **Acceptance:** User can type "cx1" and see only matching instances; clearing search shows all instances again
- **Rationale:** Reduces time to locate specific instance types in large lists

### FR-4: Dynamic Column Display
- **Requirement:** Table always displays: Select (radio), Name, CPU, Memory columns
- **Conditional GPU Column:** Show GPU column only on GPU tabs (Kubermatic GPU, Custom GPU)
- **Column Order:** Select | Name | CPU | Memory | [GPUs]
- **Acceptance:** CPU/Memory tabs hide GPU column; GPU tabs show it with count values
- **Rationale:** Cleaner interface; GPU count only relevant for GPU instances

### FR-5: Memory/CPU Data Extraction from Specs
- **Requirement:** Parse instance type JSON specs and extract:
  - **CPU:** Extract `spec.cpu.guest` value, display as string (e.g., "8", "16")
  - **Memory:** Extract `spec.memory.guest` value, preserve units from spec (e.g., "8590M", "17180M", "68720M")
  - **GPUs:** Check `spec.gpus` array length, display count or empty if none
- **Fallback:** Display "-" if parsing fails or value missing
- **Acceptance:** All instance types display correct CPU/Memory/GPU counts matching source specs
- **Rationale:** Specs contain authoritative hardware configuration; units must be preserved for backend API compatibility

---

## 4. Technical Requirements

### TR-1: Data Structure and ID Generation
- **Input:** `Record<string, KubeVirtInstanceType[]>` nested by category
- **ID Format:** Generate `_id` field as "category:name" (e.g., "kubermatic:standard-4")
- **Processing:** During observable mapping in parent, add `_id` to each instance before passing to selector
- **Validation:** Use `Array.isArray()` checks before iterating to prevent spread syntax errors
- **Acceptance:** Each instance has unique `_id` field; no instances with missing IDs
- **Rationale:** Enables unambiguous selection tracking across categories

### TR-2: ControlValueAccessor Pattern for Form Integration
- **Requirement:** Selector implements ControlValueAccessor for seamless Reactive Forms binding
- **Methods:** Implement `writeValue()`, `registerOnChange()`, `registerOnTouched()`, `setDisabledState()`
- **Binding:** Parent form control receives selected instance `_id` on change
- **Value Setting:** If form programmatically sets value, selector updates radio selection to match
- **Acceptance:** Form binding works bidirectionally; parent can programmatically select instances
- **Rationale:** Standard Angular pattern; enables form validation and programmatic control

### TR-3: Responsive Table with Scrolling
- **Container:** Maximum height 500px, overflow-y: auto for vertical scrolling
- **Sticky Header:** Table header stays visible when scrolling instance list
- **TrackBy Function:** Use `trackBy()` to optimize rendering, tracking by `_id` or `name`
- **Acceptance:** Users can scroll through long instance lists; header stays visible
- **Rationale:** Handles lists of 30+ instances efficiently; header context always visible

### TR-4: Memory Unit Preservation (Backend Compatibility)
- **Storage:** Instance type memory stored with units: "8590M", "17180M", "68720M"
- **Backend Format:** Send memory with units to API (Kubernetes `resource.ParseQuantity()` requires units)
- **Parent Component:** `_getNodeData()` and `_getQuotaCalculationPayload()` must use `selectedInstanceTypeMemory` WITH units
- **Manual Entry:** For user-entered memory, append "Mi" suffix (Kubernetes binary standard): `${memory}Mi`
- **API Validation:** Backend expects Kubernetes Quantity format (number + unit string)
- **Acceptance:** API receives "8590M" from instance types, parses correctly without "default to bytes" error
- **Rationale:** Backend's `resource.ParseQuantity()` fails on plain numbers; requires unit suffix

### TR-5: Error Handling and Loading States
- **Loading State:** Show `mat-spinner` while instance types load from API
- **Error Recovery:** Catch categorization errors, log to console.error (not console.log), fallback to empty list
- **Empty State:** Display "No instance types found" message if no instances available or search yields nothing
- **Validation:** Array validation before spread/iteration operations
- **Acceptance:** Component gracefully handles missing data, errors, and loading states
- **Rationale:** Improves reliability; prevents cryptic errors from appearing to users

---

## 5. User Stories and Acceptance Criteria

### User Story 1: Browse Available Instance Types
**As a** cluster admin creating a KubeVirt node deployment  
**I want to** see all available instance types in a searchable table  
**So that** I can quickly find and select the right instance size for my workload

**Acceptance Criteria:**
- [ ] Selector displays all instances from both Kubermatic and custom sources
- [ ] Instances are organized into 4 tabs by category (Kubermatic CPU/GPU, Custom CPU/GPU)
- [ ] Each row shows: Name, CPU count, Memory size, [GPU count if applicable]
- [ ] Tab indicators show count of instances per category (e.g., "Kubermatic CPU (3)")
- [ ] Search input filters instances by name in real-time
- [ ] "No instance types found" message appears when search yields no results

### User Story 2: Select Instance Type and Auto-Populate Configuration
**As a** cluster admin  
**I want to** click a radio button to select an instance type  
**So that** CPU and memory fields are automatically populated

**Acceptance Criteria:**
- [ ] Clicking radio button selects that instance (single selection only)
- [ ] Selected instance shows filled radio button
- [ ] Parent component receives selected instance ID in form control
- [ ] CPU field auto-populates with instance's CPU count
- [ ] Memory field auto-populates with instance's memory value
- [ ] Form recognizes instance type as selected without requiring manual entry
- [ ] Deselecting and reselecting works without errors

### User Story 3: Efficiently Locate Instance in Large List
**As a** user working with many custom instances  
**I want to** search by instance name to filter the list  
**So that** I don't have to scroll through all 30+ instances manually

**Acceptance Criteria:**
- [ ] Search input is visible above the table
- [ ] Typing partial name filters instances in real-time (e.g., "cx1" shows all cx1.* instances)
- [ ] Search is case-insensitive ("CX1" matches "cx1.2xlarge")
- [ ] Clearing search text shows full instance list again
- [ ] Search works across all tabs (filters current tab's instances)
- [ ] Previously selected instance remains selected if it matches search filter

### User Story 4: Compare CPU and Memory Specifications
**As a** user  
**I want to** see CPU and memory specs for multiple instances side-by-side  
**So that** I can compare and choose the best value option

**Acceptance Criteria:**
- [ ] Table rows are visible and readable without horizontal scrolling
- [ ] CPU column shows instance CPU count (e.g., "2", "8", "16")
- [ ] Memory column shows instance memory with units (e.g., "8590M", "17180M", "68720M")
- [ ] GPU column appears only on GPU instance tabs with GPU count
- [ ] Column alignment and spacing make specs easy to compare
- [ ] Table header stays visible when scrolling through instance list

---

## 6. Data Models

### KubeVirtInstanceType
```typescript
interface KubeVirtInstanceType {
  name: string;                    // e.g., "standard-2", "cx1.2xlarge"
  spec: string;                    // JSON string: {"cpu":{"guest":2},"memory":{"guest":"8590M"},"gpus":[]}
  _id?: string;                    // Generated: "category:name" (e.g., "kubermatic:standard-2")
}
```

@Input() instanceTypes: Record<string, KubeVirtInstanceType[]>;

// Example value:
{
  "kubermatic": [
    {
      "name": "standard-2",
      "spec": "{\"cpu\":{\"guest\":2},\"memory\":{\"guest\":\"8590M\"},\"gpus\":[]}"
    },
    {
      "name": "standard-4",
      "spec": "{\"cpu\":{\"guest\":4},\"memory\":{\"guest\":\"17180M\"},\"gpus\":[]}"
    }
  ],
  "custom": [
    {
      "name": "cx1.2xlarge",
      "spec": "{\"cpu\":{\"guest\":8},\"memory\":{\"guest\":\"17180M\"},\"gpus\":[]}"
    }
  ]
}
