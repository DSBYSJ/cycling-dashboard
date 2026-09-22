/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // 产物用相对路径:既可部署到子目录,也是后续用 Capacitor 打包安卓 App 的前提
  base: './',
  server: {
    /**
     * 本地开发时把 /api 代理到后端(默认 3000 端口)。
     * 目的是让前端在开发环境也走「同源 /api」，与线上 Nginx 的行为一致 ——
     * 这样登录 Cookie 的作用域、路径都和生产相同，不会出现「开发能用、上线登录失效」。
     */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  plugins: [
    react(),
    /**
     * PWA:生成 Service Worker 并预缓存构建产物。
     * 没有 SW 时安卓 Chrome 不会生成 WebAPK,「添加到主屏幕」只是个带地址栏的快捷方式;
     * 有了 SW 才能真安装,并且野外无信号时也能打开看历史记录。
     */
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-maskable.svg', 'apple-touch-icon.png', 'icon-maskable.png'],
      manifest: {
        id: 'cycling-dashboard',
        name: '骑行评分监测看板',
        short_name: '骑行看板',
        description: '记录骑行数据,结合天气、空气质量与路线海拔坡度计算综合评分,并以速度曲线、海拔曲线、评分雷达与地图轨迹展示。',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b1020',
        theme_color: '#0b1020',
        categories: ['health', 'fitness', 'sports'],
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          // PNG 版本给安卓的安装/启动画面用(部分系统对 SVG 图标支持不全)
          { src: 'apple-touch-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // maskable 图标:图形缩在中心安全区内,自适应图标裁成圆形/方形都不会切掉边缘
          { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 高德 SDK 与地图瓦片体积大且需实时联网,不纳入预缓存;离线时仍可查看已保存的历史记录
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // 天气/海拔接口:网络优先,失败时回落到缓存(数据本身变化不快,离线也能看到上次结果)
            urlPattern: /^https:\/\/(api|archive-api|air-quality-api)\.open-meteo\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'open-meteo',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // 把不常变动的第三方库单独拆包,业务代码更新时这部分缓存依然有效
        manualChunks: {
          react: ['react', 'react-dom'],
          icons: ['lucide-react'],
          amap: ['@amap/amap-jsapi-loader'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
