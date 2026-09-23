import type { Machine } from '../exec/machine'
import { EFPOS, ENOENT, setErrno } from './errno'
import { heap } from './heap'
import { formatTI, vaReader, type PrintfSink } from './printf'
import { scanTI, type CharSource } from './scanf'
import { strlen } from './string'
import { fn, state, vfn, type LibFunction } from './types'

const NFILE = 20
const FILE_SIZE = 24
const BUFSIZ = 256
const EOF = -1
const IOFBF = 1
const IOLBF = 2
const IONBF = 4
const SEEK_SET = 0
const SEEK_CUR = 1
const SEEK_END = 2

type Buffering = 'line' | 'full' | 'none'

class Stream {
  open = false
  console: 'in' | 'out' | 'err' | null = null
  canRead = false
  canWrite = false
  append = false
  buffering: Buffering = 'full'
  /** The malloc'd buffer (BUFSIZ + 1 bytes, as setvbuf allocates it); 0 until the first access. */
  bufAddr = 0
  /** A buffer the program supplied with setvbuf/setbuf, so none is malloc'd. */
  userBuffer = false
  capacity = BUFSIZ
  /** Console output not yet flushed. */
  out: number[] = []
  /** Console input read but not yet consumed. */
  input: number[] = []
  pushback: number[] = []
  eof = false
  err = false
  path = ''
  data: number[] = []
  pos = 0
  dirty = false
}

const latin1 = (bytes: number[]): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.slice(i, i + 4096))
  return s
}

export class Stdio {
  readonly streams: Stream[] = []
  readonly table: number

  constructor(private readonly m: Machine) {
    this.table = m.placement.libraryObject('_ftable')
    for (let i = 0; i < NFILE; i++) this.streams.push(new Stream())
    const [sin, sout, serr] = this.streams
    sin.open = sout.open = serr.open = true
    sin.console = 'in'
    sin.canRead = true
    sin.buffering = 'line'
    sout.console = 'out'
    sout.canWrite = true
    sout.buffering = 'line'
    serr.console = 'err'
    serr.canWrite = true
    serr.buffering = 'none'
    for (let i = 0; i < NFILE; i++) this.syncFd(i)
    m.cleanups.push(() => this.flushAll())
  }

  private syncFd(i: number): void {
    this.m.mem.set32(this.table + i * FILE_SIZE, this.streams[i].open ? i : -1)
  }

  stream(fp: number): Stream | null {
    const off = (fp >>> 0) - this.table
    if (off < 0 || off % FILE_SIZE !== 0 || off / FILE_SIZE >= NFILE) return null
    const s = this.streams[off / FILE_SIZE]
    return s.open ? s : null
  }

  get stdin(): Stream {
    return this.streams[0]
  }
  get stdout(): Stream {
    return this.streams[1]
  }
  get stderr(): Stream {
    return this.streams[2]
  }

  /** __TI_wrt_ok / __TI_rd_ok: a buffered stream mallocs its buffer on first use; failure means EOF. */
  private ready(s: Stream): boolean {
    if (s.buffering === 'none' || s.bufAddr !== 0 || s.userBuffer) return true
    const p = heap(this.m).malloc(s.capacity + 1)
    if (p === 0) {
      s.err = true
      return false
    }
    s.bufAddr = p
    return true
  }

  private emit(s: Stream, bytes: number[]): void {
    if (bytes.length === 0) return
    if (s.console === 'out' || s.console === 'err') {
      this.m.io.write(latin1(bytes), s.console === 'out' ? 'stdout' : 'stderr')
      return
    }
    if (s.append) s.pos = s.data.length
    for (const b of bytes) s.data[s.pos++] = b
    s.dirty = true
  }

  private writeByte(s: Stream, b: number): void {
    if (s.console === null || s.buffering === 'none') {
      this.emit(s, [b])
      return
    }
    if (s.out.length >= s.capacity) this.flush(s)
    s.out.push(b)
    if (s.buffering === 'line' && b === 10) this.flush(s)
  }

  putc(s: Stream, c: number): number {
    if (!s.canWrite) {
      s.err = true
      return EOF
    }
    if (!this.ready(s)) return EOF
    const b = c & 0xff
    this.writeByte(s, b)
    return b
  }

  /** fputs: the bytes up to the first NUL; returns their count or EOF. */
  puts(s: Stream, bytes: number[]): number {
    if (!s.canWrite) {
      s.err = true
      return EOF
    }
    if (!this.ready(s)) return EOF
    const end = bytes.indexOf(0)
    const text = end < 0 ? bytes : bytes.slice(0, end)
    if (s.buffering === 'none' || s.console === null) this.emit(s, text)
    else for (const b of text) this.writeByte(s, b)
    return text.length
  }

