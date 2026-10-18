import { createRoot } from 'react-dom/client';
import type { UiEntityProjection, UiHostContext } from '@potomac/contracts';
import { V2UiContributionView } from './v2-ui-renderer.tsx';
import { UiContributionRegistry } from './v2-ui-registry.ts';
import { starshipUiCatalog, starshipUiContributions, starshipUiLock } from './v2-ui-fixtures.ts';

declare global { interface Window { __v2Ready?: boolean; __v2Submissions?: unknown[] } }

const registry = new UiContributionRegistry(starshipUiLock, starshipUiLock.campaignId, starshipUiCatalog);
for (const contribution of starshipUiContributions) registry.register(contribution);
const entity: UiEntityProjection = {
  campaignId: starshipUiLock.campaignId, entityId: 'reactor-browser-probe', typeId: 'example.starship.reactor', capability: starshipUiContributions[0].entityCapability, schemaVersion: 1, revision: 4,
  data: { power: 80, safe: false, allocations: { propulsion: 30, lifeSupport: 15 }, engineeringLog: [] },
};
const submissions: unknown[] = [];
const host: UiHostContext = {
  lock: starshipUiLock, principalId: 'test-gm', allowedCommandIds: ['example.starship.reactor.allocate-power'],
  submitCommand: async request => { await new Promise(resolve => setTimeout(resolve, 250)); submissions.push(request); window.__v2Submissions = submissions; return { status: 'applied' }; },
};
const composed = registry.compose('example.starship.reactor.sheet', {
  'example.starship.reactor.sheet': { 'example.starship.reactor.controls': ['example.starship.reactor.power-form'] },
});
createRoot(document.getElementById('permitted')!).render(<V2UiContributionView experimentalEnabled registry={registry} contributionId={composed.contributionId} entity={entity} host={host} />);
createRoot(document.getElementById('denied')!).render(<V2UiContributionView experimentalEnabled registry={registry} contributionId="example.starship.reactor.power-form" entity={entity} host={{ ...host, allowedCommandIds: [] }} />);
window.__v2Submissions = submissions;
window.__v2Ready = true;
