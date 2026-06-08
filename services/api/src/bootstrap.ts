import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_BASE } from '@sinan/shared-contracts';
import { AppModule, type AppOptions } from './app.module.js';

/** 构建并配置 Nest(Fastify)应用,但不监听。main 与测试共用。 */
export async function createApp(opts: AppOptions = {}): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(opts),
    new FastifyAdapter(),
    { logger: ['error', 'warn'] },
  );
  // 前缀去掉开头的 '/' 以符合 setGlobalPrefix 约定。
  app.setGlobalPrefix(API_BASE.replace(/^\//, ''));
  // 本地单用户:仅放行 Tauri WebView 来源。
  app.enableCors({ origin: ['tauri://localhost', 'http://localhost', 'http://127.0.0.1'] });
  return app;
}
