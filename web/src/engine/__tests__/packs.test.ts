import { describe, expect, it } from 'vitest'
import { parseIndex, parsePack, resolveAsset, resolveIndexAsset } from '../../lib/packs'
import { foxPack } from './fixtures'

// A deep copy we can break on purpose (JSON.parse returns `any`, so tests can poke at anything).
const copyOfFox = () => JSON.parse(JSON.stringify(foxPack))
const label = 'pack "fox-test"'

describe('parsePack', () => {
  it('accepts a valid pack and returns the same data', () => {
    expect(parsePack(copyOfFox(), label)).toEqual(foxPack)
  })

  it('rejects a pack that is not 768 x 768', () => {
    const pack = { ...copyOfFox(), size: 512 }
    expect(() => parsePack(pack, label)).toThrow('pack "fox-test": size must be 768 (got 512)')
  })

  it('names the exact point that is broken', () => {
    const pack = copyOfFox()
    pack.strokes[3].points[2] = [10, 'oops']
    expect(() => parsePack(pack, label)).toThrow('pack "fox-test": strokes[3].points[2] must be [x, y] numbers')
  })

  it('lists the allowed values for a bad tier', () => {
    const pack = copyOfFox()
    pack.strokes[0].tier = 'sketch'
    expect(() => parsePack(pack, label)).toThrow(
      'strokes[0].tier must be one of "construction", "outline", "structure", "detail" (got "sketch")',
    )
  })

  it('catches steps that point at strokes that do not exist', () => {
    const pack = copyOfFox()
    pack.steps[1].strokeIds = ['o1', 'nope']
    expect(() => parsePack(pack, label)).toThrow(`steps[1].strokeIds refers to a stroke that doesn't exist ("nope")`)
  })

  it('catches strokes that point at parts that do not exist', () => {
    const pack = copyOfFox()
    pack.strokes[0].partId = 'wing'
    expect(() => parsePack(pack, label)).toThrow(`strokes[0].partId refers to a part that doesn't exist ("wing")`)
  })

  it('rejects something that is not an object at all', () => {
    expect(() => parsePack([], label)).toThrow('pack "fox-test" must be an object')
  })
})

describe('parseIndex', () => {
  const index = {
    subjects: [{ subject: 'fox', title: 'Fox', thumb: 'fox/thumb.webp', packs: { medium: 'fox-medium', simple: 'fox-simple' } }],
  }

  it('accepts a valid index', () => {
    expect(parseIndex(index, 'subject index')).toEqual(index)
  })

  it('rejects an unknown difficulty', () => {
    const bad = { subjects: [{ ...index.subjects[0], packs: { hard: 'fox-hard' } }] }
    expect(() => parseIndex(bad, 'subject index')).toThrow('subject index: subjects[0].packs key must be one of')
  })
})

describe('resolveAsset', () => {
  it('uses data: and http(s) URLs as they are', () => {
    expect(resolveAsset(foxPack, 'data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(resolveAsset(foxPack, 'https://example.com/a.webp')).toBe('https://example.com/a.webp')
  })

  it('puts relative paths inside the pack folder under BASE_URL', () => {
    expect(resolveAsset(foxPack, 'target.webp')).toBe(`${import.meta.env.BASE_URL}subjects/fox-test/target.webp`)
    expect(resolveAsset(foxPack, './stages/chosen.webp')).toBe(`${import.meta.env.BASE_URL}subjects/fox-test/stages/chosen.webp`)
  })

  it('resolves index thumbs relative to /subjects/', () => {
    expect(resolveIndexAsset('fox/thumb.webp')).toBe(`${import.meta.env.BASE_URL}subjects/fox/thumb.webp`)
  })
})
