type CampaignPin = { systemModuleId: string | null; systemModuleVersion: string | null }
type VersionedFixture = { module: { manifest: { id: string; version: string } } }

export function fixturesForCampaign<T extends VersionedFixture>(fixtures: readonly T[], campaign: CampaignPin): T[] {
  if (!campaign.systemModuleId || !campaign.systemModuleVersion) return []
  return fixtures.filter(fixture => fixture.module.manifest.id === campaign.systemModuleId
    && fixture.module.manifest.version === campaign.systemModuleVersion)
}
