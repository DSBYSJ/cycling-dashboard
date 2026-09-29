import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../../types'
import {
  elevationGainMeters,
  haversine,
  maxSpeedFromSeries,
  parseGPX,
  speedSeriesFromTrack,
  summarizeTrack,
  trackDistanceMeters,
} from '../gpxParser'

const pt = (lat: number, lon: number, ele?: number, time?: string): TrackPoint => ({ lat, lon, ele, time })

describe('haversine', () => {
  it('与已知距离一致(广州纬度上 0.01° 经度约 1.024km)', () => {
    const d = haversine(23.1291, 113.2644, 23.1291, 113.2744)
    expect(d).toBeGreaterThan(1020)
    expect(d).toBeLessThan(1030)
  })

  it('同一点距离为 0', () => {
    expect(haversine(23.1291, 113.2644, 23.1291, 113.2644)).toBe(0)
  })
})

describe('trackDistanceMeters', () => {
  it('累加所有相邻分段', () => {
    const points = [pt(23.1291, 113.2644), pt(23.1291, 113.2744), pt(23.1291, 113.2844)]
    expect(trackDistanceMeters(points)).toBeGreaterThan(2040)
    expect(trackDistanceMeters(points)).toBeLessThan(2060)
  })

  it('少于两个点时距离为 0', () => {
    expect(trackDistanceMeters([])).toBe(0)
    expect(trackDistanceMeters([pt(1, 1)])).toBe(0)
  })
})

describe('elevationGainMeters', () => {
  it('只累加上升段', () => {
    expect(elevationGainMeters([pt(0, 0, 100), pt(0, 0, 105), pt(0, 0, 103), pt(0, 0, 110)])).toBe(12)
  })

  it('过滤 1m 以内的噪声波动', () => {
    expect(elevationGainMeters([pt(0, 0, 100), pt(0, 0, 100.5), pt(0, 0, 101), pt(0, 0, 100.5)])).toBe(0)
  })

  it('忽略缺失海拔的点', () => {
    expect(elevationGainMeters([pt(0, 0, 100), pt(0, 0), pt(0, 0, 120)])).toBe(20)
  })
})

describe('speedSeriesFromTrack', () => {
  it('由时间戳与分段距离算速度,并给出累计距离', () => {
    const series = speedSeriesFromTrack([
      pt(23.1291, 113.2644, 10, '2026-09-15T08:00:00Z'),
      pt(23.1291, 113.2744, 10, '2026-09-15T08:01:00Z'),
    ])
    expect(series).toHaveLength(1)
    expect(series[0].distanceKm).toBeCloseTo(1.024, 2)
    expect(series[0].speed).toBeGreaterThan(60)
    expect(series[0].speed).toBeLessThan(63)
  })

  it('缺少时间戳时速度为 0(不参与曲线展示)', () => {
    const series = speedSeriesFromTrack([pt(23.1291, 113.2644), pt(23.1291, 113.2744)])
    expect(series[0].speed).toBe(0)
  })

  it('速度上限 100km/h,过滤 GPS 抖动', () => {
    const series = speedSeriesFromTrack([
      pt(0, 0, undefined, '2026-09-15T08:00:00Z'),
      pt(0, 0.03, undefined, '2026-09-15T08:00:10Z'),
    ])
    expect(series[0].speed).toBe(100)
  })

  it('时间倒序(设备时钟异常)时不产生负速度', () => {
    const series = speedSeriesFromTrack([
      pt(23.1291, 113.2644, undefined, '2026-09-15T08:01:00Z'),
      pt(23.1291, 113.2744, undefined, '2026-09-15T08:00:00Z'),
    ])
    expect(series[0].speed).toBe(0)
  })
})

describe('maxSpeedFromSeries', () => {
  it('取最大值并保留一位小数', () => {
    expect(maxSpeedFromSeries([{ speed: 0 }, { speed: 12.34 }, { speed: 5 }])).toBe(12.3)
  })

  it('无有效速度时返回 null', () => {
    expect(maxSpeedFromSeries([])).toBeNull()
    expect(maxSpeedFromSeries([{ speed: 0 }])).toBeNull()
  })
})

