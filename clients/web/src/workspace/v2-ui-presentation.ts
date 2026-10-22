import type { JsonValue } from '@potomac/contracts';

type JsonObject = { [key: string]: JsonValue };
const isObject = (value: JsonValue | undefined): value is JsonObject => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export type OrderedParticipant = { id: string; label: string; kind?: string; index: number; active: boolean; controlledByViewer: boolean };

export function summarizeCommandOutcomes(result: unknown, data: JsonValue): string[] {
  if (!result || typeof result !== 'object' || !('outcomes' in result) || !Array.isArray(result.outcomes)) return [];
  const names = new Map<string, string>();
  if (isObject(data) && Array.isArray(data.actors)) for (const actor of data.actors) if (isObject(actor) && typeof actor.id === 'string' && typeof actor.name === 'string') names.set(actor.id, actor.name);
  return result.outcomes.flatMap(item => {
    if (!isObject(item) || typeof item.kind !== 'string') return [];
    const summary = describeOutcome(item.kind, item.data, names);
    return summary ? [summary] : [];
  });
}

export function friendlyCommandError(error: unknown, commandId?: string): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
  const detail = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  const friendly = /out of turn|not the current turn|current turn/i.test(detail) ? 'It is another participant’s turn. Refresh to see who acts next.'
    : /movement.*(?:not legal|insufficient|remaining)|(?:not enough|insufficient).*movement/i.test(detail) ? 'That route exceeds this character’s remaining movement or is not legal now.'
    : /reaction.*(?:unavailable|not available|not legal)|no eligible.*responder/i.test(detail) ? 'No authorized reaction is available for this request.'
    : /target.*(?:invalid|unavailable|not legal)|invalid target/i.test(detail) ? 'Choose a valid, available target and try again.'
    : /action.*(?:spent|already used)|already.*(?:acted|used)/i.test(detail) ? 'That action has already been used this turn.' : '';
  const explain = (message: string) => `${message}${detail ? ` Host detail: ${detail}` : ''}`;
  if (friendly) return explain(friendly);
  if (status === 403 || code === 'unauthorized' || code === 'forbidden') return explain('The host denied this action for your account or selected character.');
  if (status === 400 || status === 422 || code === 'invalid' || code === 'invalid_input') return explain(commandId?.endsWith('.move') ? 'The host rejected these waypoints. Check the path and the character’s remaining movement.' : 'The host rejected these details. Check the required fields and allowed values.');
  if (code === 'stale_revision') return explain('The encounter changed before this action completed. Refresh and review its current state.');
  if (status === 409 || code === 'conflict') return explain(commandId?.endsWith('.move') ? 'The host could not apply this route to the current encounter. Refresh, review remaining movement, and adjust the waypoints.' : 'This action is no longer legal in the current encounter. Refresh and review the latest state.');
  if (status === 404) return explain('The selected entity or command is no longer available to this account.');
  return explain('The host did not confirm this action. Check access and connection, then retry.');
}

/**
 * Presents a module-declared initiative sequence using its existing ordered IDs and
 * current index. Names and roles are read only from the authorized projection.
 */
export function initiativeParticipants(data: JsonValue, path: string, label: string, viewerOwnedPaths: string[] = []): { round?: number; active?: string; activeId?: string; participants: OrderedParticipant[] } | undefined {
  if (!/initiative\s+order/i.test(label) || !isObject(data)) return undefined;
  const order = data[path];
  const actors = data.actors;
  const index = data.currentTurnIndex;
  if (!Array.isArray(order) || !Array.isArray(actors) || !Number.isInteger(index)) return undefined;
  const byId = new Map<string, JsonObject>();
  for (const actor of actors) if (isObject(actor) && typeof actor.id === 'string') byId.set(actor.id, actor);
  const ownedPaths = new Set(viewerOwnedPaths);
  const participants = order.flatMap((id, at) => {
    if (typeof id !== 'string') return [];
    const actor = byId.get(id);
    if (!actor) return [];
    return [{ id, label: typeof actor.name === 'string' ? actor.name : id, ...(typeof actor.kind === 'string' ? { kind: actor.kind } : {}), index: at + 1, active: at === index, controlledByViewer: ownedPaths.has(`actors.${actors.findIndex(candidate => isObject(candidate) && candidate.id === id)}`) }];
  });
  if (!participants.length) return undefined;
  const activeParticipant = participants.find(participant => participant.active);
  return { ...(Number.isInteger(data.round) ? { round: data.round as number } : {}), ...(activeParticipant ? { active: activeParticipant.label, activeId: activeParticipant.id } : {}), participants };
}

