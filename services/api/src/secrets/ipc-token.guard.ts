/** 会话 token 守卫(红线#4/#6 落地):生产态由 Tauri 外壳下发 SINAN_IPC_TOKEN 时,前端每个请求
 *  必须携带匹配的 X-Sinan-Token,否则 401 —— 确保"仅本机回环、外部进程不可驱动 api"这条边界
 *  真正在服务端被强制(此前只声明、未校验)。
 *
 *  - 未设 SINAN_IPC_TOKEN(dev / 单测)→ 放行,不破坏既有行为。
 *  - EventSource(SSE)不能携带自定义头,其流仅进度/日志、不含任何凭据 → 按 Accept 头豁免。
 *  - 存活探测(/health、/healthz)豁免。
 *  - 常量时间比较,杜绝时序侧信道。token 本身绝不进日志/响应(红线#4)。
 */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

@Injectable()
export class IpcTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.SINAN_IPC_TOKEN;
    if (!expected) return true; // 未下发会话 token(dev/单测)→ 放行
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      url?: string;
    }>();
    const accept = req.headers['accept'];
    if (typeof accept === 'string' && accept.includes('text/event-stream')) return true;
    const path = (req.url ?? '').split('?')[0];
    if (path.endsWith('/health') || path.endsWith('/healthz')) return true;
    const got = req.headers['x-sinan-token'];
    if (typeof got === 'string' && safeEqual(got, expected)) return true;
    throw new UnauthorizedException('invalid or missing session token');
  }
}
