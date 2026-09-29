/**
 * 应用版本号。
 *
 * 值由 `vite.config.ts` 在构建时从 `package.json` 的 `version` 字段注入，
 * 所以这里**不要手写常量** —— 升级只需改 package.json 一处，界面自动跟着变。
 *
 * 升级方式：
 *   npm run bump:patch   小改动（改文案、修 bug）→ 1.0.0 → 1.0.1
 *   npm run bump:major   大版本（新增主要功能）  → 1.0.1 → 2.0.0
 *
 * 兜底成 'dev' 是给「没走 Vite 构建」的场景留的（个别单测、纯类型检查），
 * 宁可显示 dev，也不要让界面上出现 undefined。
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
