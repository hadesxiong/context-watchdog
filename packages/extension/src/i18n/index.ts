// 极简 i18n（自写，不引 vue-i18n）
//
// 设计约束与取舍：
//
// 1) **单一 catalog**。UI 文案与 manifest 的 __MSG_*__ 共用同一份 JSON——
//    UI 走本模块（可运行时覆盖语言），manifest 与 service worker 走
//    chrome.i18n（Chrome 原生，不必把字典打进 SW 包）。postbuild 会把这份
//    JSON 转成 dist/_locales/*/messages.json。
//    键名一律用 snake_case：Chrome 的 messages.json 只接受 [a-zA-Z0-9_@]，
//    用点号分层就无法共用，只能被迫维护两份清单。
//
// 2) **扁平 JSON**，不做嵌套。嵌套要靠脚本生成 _locales，多一层生成物就多
//    一处漂移点；扁平的 key 直接就是 messages.json 的 key。
//
// 3) **同步**。语言在模块加载时定好（localStorage 是同步 API），渲染时直接
//    读，不需要 loading 态、不需要 await、不会有首帧闪烁。
//
// 4) zh_CN 缺失的键回退到 en，en 缺失则返回 key 本身——宁可界面露出
//    `settings_title` 这种原始 key（一眼可见、可测），也不要静默显示空串。
import { ref, computed } from 'vue'
import { setPlaceholderLocale } from '@engine/replacer/placeholder'
import en from './locales/en.json'
import zhCN from './locales/zh_CN.json'

export type Locale = 'en' | 'zh_CN'

/** 语言偏好键：'auto' 跟随浏览器，其余为显式指定 */
export const LOCALE_PREF_KEY = 'contextwatchdog.locale'

const CATALOGS: Record<Locale, Record<string, string>> = {
  en: en as Record<string, string>,
  zh_CN: zhCN as Record<string, string>
}

export const AVAILABLE_LOCALES: Locale[] = ['en', 'zh_CN']

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  zh_CN: '简体中文'
}

/** 把浏览器语言标签映射到我们支持的 locale（zh-CN / zh-TW / zh-Hans 等一律归 zh_CN） */
export const normalizeLocale = (tag: string | undefined | null): Locale => {
  if (!tag) return 'en'
  return tag.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en'
}

/** 浏览器语言：扩展页里 chrome.i18n 可用；测试/其他环境回退 navigator */
const browserLocale = (): Locale => {
  const tag = typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage
    ? chrome.i18n.getUILanguage()
    : typeof navigator !== 'undefined'
      ? navigator.language
      : 'en'
  return normalizeLocale(tag)
}

/** 读偏好：localStorage 同步可取，因此首帧就能定下语言，不会闪 */
const readPreference = (): Locale | 'auto' => {
  try {
    const raw = localStorage.getItem(LOCALE_PREF_KEY)
    if (raw === 'en' || raw === 'zh_CN') return raw
  } catch {
    // 隐私模式/被禁用时静默回退到自动
  }
  return 'auto'
}

const current = ref<Locale>(readPreference() === 'auto' ? browserLocale() : readPreference() as Locale)
const preference = ref<Locale | 'auto'>(readPreference())

/**
 * 界面语言同时决定**占位符语言**：占位符会被写进用户复制去发给 AI 的文本，
 * 英文界面下出现 <<手机号>> 是明显破绽。引擎自己读不到浏览器语言，只能由宿主注入。
 */
const applyLocale = (next: Locale): void => {
  current.value = next
  setPlaceholderLocale(next)
}
applyLocale(current.value)

export const locale = computed(() => current.value)
export const localePreference = computed(() => preference.value)

export const setLocalePreference = (next: Locale | 'auto'): void => {
  preference.value = next
  try {
    localStorage.setItem(LOCALE_PREF_KEY, next)
  } catch {
    // 存不下也不影响本次会话
  }
  applyLocale(next === 'auto' ? browserLocale() : next)
}

/**
 * 取文案。params 以 `{name}` 占位符替换。
 * 找不到 key 时回退 en，再找不到就返回 key 本身（见文件头第 4 条）。
 */
export const t = (key: string, params?: Record<string, string | number>): string => {
  const dict = CATALOGS[current.value]
  let text = dict[key] ?? CATALOGS.en[key] ?? key
  if (params) {
    // 用 split/join 而不是 replaceAll：无需把 tsconfig 的 lib 抬到 ES2021
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value))
    }
  }
  return text
}

/**
 * 检测类型的显示名：`type_<DetectionType>`。
 * 没有对应词条时回退到类型标识本身——t() 找不到 key 会原样返回 key，
 * 这里拿「返回值 === key」当缺失信号，界面会露出原始类型名而不是空白。
 */
export const typeLabel = (type: string): string => {
  const key = `type_${type}`
  const label = t(key)
  return label === key ? type : label
}

/**
 * 内置档案的显示名与说明。
 *
 * 引擎里的 `ProfileConfig.name/description` 是**数据**（宿主无关），内置档案那份是
 * 中文兜底；展示层优先取 `profile_<id>_name` / `profile_<id>_desc` 词条。
 * 自定义档案的名字是用户自己输入的，永远原样显示。
 */
export const profileLabel = (
  profile: { id: string; name: string; description: string; builtin?: boolean }
): { name: string; description: string } => {
  if (!profile.builtin) return { name: profile.name, description: profile.description }
  const nameKey = `profile_${profile.id}_name`
  const descKey = `profile_${profile.id}_desc`
  const name = t(nameKey)
  const description = t(descKey)
  return {
    name: name === nameKey ? profile.name : name,
    description: description === descKey ? profile.description : description
  }
}

/** 模板里用：`const { t } = useI18n()` 后即可 `t('key')`，语言切换会自动重渲染 */
export const useI18n = () => ({
  t,
  locale,
  localePreference,
  setLocalePreference,
  availableLocales: AVAILABLE_LOCALES,
  localeNames: LOCALE_NAMES,
  typeLabel,
  profileLabel
})

/** 供测试与工具使用：整份字典（按 locale） */
export const catalogs = CATALOGS