export function describeOutcome(kind: string, data: JsonValue, names: Map<string, string> = new Map()): string | undefined {
  if (!isObject(data)) return undefined;
  if (kind === 'revised5e.attack.hit' || kind === 'revised5e.attack.critical' || kind === 'revised5e.attack.miss') {
    const hit = kind !== 'revised5e.attack.miss';
    const actor = typeof data.actorName === 'string' ? data.actorName : typeof data.actorId === 'string' ? names.get(data.actorId) ?? 'A participant' : 'A participant';
    const target = typeof data.targetName === 'string' ? data.targetName : typeof data.targetId === 'string' ? names.get(data.targetId) ?? 'a target' : 'a target';
    return `${actor} ${hit ? 'hit' : 'missed'} ${target}${hit ? ` for ${String(data.damage ?? 0)} damage` : ''}${data.defeated === true ? '; target defeated' : ''}.`;
  }
  if (kind === 'revised5e.moved') {
    const from = isObject(data.from) ? data.from : undefined;
    const to = isObject(data.to) ? data.to : undefined;
    const actor = typeof data.actorName === 'string' ? data.actorName : typeof data.actorId === 'string' ? names.get(data.actorId) ?? 'A participant' : 'A participant';
    return `${actor} moved${from && to ? ` from (${String(from.x)}, ${String(from.y)}) to (${String(to.x)}, ${String(to.y)})` : ''}; ${String(data.movementRemaining ?? 'unknown')} ft remain.`;
  }
  if (kind === 'revised5e.turn-ended') return `Turn ended. ${String(typeof data.nextActorId === 'string' ? names.get(data.nextActorId) ?? 'The next participant' : 'The next participant')} acts next${data.round ? ` in round ${String(data.round)}` : ''}.`;
  if (kind.startsWith('revised5e.opportunity')) return 'The opportunity attack reaction was resolved by the host.';
  if (kind.startsWith('revised5e.')) return `${kind.slice('revised5e.'.length).replaceAll(/[.-]/g, ' ')}.`;
  return undefined;
}

export function describeHistoryEntry(entry: JsonValue, mode: 'combat' | 'movement'): string | undefined {
  if (!isObject(entry)) return undefined;
  const round = Number.isInteger(entry.round) ? `Round ${String(entry.round)} · ` : '';
  const actor = typeof entry.actorName === 'string' ? entry.actorName : 'A participant';
  if (mode === 'movement') {
    const from = isObject(entry.from) ? entry.from : undefined;
    const to = isObject(entry.to) ? entry.to : undefined;
    return `${round}${actor} moved${from && to ? ` from (${String(from.x)}, ${String(from.y)}) to (${String(to.x)}, ${String(to.y)})` : ''} · spent ${String(entry.feetSpent ?? 'unknown')} ft · ${String(entry.remaining ?? 'unknown')} ft remain${entry.stoppedByDefeat === true ? ' · stopped when a participant was defeated' : ''}.`;
  }
  const kind = typeof entry.kind === 'string' ? entry.kind : 'action';
  if (kind === 'initiative') return `${round}${actor} rolled initiative: d20 ${String(entry.d20 ?? '—')} + modifier = ${String(entry.attackTotal ?? '—')}.`;
  if (kind === 'second-wind') return `${round}${actor} used Second Wind and healed ${String(entry.healing ?? 0)} HP; ${String(entry.remainingHitPoints ?? '—')} HP remain.`;
  if (kind === 'short-rest') return `${round}${actor} completed a Short Rest; ${String(entry.resourceUsesRemaining ?? 0)} Second Wind uses remain.`;
  const target = typeof entry.targetName === 'string' ? entry.targetName : 'a target';
  const hit = !kind.includes('miss');
  const result = kind.includes('critical') ? 'critically hit' : hit ? 'hit' : 'missed';
  return `${round}${actor} ${result} ${target}${hit ? ` for ${String(entry.damage ?? 0)} damage` : ''}${entry.defeated === true ? '; target defeated' : ''}.`;
}
