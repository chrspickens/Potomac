export type ViewControl = { control: 'text' | 'stat' | 'resource' | 'actionButton'; label: string; field?: string; actionId?: string; parameters?: Record<string, unknown> }
export type ActionInputProperty = { type?: 'string' | 'integer' | 'number'; title?: string; description?: string; default?: unknown; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; enum?: unknown[] }
export type ModuleAction = { id: string; label?: string; policy?: 'selfService' | 'gmReview'; reconciliation?: 'commutative'; input?: { type?: 'object'; properties?: Record<string, ActionInputProperty>; required?: string[]; additionalProperties?: boolean }; requires?: unknown; effects?: Array<{ op: string; resource: string; amount: { literal?: number } }>; resolution?: { dice: Array<{ count: number; sides: number; role?: string }>; modifier?: unknown; targetInput?: string; compareTotals?: boolean; comparison?: string } }
export type GameModule = {
  manifest: { id: string; version: string; name: string; tagline: string }
  view: { title: string; layout: ViewControl[]; brick: ViewControl[] }
  actions: ModuleAction[]
  schema?: Record<string, unknown>
}
export type Actor = { entityId: string; name: string; epithet: string; data: Record<string, any>; module: GameModule; revision: number; secretNote?: string }

export const initialActors: Actor[] = [
  {
    entityId: 'actor-emberfall-01', name: 'Mira Vell', epithet: 'Ashbound arcanist', revision: 1,
    data: { attributes: { strength: 14, intelligence: 12 }, resources: { hp: { current: 24, maximum: 32 }, mana: { current: 5, maximum: 8 } }, derived: { meleeBonus: 4 }, secretNote: 'The magistrate recognizes Mira.' },
    module: {
      manifest: { id: 'example.system-a', version: '0.1.0', name: 'Emberbound', tagline: 'D20 fantasy · System A' },
      view: { title: 'Adventurer', layout: [{ control: 'text', label: 'Name', field: 'name' }, { control: 'stat', label: 'Strength', field: 'attributes.strength' }, { control: 'stat', label: 'Intelligence', field: 'attributes.intelligence' }, { control: 'resource', label: 'Hit Points', field: 'resources.hp' }, { control: 'resource', label: 'Mana', field: 'resources.mana' }, { control: 'stat', label: 'Melee Bonus', field: 'derived.meleeBonus' }, { control: 'actionButton', actionId: 'spend-mana', label: 'Spend 1 Mana' }, { control: 'actionButton', actionId: 'strength-check', label: 'Roll Strength Check' }], brick: [{ control: 'text', label: 'Name', field: 'name' }, { control: 'resource', label: 'HP', field: 'resources.hp' }, { control: 'resource', label: 'Mana', field: 'resources.mana' }, { control: 'actionButton', actionId: 'spend-mana', label: 'Spend 1 Mana' }, { control: 'actionButton', actionId: 'strength-check', label: 'Strength Check', parameters: { difficulty: 12 } }] },
      actions: [{ id: 'spend-mana', input: { type: 'object', properties: {}, required: [], additionalProperties: false }, effects: [{ op: 'changeResource', resource: 'mana.current', amount: { literal: -1 } }] }, { id: 'strength-check', input: { type: 'object', properties: { difficulty: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['difficulty'], additionalProperties: false }, resolution: { dice: [{ count: 1, sides: 20 }], targetInput: 'difficulty', comparison: 'gte' } }],
    },
    secretNote: 'The magistrate recognizes Mira.',
  },
  {
    entityId: 'actor-tidebound-01', name: 'Tarin Vale', epithet: 'Keeper of the shoals', revision: 1,
    data: { traits: { agility: 3, instinct: 2 }, resources: { stress: { current: 2, maximum: 6 }, hope: { current: 4, maximum: 6 } }, derived: { composure: 4 } },
    module: {
      manifest: { id: 'example.system-b', version: '0.1.0', name: 'Hollow Stars', tagline: 'Two-dice story game · System B' },
      view: { title: 'Wayfarer', layout: [{ control: 'text', label: 'Name', field: 'name' }, { control: 'stat', label: 'Agility', field: 'traits.agility' }, { control: 'stat', label: 'Instinct', field: 'traits.instinct' }, { control: 'resource', label: 'Stress', field: 'resources.stress' }, { control: 'resource', label: 'Hope', field: 'resources.hope' }, { control: 'stat', label: 'Composure', field: 'derived.composure' }, { control: 'actionButton', actionId: 'spend-hope', label: 'Spend 1 Hope' }, { control: 'actionButton', actionId: 'instinct-test', label: 'Roll Instinct Test' }], brick: [{ control: 'text', label: 'Name', field: 'name' }, { control: 'resource', label: 'Stress', field: 'resources.stress' }, { control: 'resource', label: 'Hope', field: 'resources.hope' }, { control: 'actionButton', actionId: 'spend-hope', label: 'Spend 1 Hope' }, { control: 'actionButton', actionId: 'instinct-test', label: 'Instinct Test', parameters: { difficulty: 8 } }] },
      actions: [{ id: 'spend-hope', input: { type: 'object', properties: {}, required: [], additionalProperties: false }, effects: [{ op: 'changeResource', resource: 'hope.current', amount: { literal: -1 } }] }, { id: 'instinct-test', input: { type: 'object', properties: { difficulty: { type: 'integer', minimum: 1, maximum: 12 } }, required: ['difficulty'], additionalProperties: false }, resolution: { dice: [{ count: 2, sides: 6, role: 'hope' }, { count: 2, sides: 6, role: 'stress' }], targetInput: 'difficulty', compareTotals: true } }],
    },
  },
]
