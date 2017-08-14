import {NodeCreateSpec} from "../entitiy/NodeEntity";
export class CreateNodeModel {
  instances: number;
  spec: NodeCreateSpec;

  constructor(instances: number, spec: NodeCreateSpec) {
    this.instances = instances;
    this.spec = spec;
  }
}
