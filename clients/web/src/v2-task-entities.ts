/** Keep task-app options and active records in the same module-declared category. */
export type V2TaskView = 'workspace' | 'characters' | 'encounters' | 'table';

type TaskEntity = { entityId: string; typeId: string };

/** The legacy workspace can hand only prepared encounter records to Table. */
export function canOpenV2TaskEntityInTable(view: V2TaskView, typeId: string, preparationEntityTypeIds: readonly string[]): boolean {
  return (view === 'workspace' || view === 'encounters') && preparationEntityTypeIds.includes(typeId);
}

export function selectV2TaskEntity<T extends TaskEntity>(
  entities: readonly T[],
  preparationEntityTypeIds: readonly string[],
  view: V2TaskView,
  selectedEntityId: string,
): { taskEntities: T[]; entity: T | undefined } {
  const encounterTypes = new Set(preparationEntityTypeIds);
  const taskEntities = entities.filter(item => view === 'workspace'
    || (view === 'characters' ? !encounterTypes.has(item.typeId) : encounterTypes.has(item.typeId)));
  const entity = taskEntities.find(item => item.entityId === selectedEntityId) ?? taskEntities[0];
  return { taskEntities, entity };
}
