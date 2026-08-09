// Copyright 2026 The Kubermatic Kubernetes Platform contributors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {ChangeDetectionStrategy, Component, forwardRef, Input, OnChanges, OnInit, SimpleChanges} from '@angular/core';
import {ControlValueAccessor, NG_VALUE_ACCESSOR} from '@angular/forms';
import {KubeVirtInstanceType} from '@shared/entity/provider/kubevirt';

enum Column {
  Select = 'select',
  Name = 'name',
  CPU = 'cpu',
  Memory = 'memory',
  GPUs = 'gpus',
}

enum TabIndex {
  KubermaticCPU = 0,
  KubermaticGPU = 1,
  CustomCPU = 2,
  CustomGPU = 3,
}

@Component({
  selector: 'km-kubevirt-machine-type-selector',
  templateUrl: './template.html',
  styleUrls: [],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => KubeVirtMachineTypeSelectorComponent),
      multi: true,
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class KubeVirtMachineTypeSelectorComponent implements OnInit, OnChanges, ControlValueAccessor {
  readonly Column = Column;

  @Input() instanceTypes: Record<string, KubeVirtInstanceType[]> = {};
  @Input() label = 'Instance Type';
  @Input() required = false;
  @Input() isLoading = false;
  @Input() selectedInstanceTypeId = '';

  searchQuery = '';
  selectedTabIndex = TabIndex.KubermaticCPU;

  kubermaticCpuOptions: KubeVirtInstanceType[] = [];
  kubermaticGpuOptions: KubeVirtInstanceType[] = [];
  customCpuOptions: KubeVirtInstanceType[] = [];
  customGpuOptions: KubeVirtInstanceType[] = [];
  filteredOptions: KubeVirtInstanceType[] = [];
  hasGpuTypes = false;
  displayedColumns: string[] = [];

  private _onChange: (value: string) => void = () => {};
  private _onTouched: () => void = () => {};

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.instanceTypes) {
      this._categorizeOptions();
    }
    if (changes.selectedInstanceTypeId && changes.selectedInstanceTypeId.currentValue) {
      this._onChange(changes.selectedInstanceTypeId.currentValue);
    }
  }

  ngOnInit(): void {
    this._categorizeOptions();
    this._updateDisplayedColumns();
  }

  writeValue(value: string): void {
    this.selectedInstanceTypeId = value || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }

  onTabChange(index: number): void {
    this.selectedTabIndex = index;
    this.searchQuery = ''; // Clear search when switching tabs
    this._updateDisplayedColumns();
    this._applySearchFilter();
  }

  onSearchChange(query: string): void {
    this.searchQuery = query;
    this._applySearchFilter();
  }

  onInstanceTypeSelect(instanceType: KubeVirtInstanceType): void {
    this.selectedInstanceTypeId = instanceType._id;
    this._onChange(instanceType._id);
    this._onTouched();
  }

  trackById(_: number, option: KubeVirtInstanceType): string {
    return option._id || option.name;
  }

  getCpuInfo(spec: string): string {
    try {
      const parsed = JSON.parse(spec);
      return parsed?.cpu?.guest?.toString() || '-';
    } catch {
      return '-';
    }
  }

  getMemoryInfo(spec: string): string {
    try {
      const parsed = JSON.parse(spec);
      const memory = parsed?.memory?.guest;
      if (!memory) return '-';
      
      // Return memory with units preserved for backend compatibility
      // Backend expects Kubernetes Quantity format (e.g., "8590M", "17180M", "68720M")
      if (typeof memory === 'string') {
        return memory; // Keep units as-is
      }
      return memory.toString();
    } catch {
      return '-';
    }
  }

  getGpuInfo(spec: string): string {
    try {
      const parsed = JSON.parse(spec);
      const gpus = parsed?.gpus || [];
      return Array.isArray(gpus) && gpus.length > 0 ? gpus.length.toString() : '-';
    } catch {
      return '-';
    }
  }

  private _categorizeOptions(): void {
    console.log('[MachineTypeSelector] _categorizeOptions called, instanceTypes:', this.instanceTypes);
    console.log('[MachineTypeSelector] instanceTypes type:', typeof this.instanceTypes);
    
    // Initialize empty arrays
    this.kubermaticCpuOptions = [];
    this.kubermaticGpuOptions = [];
    this.customCpuOptions = [];
    this.customGpuOptions = [];

    if (!this.instanceTypes || Object.keys(this.instanceTypes).length === 0) {
      console.log('[MachineTypeSelector] No instance types available');
      this.hasGpuTypes = false;
      this._updateDisplayedColumns();
      this._applySearchFilter();
      return;
    }

    try {
      // Categorize instances by type and GPU presence
      // Ensure we always get arrays, never undefined/null/objects
      const kubermaticRaw = this.instanceTypes['kubermatic'];
      const customRaw = this.instanceTypes['custom'];
      
      console.log('[MachineTypeSelector] kubermaticRaw:', kubermaticRaw, 'Type:', typeof kubermaticRaw, 'IsArray:', Array.isArray(kubermaticRaw));
      console.log('[MachineTypeSelector] customRaw:', customRaw, 'Type:', typeof customRaw, 'IsArray:', Array.isArray(customRaw));
      
      const kubermaticInstances = Array.isArray(kubermaticRaw) ? kubermaticRaw : [];
      const customInstances = Array.isArray(customRaw) ? customRaw : [];
      
      console.log('[MachineTypeSelector] kubermaticInstances:', kubermaticInstances, 'IsArray:', Array.isArray(kubermaticInstances));
      console.log('[MachineTypeSelector] customInstances:', customInstances, 'IsArray:', Array.isArray(customInstances));

      this._categorizeByType('kubermatic', kubermaticInstances);
      this._categorizeByType('custom', customInstances);

      this.hasGpuTypes = this.kubermaticGpuOptions.length > 0 || this.customGpuOptions.length > 0;
      console.log('[MachineTypeSelector] Categorization complete. hasGpuTypes:', this.hasGpuTypes);
    } catch (error) {
      console.error('[MachineTypeSelector] Error during categorization:', error);
      this.hasGpuTypes = false;
    }
    
    this._updateDisplayedColumns();
    this._applySearchFilter();
  }

  private _categorizeByType(category: 'kubermatic' | 'custom', instances: KubeVirtInstanceType[]): void {
    console.log(`[MachineTypeSelector] _categorizeByType called for ${category}, instances:`, instances);
    if (!Array.isArray(instances)) {
      console.error(`[MachineTypeSelector] ERROR: instances for ${category} is not an array!`, instances);
      return;
    }
    
    for (const instance of instances) {
      const hasGpu = this._hasGpu(instance.spec);
      
      if (category === 'kubermatic') {
        hasGpu ? this.kubermaticGpuOptions.push(instance) : this.kubermaticCpuOptions.push(instance);
      } else {
        hasGpu ? this.customGpuOptions.push(instance) : this.customCpuOptions.push(instance);
      }
    }
  }

  private _hasGpu(spec: string): boolean {
    try {
      const parsed = JSON.parse(spec);
      const gpus = parsed?.gpus || [];
      return Array.isArray(gpus) && gpus.length > 0;
    } catch {
      return false;
    }
  }

  private _applySearchFilter(): void {
    let sourceOptions: KubeVirtInstanceType[] = [];

    // Determine which options to use based on tab index and GPU availability
    const hasGpuTab = this.hasGpuTypes;

    if (!hasGpuTab) {
      // When no GPU types: tabs are [Kubermatic CPU (0), Custom CPU (1)]
      if (this.selectedTabIndex === 0) {
        sourceOptions = Array.isArray(this.kubermaticCpuOptions) ? this.kubermaticCpuOptions : [];
      } else if (this.selectedTabIndex === 1) {
        sourceOptions = Array.isArray(this.customCpuOptions) ? this.customCpuOptions : [];
      }
    } else {
      // When GPU types exist: tabs are [Kubermatic CPU (0), Kubermatic GPU (1), Custom CPU (2), Custom GPU (3)]
      switch (this.selectedTabIndex) {
        case TabIndex.KubermaticCPU:
          sourceOptions = Array.isArray(this.kubermaticCpuOptions) ? this.kubermaticCpuOptions : [];
          break;
        case TabIndex.KubermaticGPU:
          sourceOptions = Array.isArray(this.kubermaticGpuOptions) ? this.kubermaticGpuOptions : [];
          break;
        case TabIndex.CustomCPU:
          sourceOptions = Array.isArray(this.customCpuOptions) ? this.customCpuOptions : [];
          break;
        case TabIndex.CustomGPU:
          sourceOptions = Array.isArray(this.customGpuOptions) ? this.customGpuOptions : [];
          break;
      }
    }

    // Apply search filter with safety check for spread syntax
    if (!Array.isArray(sourceOptions)) {
      console.error('[MachineTypeSelector] ERROR: sourceOptions is not an array!', sourceOptions);
      this.filteredOptions = [];
      return;
    }
    
    this.filteredOptions = !this.searchQuery
      ? [...sourceOptions] // Create copy to avoid mutations
      : sourceOptions.filter(option => option.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
  }

  private _updateDisplayedColumns(): void {
    // Determine if current tab is a GPU tab based on actual tab type
    // When hasGpuTypes is false: tabs are [CPU (0), CPU (1)]
    // When hasGpuTypes is true: tabs are [CPU (0), GPU (1), CPU (2), GPU (3)]
    let isGpuTab = false;
    
    if (this.hasGpuTypes) {
      isGpuTab = this.selectedTabIndex === TabIndex.KubermaticGPU || this.selectedTabIndex === TabIndex.CustomGPU;
    } else {
      // When no GPU types, all tabs are CPU tabs
      isGpuTab = false;
    }
    
    const baseColumns = [Column.Select, Column.Name, Column.CPU, Column.Memory];
    const optionalColumns = isGpuTab ? [Column.GPUs] : [];
    
    // Safety check before spreading
    if (!Array.isArray(baseColumns) || !Array.isArray(optionalColumns)) {
      console.error('[MachineTypeSelector] ERROR: Column arrays are not valid!', {baseColumns, optionalColumns});
      this.displayedColumns = [Column.Select, Column.Name, Column.CPU, Column.Memory];
      return;
    }
    
    this.displayedColumns = [...baseColumns, ...optionalColumns];
  }
}
