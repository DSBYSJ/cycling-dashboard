import { ArrowRight, Bike, Database, Gauge, Info, Moon, Route, ShieldCheck, SlidersHorizontal, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { AppVersion } from './AppVersion'
import { HAS_FILING, FilingRecords } from './FilingRecords'
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
 */

/** 与 FEATURE_GROUPS 的顺序一一对应；多一个少一个都不会崩（取不到时回落到 Info） */
const GROUP_ICONS = [Route, Gauge, Bike, Database, ShieldCheck]

/** 进入应用（未登录时会落到登录页，由 App 的分流决定） */
const APP_ENTRY = '#/record'

export default function AboutPage() {
  const { theme, toggle: toggleTheme } = useTheme()

  return (
    <div className="min-h-full bg-page">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 flex justify-end">
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

        <header className="text-center">
          <span className="text-3xl" aria-hidden="true">
            🚴
          </span>
          <h1 className="mt-2 text-lg font-bold tracking-wide text-t1">骑行评分监测看板</h1>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-t4">{SITE_TAGLINE}</p>
          <a href={APP_ENTRY} className="btn-primary mt-5">
            进入应用
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
          <p className="mt-2 text-[11px] text-t5">需要账号登录后才能使用</p>
        </header>

        <section className="card mt-8">
          <h2 className="card-title">
            <Info className="h-4 w-4 text-accent-sky" aria-hidden="true" />
            关于这个项目
          </h2>
          <div className="space-y-3">
            {SITE_INTRO.map((paragraph) => (
              <p key={paragraph} className="text-xs leading-6 text-t3">
                {paragraph}
              </p>
            ))}
          </div>
        </section>

        <h2 className="mb-4 mt-10 flex items-center gap-2 text-sm font-semibold tracking-wide text-t2">
          <Route className="h-4 w-4 text-accent-emerald" aria-hidden="true" />
          功能
        </h2>
        <div className="space-y-4">
          {FEATURE_GROUPS.map((group, index) => {
            const Icon = GROUP_ICONS[index] ?? Info
            return (
              <section className="card" key={group.id}>
                <h3 className="card-title mb-0">
                  <Icon className="h-4 w-4 text-accent-sky" aria-hidden="true" />
                  {group.title}
                </h3>
                <p className="mt-1 text-[11px] leading-5 text-t4">{group.summary}</p>
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

        <h2 className="mb-4 mt-10 flex items-center gap-2 text-sm font-semibold tracking-wide text-t2">
          <SlidersHorizontal className="h-4 w-4 text-accent-amber" aria-hidden="true" />
          技术
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {TECH_LAYERS.map((layer) => (
            <section className="card" key={layer.name}>
              <h3 className="card-title">{layer.name}</h3>
              <ul className="space-y-1.5">
                {layer.stack.map((entry) => (
                  <li key={entry} className="text-[11px] leading-5 text-t3">
                    {entry}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="card mt-4">
          <h3 className="card-title">
            <Gauge className="h-4 w-4 text-accent-emerald" aria-hidden="true" />
            几个有意为之的取舍
          </h3>
          <ul className="space-y-2">
            {PRINCIPLES.map((item) => (
              <li key={item} className="flex gap-2 text-xs leading-5 text-t3">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent-emerald" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-10 border-t border-line-soft pt-6 text-center">
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