describe('summarizeTrack', () => {
  it('给出距离、爬升、平均坡度与起终点', () => {
    const summary = summarizeTrack([pt(23.1291, 113.2644, 10), pt(23.1291, 113.2744, 30)])
    expect(summary.distanceKm).toBeCloseTo(1.02, 2)
    expect(summary.elevationGain).toBe(20)
    expect(summary.avgGrade).toBeCloseTo(1.95, 1)
    expect(summary.start).toEqual({ lat: 23.1291, lon: 113.2644 })
    expect(summary.end).toEqual({ lat: 23.1291, lon: 113.2744 })
  })

  it('没有海拔数据时平均坡度为 null', () => {
    expect(summarizeTrack([pt(1, 1), pt(1, 1.001)]).avgGrade).toBeNull()
  })
})

describe('parseGPX 的设备统计（华为等厂商写在 extensions 里）', () => {
  const huaweiGpx = `<gpx version="1.0" creator="Health">
  <trk><type>户外骑行</type>
    <extensions><totalTime>25184.0</totalTime><cumulativeClimb>463.1</cumulativeClimb><totalDistance>117320.0</totalDistance></extensions>
    <trkseg>
      <trkpt lat="23.1200" lon="113.3200"><ele>12</ele><time>2026-09-24T00:45:51Z</time></trkpt>
      <trkpt lat="23.1300" lon="113.3300"><ele>15</ele><time>2026-09-24T00:46:51Z</time></trkpt>
    </trkseg>
  </trk></gpx>`

  it('解析出距离、运动时长与累计爬升', () => {
    const { stats } = parseGPX(huaweiGpx)
    expect(stats.distanceMeters).toBe(117320)
    expect(stats.durationSeconds).toBe(25184)
    expect(stats.climbMeters).toBeCloseTo(463.1, 1)
  })

  it('没有 extensions 时三项都是 null —— 上层据此回落到自己算', () => {
    const { stats } = parseGPX(
      '<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.001" lon="2.001"/></trkseg></trk></gpx>'
    )
    expect(stats.distanceMeters).toBeNull()
    expect(stats.durationSeconds).toBeNull()
    expect(stats.climbMeters).toBeNull()
  })

  it('扩展值是 0 或非数字时同样按"没有"处理，不拿它去覆盖自己算的结果', () => {
    const { stats } = parseGPX(
      '<gpx><trk><extensions><totalDistance>0</totalDistance><totalTime>abc</totalTime></extensions>' +
        '<trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.001" lon="2.001"/></trkseg></trk></gpx>'
    )
    expect(stats.distanceMeters).toBeNull()
    expect(stats.durationSeconds).toBeNull()
  })
})

