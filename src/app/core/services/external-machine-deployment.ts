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

import {HttpClient} from '@angular/common/http';
import {Injectable} from '@angular/core';
import {Observable, of} from 'rxjs';
import {catchError, map, mergeMap, take} from 'rxjs/operators';
import {MatDialog, MatDialogConfig} from '@angular/material/dialog';
import {environment} from '@environments/environment';
import {NotificationService} from '@core/services/notification';
import {ConfirmationDialogComponent} from '@shared/components/confirmation-dialog/component';
import {ExternalCluster} from '@shared/entity/external-cluster';
import {ExternalMachineDeployment, ExternalMachineDeploymentPatch} from '@shared/entity/external-machine-deployment';

@Injectable()
export class ExternalMachineDeploymentService {
  private readonly _newRestRoot: string = environment.newRestRoot;

  constructor(
    private readonly _httpClient: HttpClient,
    private readonly _matDialog: MatDialog,
    private readonly _notificationService: NotificationService
  ) {}

  patchExternalMachineDeployment(
    projectID: string,
    clusterID: string,
    machineDeploymentID: string,
    patch: ExternalMachineDeploymentPatch
  ): Observable<ExternalMachineDeployment> {
    const url = `${this._newRestRoot}/projects/${projectID}/kubernetes/clusters/${clusterID}/machinedeployments/${machineDeploymentID}`;
    return this._httpClient.patch<ExternalMachineDeployment>(url, patch);
  }

  showExternalMachineDeploymentDeleteDialog(
    projectID: string,
    cluster: ExternalCluster,
    md: ExternalMachineDeployment
  ): Observable<boolean> {
    const dialogConfig: MatDialogConfig = {
      data: {
        title: 'Delete Machine Deployment',
        message: `Delete <b>${md.name}</b> machine deployment of <b>${cluster.name}</b> cluster permanently?`,
        confirmLabel: 'Delete',
      },
    };
    const dialogRef = this._matDialog.open(ConfirmationDialogComponent, dialogConfig);
    return dialogRef.afterClosed().pipe(
      mergeMap((isConfirmed: boolean): Observable<boolean> => {
        if (isConfirmed) {
          return this._deleteExternalMachineDeployment(projectID, cluster.id, md.id).pipe(
            map(data => {
              this._notificationService.success(`Deleting the ${md.name} machine deployment`);
              return Boolean(data);
            }),
            catchError(() => {
              this._notificationService.error(`Could not delete the ${md.name} machine deployment`);
              return of(false);
            }),
            take(1)
          );
        }
        return of(false);
      })
    );
  }

  private _deleteExternalMachineDeployment(
    projectID: string,
    clusterId: string,
    machineDeploymentId: string
  ): Observable<Record<string, never>> {
    const url = `${this._newRestRoot}/projects/${projectID}/kubernetes/clusters/${clusterId}/machinedeployments/${machineDeploymentId}`;
    return this._httpClient.delete<Record<string, never>>(url);
  }
}
