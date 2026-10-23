// AI 档的语言守卫：中文占优片段直接跳过本地模型
//
// 当前模型 gliner_small-v2 骨干为纯英文 deberta-v3-small（128K SPM 词表），
// 中文字符全部塌缩为 [UNK]，encoder 对中文内容全盲——实机表现为真召回为零 +
// 0.25–0.65 区间单字乱指幻觉（形状门禁只能拦幻觉、救不了召回，取证见 spec §13-3）。
// 对这样的模型喂中文只会产出垃圾：白跑一次推理，还可能有形似词漏过形状门禁
// 变成错误替换。故 AI 级联在入口处跳过「中文占优」片段——这些片段退化为纯正则，
// 固定形状目标（手机号/身份证/银行卡/邮箱/密钥等）由正则覆盖；跳过相对当前模型
// 零检测损失（模型对中文本就全盲，跑与不跑同结果）。
//
// 判定口径：CJK 字母字符数 ≥ 拉丁字母数 即视为中文占优。
// 混合文本如「请帮我联系 John Smith」（CJK 5 vs 拉丁 10）不跳过，保住拉丁实体的
// AI 检出；「用户李雷的收货地址是上海市浦东新区世纪大道 100 号」（CJK 21 vs 拉丁 0）
// 跳过。数字/符号不参与判定（电话号码本身无语言属性，由正则档负责）。
//
// 1.1 若换入可用的多语言模型（路线：自产量化 + 托管，见 TODO），随换模一并删除。

// 汉字（CJK 统一表意文字 + 扩展 A + 兼容表意），不含标点
const CJK_LETTER = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g
const LATIN_LETTER = /[a-zA-Z]/g

export const isCjkDominant = (text: string): boolean => {
  const cjk = text.match(CJK_LETTER)?.length ?? 0
  if (cjk === 0) return false
  const latin = text.match(LATIN_LETTER)?.length ?? 0
  return cjk >= latin
}