describe('速度去噪（中位数滤波）', () => {
  /**
   * 从给定纬度出发，每秒走 metersPerSecond 米，生成 count 个点。
   * 用于构造"速度已知"的轨迹，好断言滤波有没有起到该起的作用。
   */
  function walkFrom(lat: number, count: number, metersPerSecond: number, startMs: number): TrackPoint[] {
    const stepDeg = metersPerSecond / 111_320
    return Array.from({ length: count }, (_, i) => ({
      lat: lat + (i + 1) * stepDeg,
      lon: 113,
      time: new Date(startMs + (i + 1) * 1000).toISOString(),
    }))
  }

  it('★ 孤立的 GPS 漂移不再产生假的最高速（这才是真实数据里 92 km/h 的来源）', () => {
    const start = Date.UTC(2026, 8, 24, 0, 0, 0)
    const normal = walkFrom(23, 10, 7, start) // 7 m/s ≈ 25 km/h
    const lastLat = normal[normal.length - 1].lat
    const lastTime = Date.parse(normal[normal.length - 1].time as string)

    // 中间插一段 1 秒位移 26 米 —— 相当于 93.6 km/h，骑行不可能
    const driftLat = lastLat + 26 / 111_320
    const driftTime = lastTime + 1000
    const drift: TrackPoint = { lat: driftLat, lon: 113, time: new Date(driftTime).toISOString() }
    const rest = walkFrom(driftLat, 10, 7, driftTime)

    const points = [{ lat: 23, lon: 113, time: new Date(start).toISOString() }, ...normal, drift, ...rest]
    const peak = maxSpeedFromSeries(speedSeriesFromTrack(points))

    expect(peak).not.toBeNull()
    expect(peak as number).toBeLessThan(60) // 去噪前这里会是 93.6
    expect(peak as number).toBeGreaterThan(15)
  })

  it('★ 连续多段高速是真下坡，必须保留 —— 滤波不能把真实数据一起杀掉', () => {
    const points = walkFrom(23, 20, 16, Date.UTC(2026, 8, 24, 0, 0, 0)) // 16 m/s = 57.6 km/h
    const peak = maxSpeedFromSeries(speedSeriesFromTrack(points))
    expect(peak as number).toBeGreaterThan(50)
  })

  it('速度曲线与最高速用的是同一份平滑结果，不会自相矛盾', () => {
    const points = walkFrom(23, 5, 7, Date.UTC(2026, 8, 24, 0, 0, 0))
    const series = speedSeriesFromTrack(points)
    const peak = maxSpeedFromSeries(series) as number
    const curveMax = Math.max(...series.map((s) => s.speed))
    expect(peak).toBeCloseTo(curveMax, 5)
  })

  it('速度为 0 的段（无时间戳/没动）不参与平滑，避免把真实速度拉低', () => {
    const series = speedSeriesFromTrack([
      pt(23.1291, 113.2644, undefined, '2026-09-15T08:00:00Z'),
      pt(23.1291, 113.2744, undefined, '2026-09-15T08:01:00Z'),
      pt(23.1291, 113.2744, undefined, '2026-09-15T08:02:00Z'), // 原地不动 → 速度 0
      pt(23.1291, 113.2844, undefined, '2026-09-15T08:03:00Z'),
    ])
    // 中间那段 0 不该把两侧拉下来
    expect(series[0].speed).toBeGreaterThan(60)
    expect(series[2].speed).toBeGreaterThan(60)
  })
})

describe('parseGPX', () => {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>珠江新城环线</name>
    <trkseg>
      <trkpt lat="23.1200" lon="113.3200"><ele>12.5</ele><time>2026-09-15T08:00:00Z</time></trkpt>
      <trkpt lat="23.1250" lon="113.3250"><ele>15.0</ele><time>2026-09-15T08:05:00Z</time></trkpt>
      <trkpt lat="23.1300" lon="113.3300"><ele>18.0</ele><time>2026-09-15T08:10:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`

  it('解析轨迹点、海拔、时间戳与轨迹名', () => {
    const { points, name } = parseGPX(gpx)
    expect(points).toHaveLength(3)
    expect(points[0]).toEqual({ lat: 23.12, lon: 113.32, ele: 12.5, time: '2026-09-15T08:00:00Z' })
    expect(name).toBe('珠江新城环线')
  })

  it('缺少 ele/time 时对应字段为 undefined', () => {
    const { points } = parseGPX('<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.001" lon="2.001"/></trkseg></trk></gpx>')
    expect(points[0].ele).toBeUndefined()
    expect(points[0].time).toBeUndefined()
  })

  it('跳过经纬度非法的轨迹点', () => {
    const { points } = parseGPX(
      '<gpx><trk><trkseg>' +
        '<trkpt lat="abc" lon="113.3"/>' +
        '<trkpt lat="23.12" lon="113.32"/>' +
        '<trkpt lat="23.13" lon="113.33"/>' +
        '</trkseg></trk></gpx>'
    )
    expect(points).toHaveLength(2)
  })

  it('非法 XML 抛错', () => {
    // 不同环境下 DOMParser 的行为略有差异:可能返回 parsererror 文档,也可能直接抛异常,
    // 两种情况都必须被 parseGPX 转成错误,而不是返回空轨迹
    expect(() => parseGPX('<gpx><trk>')).toThrow()
  })

  it('没有轨迹点时抛错', () => {
    expect(() => parseGPX('<gpx><trk><name>空轨迹</name></trk></gpx>')).toThrow(/没有轨迹点/)
  })

  it('有效轨迹点不足两个时抛错', () => {
    expect(() => parseGPX('<gpx><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>')).toThrow(/轨迹点不足/)
  })
})
