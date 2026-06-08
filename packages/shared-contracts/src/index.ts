/**
 * @sinan/shared-contracts — 跨服务契约单一真相源(TS 绑定)。
 * Python 绑定见 packages/shared-contracts/python/sinan_contracts。
 * 二者均以 spec/*.json 为准,由各自 consistency 测试守护,杜绝前后端漂移。
 */
export * from './capabilities.js';
export * from './enums.js';
export * from './endpoints.js';
export * from './dto.js';
