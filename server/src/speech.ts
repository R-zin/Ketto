import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Store } from './db.js';

export const transcriptBody = z.object({
  text: z.string().trim().max(4000).default(''),
  state: z.enum(['ready', 'unavailable', 'failed']),
  language: z.literal('en-US').default('en-US'),
  engine: z.string().max(100).default('vosk-small-en-us-0.15'),
  error: z.string().max(300).default(''),
}).refine(t => t.state !== 'ready' || !!t.text, 'Ready transcript requires text');
export type TranscriptInput = z.infer<typeof transcriptBody>;
export type Transcribe = (file: string) => Promise<{ text: string; language?: string; engine?: string }>;

function localEngine(data: string): Transcribe | undefined {
  const speech = join(data, 'speech');
  const python = process.env.STT_PYTHON || join(speech, 'runtime', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const model = process.env.STT_MODEL_PATH || join(speech, 'vosk-model-small-en-us-0.15');
  if (!existsSync(python) || !existsSync(join(model, 'am/final.mdl'))) return;
  const script = resolve(dirname(fileURLToPath(import.meta.url)), '../speech/transcribe.py');
  return async file => {
    const { stdout } = await promisify(execFile)(python, [script, model, file], {
      timeout: 45000, maxBuffer: 64 * 1024, windowsHide: true,
    });
    const result = JSON.parse(stdout);
    return { text: String(result.text || '').trim().slice(0, 4000), language: 'en-US', engine: 'vosk-small-en-us-0.15' };
  };
}

/** A single local recording job at a time; no second microphone or cloud API. */
export class Transcripts {
  private engine?: Transcribe;
  private running?: Promise<void>;
  private closed = false;
  constructor(private db: Store, private data: string, private changed: (mid: string) => void, transcribe?: Transcribe) {
    this.engine = transcribe || localEngine(data);
    db.run("UPDATE message_transcripts SET state='pending' WHERE state='processing'");
    db.run("INSERT OR IGNORE INTO message_transcripts(message_id,attachment_id,state,updated_at) SELECT id,attachment_id,'pending',? FROM messages WHERE kind IN ('ptt','voice') AND attachment_id IS NOT NULL", Date.now());
  }
  attach(mid: string, attachment: string, supplied?: TranscriptInput) {
    const old = this.db.get('SELECT * FROM message_transcripts WHERE message_id=?', mid);
    if (old?.attachment_id === attachment && old.state === 'ready') return;
    const state = supplied?.state || (this.engine ? 'pending' : 'unavailable');
    this.db.run('INSERT INTO message_transcripts(message_id,attachment_id,text,state,language,engine,error,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET attachment_id=excluded.attachment_id,text=excluded.text,state=excluded.state,language=excluded.language,engine=excluded.engine,error=excluded.error,updated_at=excluded.updated_at',
      mid, attachment, supplied?.text || '', state, 'en-US', supplied?.engine || '', supplied?.error || (state === 'unavailable' ? 'Transcription unavailable. Listen to the recording.' : ''), Date.now());
  }
  retry(mid: string, attachment: string) {
    this.engine ||= localEngine(this.data);
    this.db.run('DELETE FROM message_transcripts WHERE message_id=?', mid);
    this.attach(mid, attachment);
    this.changed(mid);
  }
  tick(blocked = false): Promise<void> {
    if (this.closed || blocked || this.running) return this.running || Promise.resolve();
    this.running = this.process().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async process() {
    const job = this.db.get("SELECT t.*,m.conversation_id FROM message_transcripts t JOIN messages m ON m.id=t.message_id AND m.attachment_id=t.attachment_id WHERE t.state='pending' ORDER BY t.updated_at LIMIT 1");
    if (!job) return;
    this.db.run("UPDATE message_transcripts SET state='processing',updated_at=? WHERE message_id=?", Date.now(), job.message_id);
    this.changed(job.message_id);
    let result: TranscriptInput;
    try {
      if (!this.engine) result = { text: '', state: 'unavailable', language: 'en-US', engine: '', error: 'Transcription unavailable. Listen to the recording.' };
      else {
        const output = await this.engine(join(this.data, 'files', job.attachment_id));
        result = transcriptBody.parse({ ...output, state: output.text.trim() ? 'ready' : 'unavailable', error: output.text.trim() ? '' : 'No clear speech recognised. Listen to the recording.' });
      }
    } catch {
      result = { text: '', state: 'failed', language: 'en-US', engine: '', error: 'Transcription failed. Retry or listen to the recording.' };
    }
    if (this.db.get("SELECT 1 FROM message_transcripts WHERE message_id=? AND attachment_id=? AND state='processing'", job.message_id, job.attachment_id)) {
      this.attach(job.message_id, job.attachment_id, result);
      this.changed(job.message_id);
    }
  }
  async close() { this.closed = true; await this.running; }
}
