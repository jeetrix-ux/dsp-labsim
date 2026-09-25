import { useEffect, useRef, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

interface Props {
  /** Window name; the main process only allows `labsim-*` pop-outs. */
  name: string
  title: string
  width: number
  height: number
  /** Called when the user closes the window (not when this component unmounts). */
  onClosed: () => void
  /** Keyboard handler of the main window (debug keys), also installed in the pop-out. */
  onKey: (e: KeyboardEvent) => void
  /** Rendered once; components inside subscribe to the stores themselves. */
  children: ReactNode
}

/** Copies a stylesheet node into another document; <link> gets an absolute href so relative URLs keep working. */
function cloneStyle(node: Node, into: Document): Node | null {
  if (node instanceof HTMLStyleElement) {
    const s = into.createElement('style')
    s.textContent = node.textContent
    return s
  }
  if (node instanceof HTMLLinkElement && node.rel === 'stylesheet') {
    const l = into.createElement('link')
    l.rel = 'stylesheet'
    l.href = node.href
    return l
  }
  return null
}

/**
 * Shows `children` in a separate OS window. The window is opened from this page (same origin), so it
 * shares the stores; it gets its own React root because React only sees events in the document it
 * was mounted in.
 */
export function PopoutWindow({ name, title, width, height, onClosed, onKey, children }: Props): null {
  const closed = useRef(onClosed)
  closed.current = onClosed

  useEffect(() => {
    const child = window.open('', name, `width=${width},height=${height}`)
    if (!child) {
      closed.current()
      return
    }
    const doc = child.document
    doc.title = title
    // Mirror the page's styles, including the ones Monaco adds or rewrites later.
    const copies = new Map<Node, Node>()
    const copy = (n: Node): void => {
      const c = cloneStyle(n, doc)
      if (c) {
        copies.set(n, c)
        doc.head.appendChild(c)
      }
    }
    document.head.childNodes.forEach(copy)
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') {
          r.addedNodes.forEach(copy)
          r.removedNodes.forEach((n) => {
            const c = copies.get(n)
            if (c) doc.head.removeChild(c)
            copies.delete(n)
          })
        } else {
          const style = r.target instanceof HTMLStyleElement ? r.target : r.target.parentNode
          const c = style ? copies.get(style) : undefined
          if (c && style) c.textContent = style.textContent
        }
      }
    })
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })

    doc.body.className = 'popout-body'
    const host = doc.createElement('div')
    host.className = 'popout-root'
    doc.body.appendChild(host)
    const root = createRoot(host)
    root.render(children)
    child.addEventListener('keydown', onKey, true)

    let unmounting = false
    const onPageHide = (): void => {
      if (!unmounting) closed.current()
    }
    child.addEventListener('pagehide', onPageHide)
    child.focus()
    return () => {
      unmounting = true
      observer.disconnect()
      child.removeEventListener('pagehide', onPageHide)
      // Unmounting a root during another root's commit makes React warn; do it right after.
      setTimeout(() => {
        root.unmount()
        child.close()
      })
    }
    // The window lives as long as the component; children are rendered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
