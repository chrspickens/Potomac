import { resolve } from 'node:path';
import { exportCampaignBackup, restoreCampaignBackup } from './backup.mjs';

function usage() {
  console.error('Usage:\n  node server/host/backup-cli.mjs export <database.sqlite> <backup.json>\n  node server/host/backup-cli.mjs restore <backup.json> <empty-destination.sqlite>');
  process.exitCode = 2;
}

const [command, source, destination, ...extra] = process.argv.slice(2);
if (!['export', 'restore'].includes(command) || !source || !destination || extra.length) usage();
else {
  try {
    const result = command === 'export'
      ? await exportCampaignBackup(resolve(source), resolve(destination))
      : await restoreCampaignBackup(resolve(source), resolve(destination));
    console.log(JSON.stringify({ ok: true, command, ...result }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, command, error: error.message }));
    process.exitCode = 1;
  }
}
