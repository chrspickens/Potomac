import type { Activity, Encounter, Role, SessionSnapshot } from '../api.ts';
import type { Actor } from '../modules.ts';
import type { AuthorizedBrickDataAdapter, BrickBinding } from './types.ts';

export function resolveTableParticipants(binding: BrickBinding, adapter: AuthorizedBrickDataAdapter): Array<{ actor: Actor; status?: string }> | undefined {
  const encounter = binding.mode === 'follow' ? adapter.getActiveEncounter() : binding.mode === 'pinned' ? adapter.getEncounter(binding.entityId) : undefined;
  if (!encounter) return undefined;
  return adapter.getParticipantsForEncounter?.(encounter.id)
    ?? (encounter.id === adapter.getActiveEncounter()?.id ? adapter.getParticipants() : []);
}

export function createAuthorizedBrickAdapter(
  actors: Actor[], encounters: Encounter[], activeEncounter: Encounter | null, activity: Activity[], session?: SessionSnapshot, role: Role = 'player',
): AuthorizedBrickDataAdapter & { getEncounterOptions: () => Array<{ id: string; label: string }> } {
  const actorById = new Map(actors.map(actor => [actor.entityId, actor]));
  const encounterById = new Map(encounters.map(encounter => [encounter.id, encounter]));
  const participantsFor = (id: string) => (encounterById.get(id)?.participants || []).flatMap(item => {
    const actor = actorById.get(item.actorId);
    return actor ? [{ actor, status: item.status || undefined }] : [];
  });
  return {
    getActor: id => actorById.get(id),
    getEncounter: id => encounterById.get(id),
    getActorOptions: () => actors.map(({ entityId, name }) => ({ id: entityId, label: name })),
    getActiveEncounter: () => activeEncounter || undefined,
    getActivity: () => activity,
    getParticipants: () => activeEncounter ? participantsFor(activeEncounter.id) : [],
    getParticipantsForEncounter: participantsFor,
    getSession: () => session,
    getRole: () => role,
    getEncounterOptions: () => encounters.map(({ id, name }) => ({ id, label: name })),
  };
}
