// 单元用例 - 命令行口令规则（分隔形回归 + 直连形新增）
// 2026-10-21 真机漏检：`mysql -u lantu_app -p'Qy7#mP2!vL9@' lantu_prod` 中的口令
// 完全未检出——旧规则要求旗标后必须有空白分隔，mysql 的直连引号形/裸值形全漏。
import { describe, it, expect } from 'vitest'
import { runDetect, assertSpansConsistent } from '../helpers'

// 拼接构造而非字面量：与 naturalPasswordRules.test.ts 同款，防 GitHub Push Protection
const PW = 'Qy7#mP2' + '!vL9@'

// 只看 ENV_PASSWORD 类的 CLI 口令命中（同一值可能被值传播复制出多条，取首条）
const cliHit = async (text: string) => {
  const { items } = await runDetect(text)
  return { items, hit: items.find(i => i.type === 'ENV_PASSWORD') }
}

describe('CLI 口令 - 检出', () => {
  it('真机漏检原文：mysql 直连单引号 -p\'<pwd>\'，引号不进 span', async () => {
    const text = `ops@prod-app01:~$ mysql -h 10.24.8.37 -u lantu_app -p'${PW}' lantu_prod`
    const { items, hit } = await cliHit(text)

    expect(hit, '应检出直连引号形口令').toBeDefined()
    expect(hit!.original).toBe(PW)
    expect(text.slice(hit!.startIndex, hit!.endIndex)).toBe(PW)
    assertSpansConsistent(text, items)
  })

  it('直连双引号形 -p"<pwd>"', async () => {
    const { hit } = await cliHit(`mysql -u root -p"${PW}" lantu_prod`)
    expect(hit?.original).toBe(PW)
  })

  it('分隔 + 引号形 -p "<pwd>"（旧能力，span 收敛到内层值）', async () => {
    const text = `mysql -p '${PW}' lantu_prod`
    const { items, hit } = await cliHit(text)

    expect(hit?.original).toBe(PW)
    expect(hit!.original.includes("'")).toBe(false)
    assertSpansConsistent(text, items)
  })

  it('等号形 --password="<pwd>"', async () => {
    const { hit } = await cliHit(`redis-cli --password="${PW}" --host db01.internal`)
    expect(hit?.original).toBe(PW)
  })

  it('直连裸值形 -p<pwd>（含符号位放行）', async () => {
    const { hit } = await cliHit(`mysql -u root -p${PW} lantu_prod`)
    expect(hit?.original).toBe(PW)
  })

  it('分隔裸值形回归：--requirepass <pwd> 与 -password <pwd>', async () => {
    const a = await cliHit(`redis-server --requirepass ${PW}`)
    expect(a.hit?.original).toBe(PW)

    // 长旗标单横线：-p 先匹配时精度锚必须失败并回溯到 password 分支
    const b = await cliHit(`tool -password ${PW} run`)
    expect(b.hit?.original).toBe(PW)
  })

  it('值起点不落在旗标内：--password word 时 span 指向旗标之后', async () => {
    const text = 'service --password deploy2024 started'
    const { hit } = await cliHit(text)

    expect(hit?.original).toBe('deploy2024')
    expect(text.slice(hit!.startIndex, hit!.endIndex)).toBe('deploy2024')
    // 旧实现用 indexOf(value) 猜位置，"word" 恰在 --password 内 → span 错位进旗标
    expect(text.slice(0, hit!.startIndex).endsWith('--password ')).toBe(true)
  })
})

describe('CLI 口令 - 精度防线（直连裸值）', () => {
  it('纯字母数字短选项变体不检出：-pretty / -P3306 / -pathfile', async () => {
    expect((await cliHit('-pretty on')).hit).toBeUndefined()
    expect((await cliHit('mysqld -P3306 started')).hit).toBeUndefined()
    expect((await cliHit('run -pathfile /tmp/x')).hit).toBeUndefined()
  })

  it('等号短选项值不检出：-port=8080', async () => {
    expect((await cliHit('start -port=8080 now')).hit).toBeUndefined()
  })

  it('散文里的 --passphrase 不检出（直连值为纯字母，且散文口令规则要求值含数字/符号）', async () => {
    expect((await cliHit('the --passphrase is required for this vault')).hit).toBeUndefined()
  })

  it('短数值与弱口令照常被质量门槛挡下：-p 3306 / -p password', async () => {
    expect((await cliHit('mysql -P 3306')).hit).toBeUndefined()
    expect((await cliHit('mysql -p password')).hit).toBeUndefined()
  })
})
