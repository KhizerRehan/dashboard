// Copyright 2023 The Kubermatic Kubernetes Platform contributors.
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

import {Component, forwardRef, OnDestroy, OnInit} from '@angular/core';
import {FormBuilder, FormControl, NG_VALIDATORS, NG_VALUE_ACCESSOR, Validators} from '@angular/forms';
import {KubeOneClusterSpecService} from '@core/services/kubeone-cluster-spec';
import {KubeOnePresetsService} from '@core/services/kubeone-wizard/kubeone-presets';
import {ProjectService} from '@core/services/project';
import {SimplePresetList} from '@shared/entity/preset';
import {NodeProvider} from '@shared/model/NodeProviderConstants';
import {BaseFormValidator} from '@shared/validators/base-form.validator';
import _ from 'lodash';
import {filter, map, switchMap, takeUntil, tap} from 'rxjs/operators';
import {catchError} from 'rxjs/operators';
import {of} from 'rxjs';

export enum Controls {
  Preset = 'name',
}

export enum PresetsState {
  Ready = 'Provider Preset',
  Loading = 'Loading...',
  Empty = 'No Provider Presets available',
}

@Component({
  selector: 'km-kubeone-wizard-presets',
  templateUrl: './template.html',
  styleUrls: ['./style.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => KubeOnePresetsComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => KubeOnePresetsComponent),
      multi: true,
    },
  ],
  standalone: false,
})
export class KubeOnePresetsComponent extends BaseFormValidator implements OnInit, OnDestroy {
  presetList = new SimplePresetList();
  presetsLoaded = false;

  readonly Controls = Controls;

  private _state = PresetsState.Loading;

  constructor(
    private readonly _presetsService: KubeOnePresetsService,
    private readonly _clusterSpecService: KubeOneClusterSpecService,
    private readonly _builder: FormBuilder,
    private readonly _projectService: ProjectService
  ) {
    super('KubeOne Preset');
  }

  get label(): string {
    return this._state;
  }

  get selectedPreset(): string {
    return this._presetsService.preset;
  }

  set selectedPreset(preset: string) {
    this.form.get(Controls.Preset).setValue(preset);
    if (!preset) {
      this.form.get(Controls.Preset).reset();
    }

    this._presetsService.preset = preset;
  }

  ngOnInit(): void {
    this.form = this._builder.group({
      [Controls.Preset]: new FormControl('', Validators.required),
    });

    this._clusterSpecService.providerChanges
      .pipe(tap(provider => {
        console.log('[KubeOne Presets] Provider changed:', provider);
        this.reset();
      }))
      .pipe(
        filter(_ => {
          if (!this.isPresetSupported()) {
            console.log('[KubeOne Presets] Preset not supported for this provider');
            this._enable(false, Controls.Preset);
            return false;
          }
          return true;
        })
      )
      .pipe(
        switchMap(_ => {
          console.log('[KubeOne Presets] Loading presets for provider:', this._clusterSpecService.provider);
          return this._presetsService.presets(this._projectService.selectedProjectID, this._clusterSpecService.provider).pipe(
            catchError(error => {
              console.error('[KubeOne Presets] Error loading presets:', error);
              return of({items: []} as any);
            })
          );
        })
      )
      .pipe(map(presetList => {
        console.log('[KubeOne Presets] Received presetList:', presetList);
        console.log('[KubeOne Presets] presetList.items:', presetList.items, 'Type:', typeof presetList.items);
        try {
          const presetNames = (presetList?.items ?? []).map(preset => preset.name);
          console.log('[KubeOne Presets] Mapped preset names:', presetNames);
          const result = new SimplePresetList(...presetNames);
          console.log('[KubeOne Presets] Created SimplePresetList:', result.names);
          return result;
        } catch (error) {
          console.error('[KubeOne Presets] Error creating SimplePresetList:', error);
          return new SimplePresetList();
        }
      }))
      .pipe(takeUntil(this._unsubscribe))
      .subscribe(presetList => {
        console.log('[KubeOne Presets] Subscribe: presetList received');
        this.presetsLoaded = presetList.names ? !_.isEmpty(presetList.names) : false;
        this._state = this.presetsLoaded ? PresetsState.Ready : PresetsState.Empty;
        this.presetList = presetList;
        console.log('[KubeOne Presets] State:', this._state, 'Loaded:', this.presetsLoaded);
        this._enable(this._state !== PresetsState.Empty, Controls.Preset);
      });

    this.form
      .get(Controls.Preset)
      .valueChanges.pipe(takeUntil(this._unsubscribe))
      .subscribe(preset => {
        this._presetsService.preset = preset;
      });

    this._presetsService.presetStatusChanges.pipe(takeUntil(this._unsubscribe)).subscribe(enable => {
      if (this._state !== PresetsState.Empty && this.isPresetSupported()) {
        this._enable(enable, Controls.Preset);
      }
    });
  }

  ngOnDestroy(): void {
    this._unsubscribe.next();
    this._unsubscribe.complete();
  }

  reset(): void {
    this.selectedPreset = '';
    this.presetsLoaded = false;
    this._state = PresetsState.Empty;
    this.presetList = new SimplePresetList();
  }

  isPresetSupported(): boolean {
    switch (this._clusterSpecService.provider) {
      case NodeProvider.OPENSTACK:
      case NodeProvider.VSPHERE:
        return false;
      default:
        return true;
    }
  }

  private _enable(enable: boolean, name: Controls): void {
    if (enable && this.form.get(name).disabled) {
      this.form.get(name).enable();
    }

    if (!enable && this.form.get(name).enabled) {
      this.form.get(name).disable();
    }
  }
}
