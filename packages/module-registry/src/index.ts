import type { SystemModule } from "@potomac/contracts";
export * from "./v2.js";

export class ModuleRegistry {
  private readonly modules = new Map<string, SystemModule>();

  register(module: SystemModule): void {
    if (module.formatVersion !== 1 || !module.id || !module.version || !module.schema || !module.view || !Array.isArray(module.actions)) {
      throw new Error("Invalid system module: required manifest capabilities are missing");
    }
    const actionIds = new Set(module.actions.map((action) => action.id));
    if ((module.view.actions || []).some((id) => !actionIds.has(id))) throw new Error(`Module ${module.id} view references a missing action`);
    if (this.modules.has(module.id)) throw new Error(`Duplicate module id: ${module.id}`);
    this.modules.set(module.id, structuredClone(module));
  }

  get(id: string): SystemModule {
    const module = this.modules.get(id);
    if (!module) throw new Error(`Unknown system module: ${id}`);
    return module;
  }

  list(): SystemModule[] {
    return [...this.modules.values()].map((module) => structuredClone(module));
  }
}
