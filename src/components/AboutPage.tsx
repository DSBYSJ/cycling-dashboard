import { useCallback, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowRight,
  Bike,
  Database,
  Gauge,
  Info,
  Moon,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
} from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { useCountUp } from '../hooks/useCountUp'
import { useReadingProgress, useRevealOnScroll } from '../hooks/useReveal'
import { useScrollExit } from '../hooks/useScrollExit'
import { useSmoothScroll } from '../hooks/useSmoothScroll'
import { APP_VERSION } from '../version'
import { PROJECT_STATS } from '../stats'
import { AppVersion } from './AppVersion'
import { HAS_FILING, FilingRecords } from './FilingRecords'
import ParticleField from './ParticleField'
import {
  COMPLIANCE_NOTE,
  FEATURE_GROUPS,
  PRINCIPLES,
  SITE_INTRO,
  SITE_TAGLINE,
  TECH_LAYERS,
} from '../data/about'

/**
 * 「关于本站」公开页。
 *
 * 这是整个应用里**唯一不需要登录**的页面（见 App.tsx 的分流顺序）——
 * 目的是让别人（比如招聘方、骑友）能直接看到这个项目做了什么、用了什么技术，
 * 而不必先有一个账号。内容全部来自 `data/about.ts`，合规声明与备案号也在这里展示。
 *
 * 视觉上这一页比应用内页更"张扬"（渐变标题、数据看板、滚动揭示、惯性滚动），
 * 因为它的任务就是留下印象；但性能约束不变：
 *  - 滚动揭示走 IntersectionObserver，不监听 scroll 做计算；
 *  - hero 的滚动退场只写两个 CSS 变量（rAF 节流），插值全在 CSS 里完成；
 *  - 平滑滚动（Lenis）动态加载、触摸屏不接管、「减弱动效」下不初始化；
 *  - 动效只碰 transform / opacity / background-position；
 *  - 数据看板的数字在构建时统计（见 vite.config.ts），不在页面上手写。
 */

/** 与 FEATURE_GROUPS 的顺序一一对应；多一个少一个都不会崩（取不到时回落到 Info） */
const GROUP_ICONS = [Route, Gauge, Bike, Database, ShieldCheck]

/** 进入应用（未登录时会落到登录页，由 App 的分流决定） */
const APP_ENTRY = '#/record'

