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
  // 本地单用户:放行 Tauri WebView 与本机 localhost/127.0.0.1 任意端口(浏览器开发 :5914 等);
  // 拒绝其它一切来源(红线:零外联)。
  app.enableCors({ origin: ['tauri://localhost', /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] });
  return app;
}
