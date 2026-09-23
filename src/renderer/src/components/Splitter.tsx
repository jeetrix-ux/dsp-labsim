import { useRef, useState, type JSX, type ReactNode } from 'react'

interface Props {
  direction: 'row' | 'column'
  /** Initial size in px of the fixed pane. */
  size: number
  /** Which pane keeps `size`; the other one takes the remaining space. */
  fixed: 'first' | 'second'
  min?: number
  children: [ReactNode, ReactNode]
}

export function Splitter({ direction, size: initial, fixed, min = 80, children }: Props): JSX.Element {
  const [size, setSize] = useState(initial)
  const ref = useRef<HTMLDivElement>(null)

  const onPointerDown = (): void => {
    const move = (ev: PointerEvent): void => {
      const box = ref.current?.getBoundingClientRect()
      if (!box) return
      const total = direction === 'row' ? box.width : box.height
      const pos = direction === 'row' ? ev.clientX - box.left : ev.clientY - box.top
      const wanted = fixed === 'first' ? pos : total - pos
      setSize(Math.max(min, Math.min(total - min, wanted)))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.classList.add('resizing')
  }

  const fixedStyle = { flex: `0 0 ${size}px` }
  return (
    <div ref={ref} className={`split split-${direction}`}>
      <div className="split-pane" style={fixed === 'first' ? fixedStyle : undefined}>{children[0]}</div>
      <div className="split-handle" onPointerDown={onPointerDown} />
      <div className="split-pane" style={fixed === 'second' ? fixedStyle : undefined}>{children[1]}</div>
    </div>
  )
}
