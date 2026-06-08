import * as config from './config.js';
import { createApp } from './bootstrap.js';

async function main(): Promise<void> {
  const app = await createApp();
  const port = config.apiPort();
  await app.listen(port, '127.0.0.1'); // 仅绑回环,零外联
  console.log(
    JSON.stringify({ level: 'info', source: 'api', message: `api listening on 127.0.0.1:${port}` }),
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ level: 'error', source: 'api', message: String(e?.stack ?? e) }));
  process.exit(1);
});
