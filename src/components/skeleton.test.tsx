import { describe, it, expect } from 'vitest'
import { SkeletonBar, SkeletonCard, SkeletonCardList, SkeletonPlayerList } from './skeleton'

describe('skeleton components', () => {
  it('should render SkeletonBar', () => {
    const el = SkeletonBar({}) as HTMLElement
    expect(el).toBeDefined()
    expect(el.tagName).toBe('DIV')
    expect(el.classList.contains('skeleton')).toBe(true)
  })

  it('should render SkeletonBar with custom class', () => {
    const el = SkeletonBar({ class: 'h-10 w-20' }) as HTMLElement
    expect(el.classList.contains('h-10')).toBe(true)
    expect(el.classList.contains('w-20')).toBe(true)
  })

  it('should render SkeletonCard', () => {
    const el = SkeletonCard() as HTMLElement
    expect(el).toBeDefined()
    expect(el.tagName).toBe('DIV')
  })

  it('should render SkeletonCardList with default count', () => {
    const el = SkeletonCardList({}) as HTMLElement
    expect(el).toBeDefined()
    expect(el.childNodes.length).toBe(4)
  })

  it('should render SkeletonCardList with custom count', () => {
    const el = SkeletonCardList({ count: 2 }) as HTMLElement
    expect(el.childNodes.length).toBe(2)
  })

  it('should render SkeletonPlayerList with default count', () => {
    const el = SkeletonPlayerList({}) as HTMLElement
    expect(el).toBeDefined()
    expect(el.childNodes.length).toBe(3)
  })

  it('should render SkeletonPlayerList with custom count', () => {
    const el = SkeletonPlayerList({ count: 5 }) as HTMLElement
    expect(el.childNodes.length).toBe(5)
  })
})
