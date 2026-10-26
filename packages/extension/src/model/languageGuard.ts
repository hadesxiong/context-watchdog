// AI 档的语言守卫：中文占优片段直接跳过本地模型——gliner_small-v2 骨干为纯英文 deberta-v3-small，
// 对中文全盲（真召回为零 + 单字幻觉，形状门禁救不了召回），跳过后退化为纯正则，固定形状目标
//（手机号/身份证/银行卡等）由正则覆盖、零损失。判定：CJK 字母数 ≥ 拉丁字母数（数字/符号不参与）；换模后删除（spec.md §13-3）。

// 汉字（CJK 统一表意文字 + 扩展 A + 兼容表意），不含标点
const CJK_LETTER = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g
const LATIN_LETTER = /[a-zA-Z]/g

export const isCjkDominant = (text: string): boolean => {
  const cjk = text.match(CJK_LETTER)?.length ?? 0
  if (cjk === 0) return false
  const latin = text.match(LATIN_LETTER)?.length ?? 0
  return cjk >= latin
}
