// 单元用例 - 检测管线配置（正则恒开 / 场景识别内部化 / AI 开关接线）
// 正则为基础引擎无关闭入口（SW 粘贴拦截仅依赖此档）；场景识别只喂给 GLiNER 提示词，
// 已并入 AI 分支（pipeline 内部处理，不再暴露 config 键）
import { describe, it, expect } from 'vitest'
import { detect } from '@engine/detector/pipeline'
import { getProfileById } from '@engine/detector/profiles'

describe('pipeline 引擎配置', () => {
  const profile = getProfileById('universal')
  // 密码赋值规则带行首锚点 → 用多行文本（与 golden 用例同款写法）
  const text = ['我的手机号 13812345678', 'DB_PASSWORD=Tr0ub4dor&3x!'].join('\n')

  it('正则恒开：默认即检出手机号与密码（无任何关闭入口）', async () => {
    const { items } = await detect(text, profile)
    expect(items.some(i => i.type === 'PHONE')).toBe(true)
    expect(items.some(i => i.type === 'ENV_PASSWORD' || i.type === 'DB_PASSWORD')).toBe(true)
  })

  it('enableContentDetection 开/关均不影响正则检出（场景识别只服务 AI 提示词）', async () => {
    // 单测环境无 GLiNER 模型（isContentModelReady=false），AI 分支本就不跑 →
    // 该键只应影响 AI 分支，正则档结果必须稳定
    const off = await detect(text, profile, { enableContentDetection: false })
    const on = await detect(text, profile, { enableContentDetection: true })
    expect(off.items.some(i => i.original === '13812345678')).toBe(true)
    expect(on.items.some(i => i.original === '13812345678')).toBe(true)
  })
})
