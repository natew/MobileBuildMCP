import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  checkMp4Finalized,
  startSimulatorVideoCapture,
  stopSimulatorVideoCapture,
} from '../video_capture.ts';

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function writeMp4(parts: Buffer[]): string {
  const path = join(mkdtempSync(join(tmpdir(), 'mp4-')), 'a.mp4');
  writeFileSync(path, Buffer.concat(parts));
  return path;
}

describe('checkMp4Finalized', () => {
  const ftyp = box('ftyp', Buffer.from('isom0000', 'latin1'));
  const mdat = box('mdat', Buffer.alloc(1000, 1));
  const moov = box('moov', Buffer.alloc(100, 2));

  it('accepts moov after mdat and moov before mdat', async () => {
    expect(await checkMp4Finalized(writeMp4([ftyp, mdat, moov]))).toEqual({ finalized: true });
    expect(await checkMp4Finalized(writeMp4([ftyp, moov, mdat]))).toEqual({ finalized: true });
  });

  it('rejects a recording with no moov box', async () => {
    const result = await checkMp4Finalized(writeMp4([ftyp, mdat]));
    expect(result).toEqual({ finalized: false, reason: 'no moov box found' });
  });

  it('rejects a truncated mdat and a truncated moov', async () => {
    const cutMdat = await checkMp4Finalized(writeMp4([ftyp, mdat.subarray(0, 500)]));
    expect(cutMdat.finalized).toBe(false);
    const cutMoov = await checkMp4Finalized(writeMp4([ftyp, mdat, moov.subarray(0, 50)]));
    expect(cutMoov.finalized).toBe(false);
  });

  it('rejects an empty file', async () => {
    expect((await checkMp4Finalized(writeMp4([]))).finalized).toBe(false);
  });
});

describe('stopSimulatorVideoCapture process outcome', () => {
  const helpers = { getAxePath: () => '/axe', getBundledAxeEnvironment: () => ({}) };
  const executorFor = (script: string) =>
    (async () => ({
      success: true,
      output: '',
      process: spawn(process.execPath, ['-e', script]),
    })) as never;

  it('reports a child that ignores the stop signal as force-killed with its output', async () => {
    const script =
      "process.on('SIGINT',()=>{});console.log('Saved /tmp/t.mp4');setInterval(()=>{},1000)";
    await startSimulatorVideoCapture({ simulatorUuid: 'sim-kill' }, executorFor(script), helpers);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const result = await stopSimulatorVideoCapture({ simulatorUuid: 'sim-kill' }, null as never);
    expect(result).toMatchObject({
      stopped: true,
      forcedKill: true,
      parsedPath: '/tmp/t.mp4',
    });
  }, 15000);

  it('reports a child that exits on the stop signal as not force-killed', async () => {
    const script =
      "process.on('SIGINT',()=>process.exit(0));console.log('Saved /tmp/t.mp4');setInterval(()=>{},1000)";
    await startSimulatorVideoCapture({ simulatorUuid: 'sim-ok' }, executorFor(script), helpers);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const result = await stopSimulatorVideoCapture({ simulatorUuid: 'sim-ok' }, null as never);
    expect(result).toMatchObject({ stopped: true, forcedKill: false, exitCode: 0 });
  }, 15000);
});
