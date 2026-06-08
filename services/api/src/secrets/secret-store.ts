/**
 * 凭据安全存储抽象。红线#4:token 永不落明文。
 * - KeyringSecretStore:OS 钥匙串(@napi-rs/keyring,惰性加载,生产首选)。
 * - MemorySecretStore:仅测试用(进程内,不落盘)。
 */
import { Injectable } from '@nestjs/common';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);

export interface SecretStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export class MemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  delete(key: string): void {
    this.map.delete(key);
  }
}

const SERVICE = 'sinan';

export class KeyringSecretStore implements SecretStore {
  private mod: any;
  private load(): any {
    if (!this.mod) {
      // 惰性加载,避免无钥匙串环境在启动期崩溃。
      this.mod = requireCjs('@napi-rs/keyring');
    }
    return this.mod;
  }
  private entry(key: string) {
    const { Entry } = this.load();
    return new Entry(SERVICE, key);
  }
  get(key: string): string | null {
    try {
      return this.entry(key).getPassword();
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    this.entry(key).setPassword(value);
  }
  delete(key: string): void {
    try {
      this.entry(key).deletePassword();
    } catch {
      /* 不存在则忽略 */
    }
  }
}

export const SECRET_STORE = Symbol('SECRET_STORE');

@Injectable()
export class SecretStoreFactory {
  static create(): SecretStore {
    if (process.env.SINAN_SECRET_STORE === 'memory') return new MemorySecretStore();
    return new KeyringSecretStore();
  }
}