  getc(s: Stream): number {
    if (!s.canRead) {
      s.err = true
      return EOF
    }
    if (s.pushback.length > 0) return s.pushback.pop() as number
    if (!this.ready(s)) return EOF
    if (s.console === 'in') {
      if (s.input.length === 0) {
        if (s.eof) return EOF
        // _bufread.c: reading a line-buffered stream flushes every line-buffered stream first.
        for (const t of this.streams) if (t.open && t.buffering === 'line' && t.canWrite) this.flush(t)
        const line = this.m.io.readLine()
        if (line === null) {
          s.eof = true
          return EOF
        }
        s.input = [...line].map((c) => c.charCodeAt(0) & 0xff)
        s.input.push(10)
      }
      return s.input.shift() as number
    }
    if (s.console !== null) return EOF
    if (s.pos >= s.data.length) {
      s.eof = true
      return EOF
    }
    return s.data[s.pos++]
  }

  ungetc(s: Stream, c: number): number {
    if (c === EOF) return EOF
    s.pushback.push(c & 0xff)
    s.eof = false
    return c & 0xff
  }

  flush(s: Stream): void {
    if (s.out.length > 0) {
      const out = s.out
      s.out = []
      this.emit(s, out)
    }
    if (s.dirty && this.m.io.files) {
      this.m.io.files.writeAll(s.path, Uint8Array.from(s.data))
      s.dirty = false
    }
  }

  flushAll(): void {
    for (const s of this.streams) if (s.open) this.flush(s)
  }

  sink(s: Stream): PrintfSink {
    return { c: (c) => void this.putc(s, c), s: (bytes) => this.puts(s, bytes) }
  }

  source(s: Stream): CharSource {
    return { get: () => this.getc(s), unget: (c) => void this.ungetc(s, c) }
  }

  fopen(path: string, mode: string, slot = -1): number {
    const files = this.m.io.files
    const kind = mode[0]
    if (!files || (kind !== 'r' && kind !== 'w' && kind !== 'a')) {
      setErrno(this.m, ENOENT)
      return 0
    }
    const i = slot >= 0 ? slot : this.streams.findIndex((s, k) => k >= 3 && !s.open)
    if (i < 0) return 0
    let data: number[] | null
    if (kind === 'r') {
      const d = files.readAll(path)
      data = d ? [...d] : null
    } else if (kind === 'w') data = files.writeAll(path, new Uint8Array(0)) ? [] : null
    else {
      const d = files.readAll(path)
      data = d ? [...d] : files.writeAll(path, new Uint8Array(0)) ? [] : null
    }
    if (data === null) {
      setErrno(this.m, ENOENT)
      return 0
    }
    const plus = mode.includes('+')
    const s = new Stream()
    Object.assign(s, {
      open: true,
      canRead: kind === 'r' || plus,
      canWrite: kind !== 'r' || plus,
      append: kind === 'a',
      path,
      data,
      pos: kind === 'a' ? data.length : 0
    })
    this.streams[i] = s
    this.syncFd(i)
    return this.table + i * FILE_SIZE
  }

  fclose(fp: number): number {
    const s = this.stream(fp)
    if (!s) return EOF
    this.flush(s)
    if (s.bufAddr !== 0) heap(this.m).release(s.bufAddr)
    const i = ((fp >>> 0) - this.table) / FILE_SIZE
    this.streams[i] = new Stream()
    this.syncFd(i)
    return 0
  }

  seek(s: Stream, offset: number, whence: number): number {
    if (s.console !== null) {
      setErrno(this.m, EFPOS)
      return EOF
    }
    this.flush(s)
    const base = whence === SEEK_SET ? 0 : whence === SEEK_CUR ? s.pos - s.pushback.length : whence === SEEK_END ? s.data.length : NaN
    const pos = base + offset
    if (!(pos >= 0)) {
      setErrno(this.m, EFPOS)
      return EOF
    }
    s.pushback = []
    s.pos = pos
    s.eof = false
    return 0
  }

  tell(s: Stream): number {
    if (s.console !== null) {
      setErrno(this.m, EFPOS)
      return EOF
    }
    return s.pos - s.pushback.length
  }

