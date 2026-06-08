/** 统一日志总线:logInsert 落库后发射,供 GET /logs/stream(SSE)实时推送日志页。 */
import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface LogEntry {
  id: string;
  ts: string;
  level: string;
  source?: string | null;
  job_id?: string | null;
  message: string;
}

@Injectable()
export class LogBus {
  private readonly subject = new Subject<LogEntry>();

  emit(entry: LogEntry): void {
    this.subject.next(entry);
  }

  observable(): Observable<LogEntry> {
    return this.subject.asObservable();
  }
}
