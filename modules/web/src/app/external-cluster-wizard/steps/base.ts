// Copyright 2022 The Kubermatic Kubernetes Platform contributors.
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

import {Directive, OnDestroy} from '@angular/core';
import {AbstractControl} from '@angular/forms';
import {BaseFormValidator} from '@shared/validators/base-form.validator';

@Directive()
export class StepBase extends BaseFormValidator implements OnDestroy {
  constructor(formName = 'Form') {
    super(formName);
  }

  control(name: string): AbstractControl {
    return this.form.controls[name] ?? ({} as AbstractControl);
  }

  controlValue(name: string): any {
    return this.control(name)?.value;
  }

  ngOnDestroy(): void {
    this._unsubscribe.next();
    this._unsubscribe.complete();
    this._reset();
  }

  private _reset(controls: string[] = []): void {
    if (this.form.invalid) {
      Object.keys(this.form.controls)
        .filter(key => !controls.includes(key))
        .forEach(key => {
          this.form.reset(key);
        });
    }
  }
}