export default function AboutPage() {
  const { theme, toggle: toggleTheme } = useTheme()
  const [progress, setProgress] = useState(0)
  const heroRef = useRef<HTMLElement | null>(null)

  useSmoothScroll()
  useScrollExit(heroRef)
  useRevealOnScroll()
  useReadingProgress(
    useCallback((ratio: number) => {
      setProgress(ratio)
    }, [])
  )

  return (
    <div className="min-h-full">
      {/* 展示型页面的氛围：星场粒子 + 扫描线 + 阅读进度 */}
      <ParticleField />
      <div className="scanline" aria-hidden="true" />
      <div className="reading-progress" aria-hidden="true" style={{ '--progress': `${progress * 100}%` } as CSSProperties} />

      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-10 flex justify-end">
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? '切换到日间（浅色）模式' : '切换到夜间（深色）模式'}
            aria-label={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
            className="flex items-center gap-1 rounded-full border border-line bg-fill px-2.5 py-1 text-[11px] text-t2 transition hover:bg-fill-strong"
          >
            {theme === 'dark' ? (
              <Sun className="h-3.5 w-3.5 text-accent-amber" aria-hidden="true" />
            ) : (
              <Moon className="h-3.5 w-3.5 text-accent-sky" aria-hidden="true" />
            )}
            {theme === 'dark' ? '日间' : '夜间'}
          </button>
        </div>

        {/* ================= Hero =================
            整个 hero 挂着滚动退场：向下滚时视差上浮 + 末段淡出微缩，
            向上滚原路退回（见 useScrollExit：只写 --hero-p / --hero-q，插值在 CSS） */}
        <header ref={heroRef} className="hero-parallax text-center">
          <div data-reveal>
            <span className="hero-badge">已上线运行 · 全栈个人项目</span>
          </div>

          <Bike
            className="mx-auto mt-5 h-10 w-10 text-accent-sky-text"
            aria-hidden="true"
            data-reveal
            style={{ '--i': 1 } as CSSProperties}
          />
          {/* 标题分两行 + 逐行遮罩上滑（reveal-line 是遮罩层，hero-title-line 是滑动层） */}
          <h1 className="mt-3 text-4xl font-bold leading-[1.18] tracking-tight sm:text-5xl">
            <span className="reveal-line">
              <span className="hero-gradient-text hero-title-line" style={{ '--i': 0 } as CSSProperties}>
                骑行评分
              </span>
            </span>
            <span className="reveal-line">
              <span className="hero-gradient-text hero-title-line" style={{ '--i': 1 } as CSSProperties}>
                监测看板
              </span>
            </span>
          </h1>
          <p
            className="mx-auto mt-4 max-w-md text-xs leading-6 text-t4"
            data-reveal
            style={{ '--i': 4 } as CSSProperties}
          >
            {SITE_TAGLINE}
          </p>

          <div className="mt-6" data-reveal style={{ '--i': 5 } as CSSProperties}>
            <a href={APP_ENTRY} className="btn-primary">
              进入应用
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <p className="mt-2 text-[11px] text-t5">需要账号登录后才能使用</p>
          </div>

          {/* 数据看板：数字在构建时统计（vite.config.ts），不是手写的宣传语 */}
          {PROJECT_STATS && (
            <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                value={PROJECT_STATS.appLines + PROJECT_STATS.serverLines}
                unit="行"
                label="应用代码"
                index={0}
              />
              <StatTile value={PROJECT_STATS.testCases} unit="例" label="自动化测试" index={1} />
              <StatTile
                value={PROJECT_STATS.frontendDeps + PROJECT_STATS.backendDeps}
                unit="个"
                label="运行时依赖"
                index={2}
              />
              <StatTile value={APP_VERSION} label="当前版本" index={3} />
            </div>
          )}
        </header>

        {/* ================= 关于这个项目 ================= */}
        <SectionHeading index="01" icon={Info} title="关于这个项目" />
        <section className="card" data-reveal>
          <div className="space-y-3">
            {SITE_INTRO.map((paragraph) => (
              <p key={paragraph} className="text-xs leading-6 text-t3">
                {paragraph}
              </p>
            ))}
          </div>
        </section>

        {/* ================= 功能 ================= */}
        <SectionHeading index="02" icon={Route} title="功能" tone="emerald" />
        <div className="space-y-4">
          {FEATURE_GROUPS.map((group, index) => {
            const Icon = GROUP_ICONS[index] ?? Info
            return (
              <section
                key={group.id}
                className="card overflow-hidden"
                data-reveal
                style={{ '--i': index } as CSSProperties}
              >
                {/* 左侧渐变光条：给每张卡片一个"通电"的视觉锚点 */}
                <span className="feature-edge" aria-hidden="true" />
                <div className="flex items-start gap-3">
                  <span className="feature-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <h3 className="card-title mb-0">
                      <Icon className="h-4 w-4 text-accent-sky" aria-hidden="true" />
                      {group.title}
                    </h3>
                    <p className="mt-1 text-[11px] leading-5 text-t4">{group.summary}</p>
                  </div>
                </div>
                <ul className="mt-3 space-y-2">
                  {group.items.map((item) => (
                    <li key={item} className="flex gap-2 text-xs leading-5 text-t3">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent-sky" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>

        {/* ================= 技术 ================= */}
        <SectionHeading index="03" icon={SlidersHorizontal} title="技术" tone="amber" />
        <div className="grid gap-4 sm:grid-cols-3">
          {TECH_LAYERS.map((layer, index) => (
            <section key={layer.name} className="card" data-reveal style={{ '--i': index } as CSSProperties}>
              <h3 className="card-title">{layer.name}</h3>
              <div className="flex flex-wrap gap-1.5">
                {layer.stack.map((entry) => (
                  <span key={entry} className="pill">
                    {entry}
                  </span>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* ================= 取舍 ================= */}
        <SectionHeading index="04" icon={Gauge} title="几个有意为之的取舍" tone="emerald" />
        <section className="card" data-reveal>
          <ul className="space-y-3">
            {PRINCIPLES.map((item, index) => (
              <li key={item} className="numbered-item">
                <span className="n">{String(index + 1).padStart(2, '0')}</span>
                <span className="text-t3">{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ================= 页脚 ================= */}
        <footer className="mt-12 border-t border-line-soft pt-6 text-center">
          <p className="mx-auto max-w-lg text-[11px] leading-5 text-t5">{COMPLIANCE_NOTE}</p>
          {HAS_FILING && (
            <p className="mt-3 text-[11px] text-t5">
              <FilingRecords />
            </p>
          )}

          {/* 版本号：访客与面试官都能看到「这份代码是哪个版本」 */}
          <p className="mt-3 text-[11px] text-t5">
            <AppVersion />
          </p>

          {/* 隐私政策与用户协议：此前只在登录后的页脚有入口，访客看不到 —— 公开页更该给 */}
          <p className="mt-3 text-[11px] text-t5">
            <a className="transition hover:text-t2" href="./privacy.html" target="_blank" rel="noreferrer">
              隐私政策
            </a>
            <span className="mx-2 text-t6">·</span>
            <a className="transition hover:text-t2" href="./terms.html" target="_blank" rel="noreferrer">
              用户协议
            </a>
          </p>

          <a
            href={APP_ENTRY}
            className="mt-4 inline-flex items-center gap-1 text-[11px] text-t4 transition hover:text-t2"
          >
            进入应用
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </a>
        </footer>
      </div>
    </div>
  )
}

/** 数据看板里的一格：数字从 0 滚到目标值（减弱动效下直接显示） */
function StatTile({
  value,
  unit,
  label,
  index,
}: {
  value: number | string
  unit?: string
  label: string
  index: number
}) {
  const animated = useCountUp(typeof value === 'number' ? value : 0)
  const shown = typeof value === 'number' ? animated.toLocaleString('en-US') : value

  return (
    <div className="stat-tile" data-reveal style={{ '--i': 4 + index } as CSSProperties}>
      <div className="stat-value tnum">
        {shown}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

/** 分区标题：两位序号 + 图标 + 标题，右侧拖一条渐隐分隔线 */
function SectionHeading({
  index,
  icon: Icon,
  title,
  tone = 'sky',
}: {
  index: string
  icon: typeof Info
  title: string
  tone?: 'sky' | 'emerald' | 'amber'
}) {
  const iconTone =
    tone === 'emerald' ? 'text-accent-emerald' : tone === 'amber' ? 'text-accent-amber' : 'text-accent-sky'

  return (
    <div className="mb-4 mt-12" data-reveal>
      <div className="flex items-center gap-2">
        <span className="section-index">{index}</span>
        <Icon className={`h-4 w-4 ${iconTone}`} aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-wide text-t2">{title}</h2>
      </div>
      <div className="section-rule mt-2.5" aria-hidden="true" />
    </div>
  )
}
