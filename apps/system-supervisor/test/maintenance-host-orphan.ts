import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

export const startHostOrphan = async (
  root: string,
  originalUrl: string,
  env: NodeJS.ProcessEnv,
) => {
  const modulePath = createRequire(import.meta.url).resolve('@prisma/client');
  const file = join(root, 'host-orphan.cjs');
  writeFileSync(
    file,
    `const {PrismaClient}=require(${JSON.stringify(modulePath)});
const p=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL+'&connect_timeout=1&pool_timeout=1'}}});
let attempts=0, connections=0, writes=0, active=false;
process.on('message', m=>{if(m==='begin') active=true; if(m==='snapshot') process.send({attempts,connections,writes});});
(async()=>{await p.$queryRawUnsafe('SELECT 1');await p.$disconnect();process.send('ready');
while(true){if(active){attempts++;try{await p.$queryRawUnsafe('SELECT 1');connections++;await p.$executeRawUnsafe('UPDATE public."CommercialAutomationSettings" SET paused=true');writes++;}catch{}finally{await p.$disconnect();}}await new Promise(r=>setTimeout(r,25));}})().catch(()=>process.exit(1));`,
  );
  const child = spawn(process.execPath, [file], {
    cwd: root,
    env: { ...env, DATABASE_URL: originalUrl },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const message = () =>
    new Promise<unknown>((done, reject) => {
      const timeout = setTimeout(() => {
        child.off('message', receive);
        reject(new Error('Orphan IPC timeout'));
      }, 15_000);
      const receive = (value: unknown) => {
        clearTimeout(timeout);
        done(value);
      };
      child.once('message', receive);
    });
  try {
    if ((await message()) !== 'ready')
      throw new Error('Orphan positive control failed');
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    alive: () => child.exitCode === null && !child.killed,
    begin: () => child.send('begin'),
    snapshot: async () => {
      const reply = message();
      child.send('snapshot');
      const value = await reply;
      if (
        value === null ||
        typeof value !== 'object' ||
        !('attempts' in value) ||
        typeof value.attempts !== 'number' ||
        !('connections' in value) ||
        typeof value.connections !== 'number' ||
        !('writes' in value) ||
        typeof value.writes !== 'number'
      )
        throw new Error('Orphan IPC invalid');
      return {
        attempts: value.attempts,
        connections: value.connections,
        writes: value.writes,
      };
    },
    stop: () =>
      new Promise<void>((done) => {
        if (child.exitCode !== null) return done();
        child.once('exit', () => done());
        child.kill();
      }),
  };
};
