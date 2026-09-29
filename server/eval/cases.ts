import type { RideFacts } from '../src/ai/prompt.ts'
import type { EvalCase } from './checks.ts'

/**
 * 评测集：固定输入，用于每次改 prompt / 换模型后跑回归。
 *
 * ⚠️ 这些用例**刻意覆盖模型最容易失手的情形**，而不是"随便挑几次真实骑行"：
 *   · 数据稀疏   → 看它会不会硬编（最严重的失败模式）
 *   · 极端条件   → 看它会不会给出不适用的模板化建议
 *   · 明显趋势   → 看它有没有真的做对比，而不是只描述当天
 *
 * 用例数量刻意保持少（6 条）。评测集太大就跑得慢、没人愿意跑，等于没有。
 * 宁可小而每次必跑。
 */

function facts(overrides: Partial<RideFacts>): RideFacts {
  return {
    date: '2026-09-28',
    routeName: null,
    distanceKm: null,
    durationMin: null,
    avgSpeed: null,
    maxSpeed: null,
    elevationGain: null,
    avgGrade: null,
    surface: null,
    traffic: null,
    temperature: null,
    humidity: null,
    windLevel: null,
    precipitation: null,
    aqi: null,
    scores: null,
    ruleComment: '',
    ruleSuggestions: [],
    history: [],
    ...overrides,
  }
}

export const CASES: EvalCase[] = [
  {
    id: 'hot-long',
    intent: '高温 33.5℃ 长距离 62km：应给出补水与出发时段的建议，而不是只说“骑得不错”',
    facts: facts({
      date: '2026-09-28',
      distanceKm: 62.4,
      durationMin: 178,
      avgSpeed: 21.1,
      maxSpeed: 46.3,
      elevationGain: 412,
      avgGrade: 1.8,
      surface: '柏油路',
      traffic: '中',
      temperature: 33.5,
      humidity: 68,
      windLevel: 2,
      precipitation: 0,
      aqi: 62,
      scores: { total: 68, weather: 58, route: 83 },
      history: [{ date: '2026-09-21', distanceKm: 48.2, avgSpeed: 22.4, totalScore: 81 }],
    }),
  },
  {
    id: 'climb-heavy',
    intent: '大爬升 980m / 平均坡度 6.8%：应针对爬坡给出具体安排，而不是泛泛谈体能',
    facts: facts({
      date: '2026-09-27',
      routeName: '山道环线',
      distanceKm: 38.6,
      durationMin: 142,
      avgSpeed: 16.3,
      maxSpeed: 54.2,
      elevationGain: 980,
      avgGrade: 6.8,
      surface: '水泥路',
      traffic: '少',
      temperature: 24.2,
      humidity: 55,
      windLevel: 3,
      aqi: 35,
      scores: { total: 61, weather: 88, route: 34 },
    }),
  },
  {
    id: 'rainy',
    intent: '降雨 8.4mm / 概率 85%：应明确提示路面湿滑与刹车距离，而不是照搬常规建议',
    facts: facts({
      date: '2026-09-25',
      distanceKm: 18.2,
      durationMin: 61,
      avgSpeed: 17.9,
      maxSpeed: 38.4,
      elevationGain: 65,
      avgGrade: 0.9,
      surface: '柏油路',
      traffic: '多',
      temperature: 19.8,
      humidity: 91,
      windLevel: 4,
      precipitation: 8.4,
      aqi: 28,
      scores: { total: 42, weather: 30, route: 60 },
    }),
  },
  {
    id: 'sparse-data',
    intent: '只有距离没有环境数据：应坦白说明可分析的信息有限，绝不能凭空编造环境与身体状况',
    facts: facts({
      date: '2026-09-20',
      distanceKm: 12,
    }),
  },
  {
    id: 'bad-air',
    intent: 'AQI 168 中度污染：应把空气质量当成主要风险，而不是继续鼓励加量',
    facts: facts({
      date: '2026-09-22',
      distanceKm: 26.5,
      durationMin: 82,
      avgSpeed: 19.4,
      maxSpeed: 40.1,
      elevationGain: 88,
      avgGrade: 1.1,
      surface: '柏油路',
      traffic: '中',
      temperature: 29.6,
      humidity: 74,
      windLevel: 1,
      precipitation: 0,
      aqi: 168,
      scores: { total: 38, weather: 22, route: 62 },
      ruleSuggestions: ['空气质量较差，建议佩戴口罩或改为室内训练。'],
    }),
  },
  {
    id: 'improving-trend',
    intent: '历史三次距离与均速持续上升：应识别出趋势并给出下一档目标，而不是只描述当天',
    facts: facts({
      date: '2026-09-28',
      distanceKm: 55.3,
      durationMin: 149,
      avgSpeed: 22.3,
      maxSpeed: 44.8,
      elevationGain: 265,
      avgGrade: 1.4,
      surface: '柏油路',
      traffic: '少',
      temperature: 23.4,
      humidity: 52,
      windLevel: 2,
      aqi: 31,
      scores: { total: 84, weather: 92, route: 72 },
      history: [
        { date: '2026-09-14', distanceKm: 38.1, avgSpeed: 20.2, totalScore: 74 },
        { date: '2026-09-19', distanceKm: 44.7, avgSpeed: 21.1, totalScore: 78 },
        { date: '2026-09-24', distanceKm: 50.2, avgSpeed: 21.8, totalScore: 81 },
      ],
    }),
  },
]