  setvbuf(s: Stream, buf: number, type: number, size: number): number {
    if (type !== IONBF && size <= 0) return EOF
    if (s.bufAddr !== 0) heap(this.m).release(s.bufAddr)
    s.bufAddr = 0
    s.userBuffer = buf !== 0
    this.flush(s)
    s.buffering = type === IONBF ? 'none' : type === IOLBF ? 'line' : 'full'
    s.capacity = Math.min(size > 0 ? size : BUFSIZ, BUFSIZ)
    if (s.buffering !== 'none' && buf === 0) {
      const p = heap(this.m).malloc(s.capacity + 1)
      if (p === 0) {
        s.err = true
        return EOF
      }
      s.bufAddr = p
    }
    return 0
  }
}

export const stdio = state((m) => new Stdio(m))

const bytesAt = (m: Machine, s: number): number[] => [...m.mem.read(s, strlen(m, s))]

function withStream<T>(m: Machine, fp: number, fail: T, f: (io: Stdio, s: Stream) => T): T {
  const io = stdio(m)
  const s = io.stream(fp)
  return s ? f(io, s) : fail
}

function printTo(m: Machine, s: Stream, fmt: number, va: number): number {
  return formatTI(m, fmt, vaReader(m, va), stdio(m).sink(s))
}

function fgets(m: Machine, io: Stdio, s: Stream, buf: number, n: number): number {
  if (n <= 0) return 0
  let i = 0
  while (i < n - 1) {
    const c = io.getc(s)
    if (c === EOF) break
    m.mem.set8(buf + i++, c)
    if (c === 10) break
  }
  if (i === 0) return 0
  m.mem.set8(buf + i, 0)
  return buf
}

const ERRORS: Record<number, string> = { 0: 'No error', 0x21: 'Domain error', 0x22: 'Range error', 0x02: 'No such file or directory', 0x98: 'File positioning error' }

