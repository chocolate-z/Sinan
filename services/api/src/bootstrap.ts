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
  // ⚠️ 必须显式列全 methods/headers:@fastify/cors 默认只放 GET/HEAD/POST,否则 PUT(保存 token/
  // 设主源)、DELETE(清凭据)、PATCH(jobs) 的 CORS 预检会被拒 → 跨域请求失败。
  app.enableCors({
    origin: [
      /^tauri:\/\/localhost$/, // macOS/Linux WebView
      /^https?:\/\/tauri\.localhost$/, // ⚠️ Windows WebView2(Tauri 2)的 webview origin,缺它则打包版前端跨域被拒
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, // dev(vite :9521)/ 本机回环
    ],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-sinan-token'],
  });
  return app;
}
