/**
 * 凭据服务:token 入钥匙串,DB 只存 fingerprint+引用。
 * 红线#4:任何对外方法绝不返回明文;getToken 仅供内部转发给 engine(用完即弃)。
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Repository } from '../db/repository.js';
import { SECRET_STORE, type SecretStore } from './secret-store.js';

function fingerprint(token: string): string {
  return createHash('sha256').update(token, 'utf-8').digest('hex').slice(0, 8);
}

function keyOf(provider: string): string {
  return `${provider}/token`;
}

@Injectable()
export class CredentialService {
  constructor(
    private readonly repo: Repository,
    @Inject(SECRET_STORE) private readonly store: SecretStore,
  ) {}

  /** 写 token:入钥匙串 + DB 存引用与指纹。返回不含明文。 */
  put(provider: string, token: string): { configured: boolean; fingerprint: string } {
    this.store.set(keyOf(provider), token);
    const fp = fingerprint(token);
    this.repo.credentialUpsert(provider, 'keychain', keyOf(provider), fp);
    return { configured: true, fingerprint: fp };
  }

  info(provider: string): { configured: boolean; fingerprint: string | null } {
    return this.repo.credentialInfo(provider);
  }

  delete(provider: string): void {
    this.store.delete(keyOf(provider));
    this.repo.credentialDelete(provider);
  }

  /** 仅内部:取明文转发给 engine。绝不经由任何 HTTP 响应/SSE/日志暴露。 */
  getToken(provider: string): string | null {
    return this.store.get(keyOf(provider));
  }
}