export const STDIO: Record<string, LibFunction> = {
  printf: vfn(1, (m, [fmt], va) => {
    const io = stdio(m)
    return io.stdout.open ? printTo(m, io.stdout, fmt, va) : EOF
  }),
  fprintf: vfn(2, (m, [fp, fmt], va) => withStream(m, fp, EOF, (_io, s) => printTo(m, s, fmt, va))),
  vprintf: fn(2, (m, [fmt, ap]) => printTo(m, stdio(m).stdout, fmt, ap)),
  vfprintf: fn(3, (m, [fp, fmt, ap]) => withStream(m, fp, EOF, (_io, s) => printTo(m, s, fmt, ap))),
  puts: fn(1, (m, [p]) => {
    const io = stdio(m)
    return io.puts(io.stdout, bytesAt(m, p)) + io.puts(io.stdout, [10])
  }),
  fputs: fn(2, (m, [p, fp]) => withStream(m, fp, EOF, (io, s) => io.puts(s, bytesAt(m, p)))),
  putchar: fn(1, (m, [c]) => stdio(m).putc(stdio(m).stdout, c)),
  fputc: fn(2, (m, [c, fp]) => withStream(m, fp, EOF, (io, s) => io.putc(s, c))),
  putc: fn(2, (m, [c, fp]) => withStream(m, fp, EOF, (io, s) => io.putc(s, c))),
  getchar: fn(0, (m) => stdio(m).getc(stdio(m).stdin)),
  fgetc: fn(1, (m, [fp]) => withStream(m, fp, EOF, (io, s) => io.getc(s))),
  getc: fn(1, (m, [fp]) => withStream(m, fp, EOF, (io, s) => io.getc(s))),
  ungetc: fn(2, (m, [c, fp]) => withStream(m, fp, EOF, (io, s) => io.ungetc(s, c))),
  fgets: fn(3, (m, [buf, n, fp]) => withStream(m, fp, 0, (io, s) => fgets(m, io, s, buf, n))),
  gets: fn(1, (m, [buf]) => {
    const io = stdio(m)
    let i = 0
    for (let c = io.getc(io.stdin); c !== EOF && c !== 10; c = io.getc(io.stdin)) m.mem.set8(buf + i++, c)
    if (i === 0 && io.stdin.eof) return 0
    m.mem.set8(buf + i, 0)
    return buf
  }),
  fopen: fn(2, (m, [p, mode]) => stdio(m).fopen(m.mem.cstring(p), m.mem.cstring(mode))),
  freopen: fn(3, (m, [p, mode, fp]) => {
    const io = stdio(m)
    const i = ((fp >>> 0) - io.table) / FILE_SIZE
    if (!Number.isInteger(i) || i < 0 || i >= NFILE) return 0
    io.fclose(fp)
    return io.fopen(m.mem.cstring(p), m.mem.cstring(mode), i)
  }),
  fclose: fn(1, (m, [fp]) => stdio(m).fclose(fp)),
  fflush: fn(1, (m, [fp]) => {
    const io = stdio(m)
    if (fp === 0) io.flushAll()
    else {
      const s = io.stream(fp)
      if (!s) return EOF
      io.flush(s)
    }
    return 0
  }),
  fread: fn(4, (m, [ptr, size, n, fp]) =>
    withStream(m, fp, 0, (io, s) => {
      const total = Math.imul(size, n) >>> 0
      let k = 0
      for (; k < total; k++) {
        const c = io.getc(s)
        if (c === EOF) break
        m.mem.set8(ptr + k, c)
      }
      return size === 0 ? 0 : Math.floor(k / size)
    })
  ),
  fwrite: fn(4, (m, [ptr, size, n, fp]) =>
    withStream(m, fp, 0, (io, s) => {
      const total = Math.imul(size, n) >>> 0
      let k = 0
      for (; k < total; k++) if (io.putc(s, m.mem.u8(ptr + k)) === EOF) break
      return size === 0 ? 0 : Math.floor(k / size)
    })
  ),
  fseek: fn(3, (m, [fp, off, whence]) => withStream(m, fp, EOF, (io, s) => io.seek(s, off, whence))),
  ftell: fn(1, (m, [fp]) => withStream(m, fp, EOF, (io, s) => io.tell(s))),
  rewind: fn(1, (m, [fp]) =>
    withStream(m, fp, undefined, (io, s) => {
      io.seek(s, 0, SEEK_SET)
      s.err = false
      return undefined
    })
  ),
  fgetpos: fn(2, (m, [fp, pos]) =>
    withStream(m, fp, EOF, (io, s) => {
      const t = io.tell(s)
      if (t < 0) return EOF
      m.mem.set32(pos, t)
      return 0
    })
  ),
  fsetpos: fn(2, (m, [fp, pos]) => withStream(m, fp, EOF, (io, s) => io.seek(s, m.mem.i32(pos), SEEK_SET))),
  feof: fn(1, (m, [fp]) => withStream(m, fp, 0, (_io, s) => (s.eof ? 1 : 0))),
  ferror: fn(1, (m, [fp]) => withStream(m, fp, 0, (_io, s) => (s.err ? 1 : 0))),
  clearerr: fn(1, (m, [fp]) =>
    withStream(m, fp, undefined, (_io, s) => {
      s.eof = false
      s.err = false
      return undefined
    })
  ),
  remove: fn(1, (m, [p]) => (m.io.files?.remove(m.mem.cstring(p)) ? 0 : -1)),
  rename: fn(2, (m, [a, b]) => (m.io.files?.rename(m.mem.cstring(a), m.mem.cstring(b)) ? 0 : -1)),
  perror: fn(1, (m, [p]) => {
    const io = stdio(m)
    const err = io.stderr
    if (p !== 0 && m.mem.u8(p) !== 0) {
      io.puts(err, bytesAt(m, p))
      io.puts(err, [58, 32])
    }
    const e = m.mem.i32(m.placement.libraryObject('errno'))
    io.puts(err, [...(ERRORS[e] ?? 'Unknown error')].map((c) => c.charCodeAt(0)))
    io.putc(err, 10)
  }),
  setvbuf: fn(4, (m, [fp, buf, type, size]) => withStream(m, fp, EOF, (io, s) => io.setvbuf(s, buf, type, size))),
  setbuf: fn(2, (m, [fp, buf]) =>
    withStream(m, fp, undefined, (io, s) => {
      io.setvbuf(s, buf, buf !== 0 ? IOFBF : IONBF, BUFSIZ)
      return undefined
    })
  ),
  scanf: vfn(1, (m, [fmt], va) => {
    const io = stdio(m)
    return scanTI(m, fmt, vaReader(m, va), io.source(io.stdin))
  }),
  fscanf: vfn(2, (m, [fp, fmt], va) => withStream(m, fp, EOF, (io, s) => scanTI(m, fmt, vaReader(m, va), io.source(s)))),
  sscanf: vfn(2, (m, [str, fmt], va) => {
    let p = str >>> 0
    const src: CharSource = {
      get: () => {
        const c = m.mem.u8(p)
        if (c === 0) return EOF
        p++
        return c
      },
      unget: () => {
        p--
      }
    }
    return scanTI(m, fmt, vaReader(m, va), src)
  })
}
